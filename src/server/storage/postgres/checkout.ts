import { and, eq, inArray, sql } from "drizzle-orm";
import { transaction, type Db } from "@/server/db/client";
import { offer, paymentAttempt, quote, reservation, seller } from "@/server/db/schema";
import { hashPayload } from "@/server/crypto";
import { assertAssistantTurn } from "@/server/domain/assistant-turn";
import { recordAudit } from "@/server/domain/audit";
import { conflict, DomainError, notFound } from "@/server/domain/errors";
import { assertQuotePriced } from "@/server/domain/priced-quote";
import { effectiveStatus } from "@/server/domain/quotes";
import { buildCreateRequest } from "@/server/payments/create-request";
import type { CheckoutStorage } from "../checkout";

/** Retains PostgreSQL row locks and commits the entire checkout intent atomically. */
export function createPostgresCheckoutStorage(db: Db): CheckoutStorage {
  return { async holdAndRecord(buyer, input, context) {
    return transaction(db, async (tx) => {
      await assertAssistantTurn(buyer, tx, true);
      const [quoteRow] = await tx
        .select()
        .from(quote)
        .where(and(eq(quote.id, input.quoteId), eq(quote.buyerSessionId, buyer.buyerSessionId), eq(quote.sellerId, buyer.sellerId)))
        .for("update");
      if (!quoteRow) throw notFound("quote");
      const [existing] = await tx.select({ id: paymentAttempt.id }).from(paymentAttempt).where(eq(paymentAttempt.quoteId, quoteRow.id));
      if (existing) return existing.id;
      if (quoteRow.revision !== input.revision) throw conflict("This quote changed. Review the latest version before paying.", ["open_latest"]);
      const [newer] = await tx
        .select({ id: quote.id })
        .from(quote)
        .where(and(eq(quote.threadId, quoteRow.threadId), sql`${quote.revision} > ${quoteRow.revision}`))
        .limit(1);
      if (newer) throw conflict("There is a newer version of this quote. Review it before paying.", ["open_latest"]);
      const status = effectiveStatus(quoteRow);
      if (status === "expired") throw new DomainError("expired", "This quote expired. Ask for a fresh quote; prices are checked again.", ["requote"]);
      if (status !== "review_ready") throw conflict("This quote is not ready for payment yet.", ["revise"]);

      assertQuotePriced(quoteRow);
      // Terms and catalog edits must wait until the validated checkout intent commits.
      const [sellerRow] = await tx.select().from(seller).where(eq(seller.id, buyer.sellerId)).for("share");
      if (!sellerRow) throw notFound("shop");
      if (sellerRow.policyRevision !== quoteRow.policySnapshot.policyRevision) {
        throw conflict("The seller updated their terms after this quote. Ask for an updated quote.", ["requote"]);
      }
      const offerRows = await tx.select().from(offer)
        .where(and(eq(offer.sellerId, sellerRow.id), inArray(offer.id, quoteRow.lines.map((line) => line.offerId))))
        .orderBy(offer.id).for("share");
      for (const line of quoteRow.lines) {
        const current = offerRows.find((row) => row.id === line.offerId);
        if (!current || !current.published || current.revision !== line.offerRevision || (current.unitAmountMinor !== null && current.unitAmountMinor !== line.unitAmountMinor)) {
          throw conflict(`${line.title} changed after this quote. Ask for an updated quote.`, ["requote"]);
        }
        if (current.unitAmountMinor === null && (current.kind !== "service" || !current.requiresScopeReview || !quoteRow.sellerApprovedAt || !quoteRow.approvedScope)) {
          throw conflict("This custom service needs the seller's price and scope before payment.", ["requote"]);
        }
      }

      const holdUntil = new Date(Date.now() + sellerRow.holdTtlMinutes * 60_000);
      // Cart order must not reverse the order of competing inventory locks.
      const goods = quoteRow.lines.filter((line) => line.kind === "goods")
        .sort((a, b) => a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0);
      for (const line of goods) {
        const held = await tx.execute(sql`
          update inventory set held = held + ${line.quantity}, updated_at = now()
          where offer_id = ${line.offerId} and total - held - sold >= ${line.quantity}
          returning offer_id`);
        if (held.rows.length === 0) {
          throw new DomainError("sold_out", `${line.title} just sold out. You have not been charged.`, ["requote"]);
        }
        await tx.insert(reservation).values({
          offerId: line.offerId,
          quoteId: quoteRow.id,
          quantity: line.quantity,
          state: "held",
          expiresAt: holdUntil,
        });
      }
      await tx.update(quote).set({ status: "accepted", acceptedAt: new Date() }).where(eq(quote.id, quoteRow.id));

      const id = crypto.randomUUID();
      const createRequestId = crypto.randomUUID();
      const request = buildCreateRequest({
        attemptId: id,
        createRequestId,
        quoteRow,
        amountMinor: quoteRow.totalMinor,
        currency: quoteRow.currency,
        payeeMerchantId: context.payeeMerchantId,
        appUrl: context.appUrl,
      });
      await tx.insert(paymentAttempt).values({
        id,
        sellerId: sellerRow.id,
        quoteId: quoteRow.id,
        environment: context.environment,
        state: "planned",
        createRequestId,
        createRequestHash: hashPayload(request),
        captureRequestId: crypto.randomUUID(),
        amountMinor: quoteRow.totalMinor,
        currency: quoteRow.currency,
        payeeMerchantId: context.payeeMerchantId,
        nextCheckAt: new Date(Date.now() + 60_000),
      });
      await recordAudit(tx, {
        actor: "buyer",
        actorId: buyer.buyerSessionId,
        operation: "checkout.start",
        targetType: "payment_attempt",
        targetId: id,
        outcome: "ok",
        details: { quoteId: quoteRow.id, revision: quoteRow.revision, totalMinor: quoteRow.totalMinor },
      });
      return id;
    });
  } };
}
