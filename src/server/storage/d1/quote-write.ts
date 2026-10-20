import { auditEvent, quote, seller } from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import {
  QuoteRequest,
  effectiveStatus,
  type BuyerQuoteView,
  type QuoteRow,
} from "@/server/domain/quotes";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { createD1CatalogReads } from "./catalog-read";
import type { D1Db } from "./client";
import {
  assertD1BuyerScope,
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { d1QuotePlan } from "./quote-plan";
import { d1BuyerQuoteView } from "./quote-view";

const OPEN = ["needs_information", "seller_review", "review_ready"] as const;

/** Native quote creation and cancellation; commercial data is immutable across revisions. */
export function createD1QuoteWrites(db: D1Db) {
  return {
    async proposeQuote(
      buyer: BuyerPrincipal,
      raw: QuoteRequest,
    ): Promise<BuyerQuoteView> {
      const parsed = QuoteRequest.safeParse(raw);
      if (!parsed.success)
        throw invalid(
          "That quote request was not valid. Choose offers from the list and try again.",
        );
      const request = parsed.data;
      const [shop] = await db
        .select()
        .from(seller)
        .where(eq(seller.id, buyer.sellerId));
      if (!shop) throw notFound("shop");
      const [previous] = request.threadId
        ? await db
            .select()
            .from(quote)
            .where(
              and(
                eq(quote.threadId, request.threadId),
                eq(quote.buyerSessionId, buyer.buyerSessionId),
                eq(quote.sellerId, buyer.sellerId),
              ),
            )
            .orderBy(desc(quote.revision))
            .limit(1)
        : [];
      if (request.threadId && !previous) throw notFound("quote");
      if (
        previous &&
        (previous.status === "accepted" || previous.status === "consumed")
      )
        throw conflict(
          "This quote is already being paid. Check its payment status instead.",
          ["check_payment"],
        );
      const rows = await createD1CatalogReads(db).loadOffersForQuote(
        shop.id,
        request.lines.map((line) => line.offerId),
      );
      const retain = Boolean(
        previous?.sellerApprovedAt &&
          previous.approvedScope &&
          (OPEN as readonly string[]).includes(effectiveStatus(previous)) &&
          previous.policySnapshot.policyRevision === shop.policyRevision &&
          previous.buyerNote === (request.buyerNote ?? null) &&
          previous.deliveryRequested === (request.deliveryRequested ?? false) &&
          previous.lines.length === request.lines.length &&
          previous.lines.every((line) =>
            request.lines.some(
              (next) =>
                next.offerId === line.offerId &&
                next.quantity === line.quantity,
            ),
          ) &&
          previous.lines.every((line) =>
            rows.some(
              ({ offer }) =>
                offer.id === line.offerId &&
                offer.published &&
                offer.revision === line.offerRevision,
            ),
          ),
      );
      const plan = d1QuotePlan(db, {
        shop,
        rows,
        buyerSessionId: buyer.buyerSessionId,
        threadId: previous?.threadId ?? crypto.randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        request,
        scopeApproved: retain,
        approvedScope: retain ? previous!.approvedScope : null,
        sellerPrices: retain
          ? new Map(
              previous!.lines
                .filter(
                  (line) =>
                    line.kind === "service" && line.unitAmountMinor !== null,
                )
                .map((line) => [line.offerId, line.unitAmountMinor!]),
            )
          : undefined,
        retainedExpiry: retain ? previous!.expiresAt : undefined,
      });
      const execution = crypto.randomUUID();
      try {
        const results = await db.batch([
          batchGuard(
            db,
            `${execution}:quote`,
            sql`${buyerScope(buyer)} and ${plan.valid}
            and ${previous ? sql`exists(select 1 from quote where id=${previous.id} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId} and status=${previous.status}) and not exists(select 1 from quote where thread_id=${previous.threadId} and revision>${previous.revision})` : sql`1`}`,
          ),
          ...plan.writes,
          ...(previous
            ? [
                db
                  .update(quote)
                  .set({ status: "replaced" })
                  .where(
                    and(
                      eq(quote.threadId, previous.threadId),
                      notInArray(quote.status, ["accepted", "consumed"]),
                      notInArray(quote.id, [plan.row.id]),
                    ),
                  ),
              ]
            : []),
          db
            .insert(auditEvent)
            .values({
              actor: "buyer",
              actorId: buyer.buyerSessionId,
              operation: "quote.propose",
              targetType: "quote",
              targetId: plan.row.id,
              outcome: "ok",
              details: {
                revision: plan.row.revision,
                status: plan.row.status,
                totalMinor: plan.row.totalMinor,
              },
            }),
          db.select().from(quote).where(eq(quote.id, plan.row.id)),
          clearBatchGuards(db, execution),
        ]);
        return d1BuyerQuoteView(
          db,
          (results[results.length - 2] as QuoteRow[])[0]!,
        );
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          await assertD1BuyerScope(db, buyer);
          throw conflict(
            "The quote or shop changed while it was being prepared. Try again.",
            ["open_latest"],
          );
        }
        throw error;
      }
    },
    async cancelQuote(
      buyer: BuyerPrincipal,
      input: { quoteId: string; revision: number },
    ): Promise<BuyerQuoteView> {
      const [row] = await db
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.id, input.quoteId),
            eq(quote.buyerSessionId, buyer.buyerSessionId),
            eq(quote.sellerId, buyer.sellerId),
          ),
        );
      if (!row) throw notFound("quote");
      if (row.revision !== input.revision)
        throw conflict("This quote changed. Review the latest version.", [
          "open_latest",
        ]);
      if (!(OPEN as readonly string[]).includes(row.status))
        throw conflict("This quote can no longer be cancelled here.", [
          "check_payment",
        ]);
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:cancel`,
            sql`${buyerScope(buyer)} and exists(select 1 from quote where id=${row.id} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId} and revision=${input.revision} and status=${row.status})`,
          ),
          db
            .update(quote)
            .set({ status: "cancelled" })
            .where(eq(quote.id, row.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "buyer",
              actorId: buyer.buyerSessionId,
              operation: "quote.cancel",
              targetType: "quote",
              targetId: row.id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return d1BuyerQuoteView(db, rows[0]!);
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          await assertD1BuyerScope(db, buyer);
          throw conflict("This quote changed. Review the latest version.", [
            "open_latest",
          ]);
        }
        throw error;
      }
    },
    async declineQuote(
      owner: OwnerPrincipal,
      input: { quoteId: string; expectedRevision: number; reason: string },
    ): Promise<QuoteRow> {
      const reason = input.reason.trim();
      if (reason.length < 3 || reason.length > 500)
        throw invalid("Give the buyer a short reason (3 to 500 characters).");
      const [row] = await db
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.id, input.quoteId),
            eq(quote.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!row) throw notFound("quote");
      if (row.revision !== input.expectedRevision)
        throw conflict(
          "This quote changed after you opened it. Review it again.",
        );
      if (effectiveStatus(row) !== "seller_review")
        throw conflict("This quote is not waiting for your review.");
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:decline`,
            sql`${ownerScope(owner)} and exists(select 1 from quote where id=${row.id} and seller_id=${owner.sellerId} and revision=${input.expectedRevision} and status='seller_review' and expires_at>cast(unixepoch('subsecond')*1000 as integer))`,
          ),
          db
            .update(quote)
            .set({
              status: "cancelled",
              reviewReason: `Declined by the seller: ${reason}`,
            })
            .where(eq(quote.id, row.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "quote.decline",
              targetType: "quote",
              targetId: row.id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This quote changed after you opened it. Review it again.",
          );
        throw error;
      }
    },
    async listQuotesAwaitingReview(owner: OwnerPrincipal): Promise<QuoteRow[]> {
      const rows = await db
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.sellerId, owner.sellerId),
            inArray(quote.status, ["seller_review"]),
            ownerScope(owner),
          ),
        )
        .orderBy(desc(quote.createdAt))
        .limit(100);
      return rows.filter((row) => effectiveStatus(row) === "seller_review");
    },
  };
}
