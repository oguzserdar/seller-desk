import { randomToken, sha256Hex } from "@/server/crypto";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  buyerCapability,
  buyerHandoff,
  buyerSession,
  seller,
} from "@/server/db/sqlite/schema";
import type { IssuedCapability } from "@/server/domain/buyer-session";
import { DomainError } from "@/server/domain/errors";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
} from "./guards";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
function ended() {
  return new DomainError(
    "unauthorized",
    "Your chat session has ended. Start a new chat to continue.",
    ["start_session"],
  );
}
function expired() {
  return new DomainError(
    "unauthorized",
    "This checkout link has expired or was already used. Go back to the chat and choose Continue to checkout again.",
    ["start_session"],
  );
}

/** Native D1 buyer capabilities and one-time handoffs; only hashes are persisted. */
export function createD1BuyerSessionStorage(db: D1Db) {
  return {
    async startBuyerSession(
      entry: "page" | "widget",
    ): Promise<IssuedCapability> {
      const [shop] = await db.select({ id: seller.id }).from(seller).limit(1);
      if (!shop)
        throw new DomainError("unavailable", "This shop is not set up yet.");
      const token = randomToken(),
        id = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
      await db.batch([
        db
          .insert(buyerSession)
          .values({ id, sellerId: shop.id, entry, expiresAt }),
        db
          .insert(buyerCapability)
          .values({
            buyerSessionId: id,
            capabilityHash: sha256Hex(token),
            issuedVia: "start",
            expiresAt,
          }),
      ]);
      return { token, buyerSessionId: id, expiresAt: expiresAt.toISOString() };
    },
    async resolveBuyer(
      token: string | null | undefined,
    ): Promise<BuyerPrincipal> {
      if (!token || !TOKEN_PATTERN.test(token)) throw ended();
      const now = new Date();
      const [row] = await db
        .select({
          buyerSessionId: buyerSession.id,
          sellerId: buyerSession.sellerId,
        })
        .from(buyerCapability)
        .innerJoin(
          buyerSession,
          eq(buyerSession.id, buyerCapability.buyerSessionId),
        )
        .where(
          and(
            eq(buyerCapability.capabilityHash, sha256Hex(token)),
            isNull(buyerCapability.revokedAt),
            gt(buyerCapability.expiresAt, now),
            isNull(buyerSession.revokedAt),
            gt(buyerSession.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) throw ended();
      return { kind: "buyer", ...row };
    },
    async endBuyerSession(buyer: BuyerPrincipal): Promise<void> {
      await db
        .update(buyerSession)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(buyerSession.id, buyer.buyerSessionId),
            eq(buyerSession.sellerId, buyer.sellerId),
          ),
        );
    },
    async createHandoff(
      buyer: BuyerPrincipal,
      quoteId: string | null,
    ): Promise<{ code: string }> {
      const code = randomToken(24),
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:handoff`,
            sql`${buyerScope(buyer)} and ${quoteId ? sql`exists(select 1 from quote where id=${quoteId} and buyer_session_id=${buyer.buyerSessionId} and seller_id=${buyer.sellerId})` : sql`1`}`,
          ),
          db
            .insert(buyerHandoff)
            .values({
              buyerSessionId: buyer.buyerSessionId,
              codeHash: sha256Hex(code),
              quoteId,
              expiresAt: new Date(Date.now() + 120_000),
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error)) throw ended();
        throw error;
      }
      return { code };
    },
    async exchangeHandoff(
      code: string,
    ): Promise<IssuedCapability & { quoteId: string | null }> {
      if (!TOKEN_PATTERN.test(code)) throw expired();
      const [row] = await db
        .select({ handoff: buyerHandoff, session: buyerSession })
        .from(buyerHandoff)
        .innerJoin(
          buyerSession,
          eq(buyerSession.id, buyerHandoff.buyerSessionId),
        )
        .where(eq(buyerHandoff.codeHash, sha256Hex(code)));
      if (
        !row ||
        row.handoff.usedAt ||
        row.handoff.expiresAt <= new Date() ||
        row.session.revokedAt ||
        row.session.expiresAt <= new Date()
      )
        throw expired();
      const execution = crypto.randomUUID(),
        token = randomToken();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:exchange`,
            sql`exists(select 1 from buyer_handoff h join buyer_session s on s.id=h.buyer_session_id where h.id=${row.handoff.id} and h.code_hash=${sha256Hex(code)} and h.used_at is null and h.expires_at>${nowMilliseconds} and s.revoked_at is null and s.expires_at>${nowMilliseconds} and s.expires_at=${row.session.expiresAt.getTime()})`,
          ),
          db
            .update(buyerHandoff)
            .set({ usedAt: new Date() })
            .where(eq(buyerHandoff.id, row.handoff.id)),
          db
            .insert(buyerCapability)
            .values({
              buyerSessionId: row.session.id,
              capabilityHash: sha256Hex(token),
              issuedVia: "handoff",
              expiresAt: row.session.expiresAt,
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error)) throw expired();
        throw error;
      }
      return {
        token,
        buyerSessionId: row.session.id,
        expiresAt: row.session.expiresAt.toISOString(),
        quoteId: row.handoff.quoteId,
      };
    },
  };
}
