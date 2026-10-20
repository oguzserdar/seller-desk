import {
  FIXTURE_SIGNATURE_HEADER,
  normalizeFixtureOrder,
  signFixtureWebhook,
  type FixtureFaultName,
} from "@/fixtures/paypal-fixture";
import { fromProviderValue } from "@/lib/money";
import { hashPayload, randomToken, secretsMatch } from "@/server/crypto";
import { fixtureFault, fixtureProviderOrder } from "@/server/db/sqlite/schema";
import {
  TransportRejectedError,
  TransportUncertainError,
  type PayPalTransport,
} from "@/server/paypal/types";
import { and, eq } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  takeD1CaptureFault,
  takeD1EvidenceFaults,
  takeD1Fault,
} from "./fixture-fault";

/** Native durable payment simulator controls, reachable only in explicit fixture mode. */
export function createD1FixtureStore(db: D1Db) {
  return {
    async armFault(name: FixtureFaultName, times = 1) {
      await db
        .insert(fixtureFault)
        .values({ name, remaining: times })
        .onConflictDoUpdate({
          target: fixtureFault.name,
          set: { remaining: times },
        });
    },
    async clearFaults() {
      await db.delete(fixtureFault);
    },
    takeFault: (name: FixtureFaultName) => takeD1Fault(db, name),
    async readFixtureOrder(id: string) {
      return (
        (
          await db
            .select()
            .from(fixtureProviderOrder)
            .where(eq(fixtureProviderOrder.id, id))
        )[0] ?? null
      );
    },
    async decideFixtureOrder(id: string, decision: "approve" | "cancel") {
      if (decision === "approve")
        await db
          .update(fixtureProviderOrder)
          .set({
            status: "APPROVED",
            approvedAt: new Date(),
            payerName: "Fixture Buyer",
            payerEmail: "buyer@example.test",
          })
          .where(
            and(
              eq(fixtureProviderOrder.id, id),
              eq(fixtureProviderOrder.status, "PAYER_ACTION_REQUIRED"),
            ),
          );
      return (
        (
          await db
            .select()
            .from(fixtureProviderOrder)
            .where(eq(fixtureProviderOrder.id, id))
        )[0] ?? null
      );
    },
    async settleFixtureCapture(id: string, outcome: "COMPLETED" | "DECLINED") {
      await db
        .update(fixtureProviderOrder)
        .set({ captureStatus: outcome })
        .where(
          and(
            eq(fixtureProviderOrder.id, id),
            eq(fixtureProviderOrder.captureStatus, "PENDING"),
          ),
        );
    },
  };
}

/** Uses real D1 records for simulator idempotency, approval, capture and recovery. Never selected for sandbox mode. */
export function createD1FixtureTransport(
  db: D1Db,
  options: { appUrl: string; secret: string },
): PayPalTransport {
  const { appUrl, secret } = options;
  const load = async (id: string) => {
    const [row] = await db
      .select()
      .from(fixtureProviderOrder)
      .where(eq(fixtureProviderOrder.id, id));
    if (!row)
      throw new TransportRejectedError(
        "Order not found",
        404,
        "RESOURCE_NOT_FOUND",
      );
    return row;
  };
  const aborted = (signal?: AbortSignal) => {
    if (signal?.aborted)
      throw new TransportUncertainError("Fixture: recovery stopped", "aborted");
  };
  return {
    environment: "fixture",
    approvalHosts: [new URL(appUrl).host],
    async createOrder(request, signal) {
      aborted(signal);
      if (await takeD1Fault(db, "create_lost_before_effect"))
        throw new TransportUncertainError(
          "Fixture: create response lost before PayPal acted",
          "timeout",
        );
      const requestHash = hashPayload(request);
      const [existing] = await db
        .select()
        .from(fixtureProviderOrder)
        .where(eq(fixtureProviderOrder.requestId, request.requestId));
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new TransportRejectedError(
            "Request id reused with a different payload",
            422,
            "IDEMPOTENCY_MISMATCH",
          );
        return normalizeFixtureOrder(existing, appUrl);
      }
      const amountMinor = fromProviderValue(
        request.amount.value,
        request.amount.currency,
      );
      if (amountMinor === null || amountMinor <= 0)
        throw new TransportRejectedError(
          "Invalid amount",
          422,
          "INVALID_PARAMETER_VALUE",
        );
      const inserted = await db
        .insert(fixtureProviderOrder)
        .values({
          id: `FX${randomToken(9).replace(/[-_]/g, "0").toUpperCase().slice(0, 15)}`,
          requestId: request.requestId,
          requestHash,
          status: "PAYER_ACTION_REQUIRED",
          referenceId: request.referenceId,
          amountMinor,
          currency: request.amount.currency,
          payeeMerchantId: request.payeeMerchantId,
          returnUrl: request.returnUrl,
          cancelUrl: request.cancelUrl,
        })
        .onConflictDoNothing()
        .returning();
      const created =
        inserted[0] ??
        (
          await db
            .select()
            .from(fixtureProviderOrder)
            .where(eq(fixtureProviderOrder.requestId, request.requestId))
        )[0];
      if (!created) throw new Error("fixture order insert returned nothing");
      if (created.requestHash !== requestHash)
        throw new TransportRejectedError(
          "Request id reused with a different payload",
          422,
          "IDEMPOTENCY_MISMATCH",
        );
      if (
        inserted.length &&
        (await takeD1Fault(db, "create_lost_after_effect"))
      )
        throw new TransportUncertainError(
          "Fixture: create response lost after PayPal acted",
          "timeout",
        );
      return normalizeFixtureOrder(created, appUrl);
    },
    async getOrder(id, signal) {
      aborted(signal);
      if (await takeD1Fault(db, "read_unavailable"))
        throw new TransportUncertainError(
          "Fixture: PayPal read unavailable",
          "server",
        );
      const row = await load(id),
        faults = await takeD1EvidenceFaults(db),
        amount = faults.has("evidence_wrong_amount"),
        payee = faults.has("evidence_wrong_payee");
      return normalizeFixtureOrder(row, appUrl, { amount, payee });
    },
    async captureOrder(id, requestId, signal) {
      aborted(signal);
      if (await takeD1Fault(db, "capture_lost_before_effect"))
        throw new TransportUncertainError(
          "Fixture: capture response lost before PayPal acted",
          "timeout",
        );
      const row = await load(id);
      if (row.status === "COMPLETED") {
        if (row.captureRequestId === requestId)
          return normalizeFixtureOrder(row, appUrl);
        throw new TransportRejectedError(
          "Order already captured",
          422,
          "ORDER_ALREADY_CAPTURED",
        );
      }
      if (row.status !== "APPROVED")
        throw new TransportRejectedError(
          "Payer has not approved",
          422,
          "ORDER_NOT_APPROVED",
        );
      const captureFault = await takeD1CaptureFault(db);
      if (captureFault === "capture_declined")
        throw new TransportRejectedError(
          "Instrument declined",
          422,
          "INSTRUMENT_DECLINED",
        );
      const pending = captureFault === "capture_pending";
      const [updated] = await db
        .update(fixtureProviderOrder)
        .set({
          status: "COMPLETED",
          captureId: `FXC${randomToken(9).replace(/[-_]/g, "0").toUpperCase().slice(0, 14)}`,
          captureStatus: pending ? "PENDING" : "COMPLETED",
          captureRequestId: requestId,
          captureAmountMinor: row.amountMinor,
          capturedAt: new Date(),
        })
        .where(
          and(
            eq(fixtureProviderOrder.id, id),
            eq(fixtureProviderOrder.status, "APPROVED"),
          ),
        )
        .returning();
      const result = updated ?? (await load(id));
      if (result.captureRequestId !== requestId)
        throw new TransportRejectedError(
          "Order already captured",
          422,
          "ORDER_ALREADY_CAPTURED",
        );
      if (await takeD1Fault(db, "capture_lost_after_effect"))
        throw new TransportUncertainError(
          "Fixture: capture response lost after PayPal acted",
          "timeout",
        );
      return normalizeFixtureOrder(result, appUrl);
    },
    async verifyWebhook({ headers, rawBody }) {
      const received = headers.get(FIXTURE_SIGNATURE_HEADER);
      return Boolean(
        received && secretsMatch(received, signFixtureWebhook(rawBody, secret)),
      );
    },
  };
}
