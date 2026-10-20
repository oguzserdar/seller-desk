/**
 * Fixture PayPal: a deterministic stand-in for PayPal's own records, used only
 * when APP_MODE=fixture. It is not a fallback for the sandbox transport.
 *
 * It keeps PayPal's observable contract for this app: idempotent create and
 * capture by request id, approval before capture, ORDER_ALREADY_CAPTURED on a
 * second capture, and independent reads. Faults are injected by
 * `pnpm fixture:fault` or test helpers, never by a public route.
 */
import { fromProviderValue, toProviderValue } from "@/lib/money";
import { hashPayload, randomToken, secretsMatch } from "@/server/crypto";
import { type Db, transaction } from "@/server/db/client";
import { fixtureFault, fixtureProviderOrder } from "@/server/db/schema";
import {
  type CreateOrderRequest,
  type PayPalTransport,
  type ProviderOrder,
  TransportRejectedError,
  TransportUncertainError,
} from "@/server/paypal/types";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";

export const FIXTURE_FAULTS = [
  "create_lost_before_effect",
  "create_lost_after_effect",
  "capture_lost_before_effect",
  "capture_lost_after_effect",
  "capture_pending",
  "capture_declined",
  "evidence_wrong_amount",
  "evidence_wrong_payee",
  "read_unavailable",
  "access_storage_error",
] as const;
export type FixtureFaultName = (typeof FIXTURE_FAULTS)[number];

export const FIXTURE_MERCHANT_ID = "FIXTUREMERCHANT01";
export const FIXTURE_SIGNATURE_HEADER = "x-fixture-signature";

type FixtureRow = typeof fixtureProviderOrder.$inferSelect;

/** Consumes one charge of a fault. Returns true when the fault should fire now. */
export async function takeFault(
  db: Db,
  name: FixtureFaultName,
): Promise<boolean> {
  const rows = await db
    .update(fixtureFault)
    .set({ remaining: sql`${fixtureFault.remaining} - 1` })
    .where(and(eq(fixtureFault.name, name), gt(fixtureFault.remaining, 0)))
    .returning({ name: fixtureFault.name });
  return rows.length > 0;
}

/** Arms a fault for the next `times` matching calls (test helper and CLI). */
export async function armFault(
  db: Db,
  name: FixtureFaultName,
  times = 1,
): Promise<void> {
  await db
    .insert(fixtureFault)
    .values({ name, remaining: times })
    .onConflictDoUpdate({
      target: fixtureFault.name,
      set: { remaining: times },
    });
}

export async function clearFaults(db: Db): Promise<void> {
  await db.delete(fixtureFault);
}

function webhookKey(secret: string): string {
  return createHmac("sha256", secret)
    .update("seller-desk-fixture-webhook")
    .digest("hex");
}

/** Signs a fixture webhook body the way the fixture transport verifies it (tests and CLI). */
export function signFixtureWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", webhookKey(secret)).update(rawBody).digest("hex");
}

/** Normalizes native simulator records into the same external provider contract. */
export function normalizeFixtureOrder(
  row: FixtureRow,
  appUrl: string,
  tamper: { amount?: boolean; payee?: boolean } = {},
): ProviderOrder {
  const value = toProviderValue(row.amountMinor, row.currency);
  const captureValue =
    row.captureAmountMinor === null
      ? null
      : toProviderValue(
          row.captureAmountMinor + (tamper.amount ? 100 : 0),
          row.currency,
        );
  return {
    environment: "fixture",
    id: row.id,
    status: row.status,
    approvalUrl:
      row.status === "PAYER_ACTION_REQUIRED"
        ? `${appUrl}/fixture/paypal/${row.id}`
        : null,
    referenceId: row.referenceId,
    customId: null,
    amount: { value, currency: row.currency },
    payeeMerchantId: tamper.payee ? "SOMEONEELSE00001" : row.payeeMerchantId,
    capture:
      row.captureId && row.captureStatus
        ? {
            id: row.captureId,
            status: row.captureStatus,
            amount:
              captureValue === null
                ? null
                : { value: captureValue, currency: row.currency },
            finalCapture: true,
          }
        : null,
    payer: { name: row.payerName, email: row.payerEmail },
  };
}

export function createFixtureTransport(
  db: Db,
  options: { appUrl: string; secret: string },
): PayPalTransport {
  const { appUrl, secret } = options;

  async function load(orderId: string): Promise<FixtureRow> {
    const [row] = await db
      .select()
      .from(fixtureProviderOrder)
      .where(eq(fixtureProviderOrder.id, orderId));
    if (!row)
      throw new TransportRejectedError(
        "Order not found",
        404,
        "RESOURCE_NOT_FOUND",
      );
    return row;
  }

  return {
    environment: "fixture",
    approvalHosts: [new URL(appUrl).host],

    async createOrder(request: CreateOrderRequest, signal?: AbortSignal) {
      if (signal?.aborted)
        throw new TransportUncertainError(
          "Fixture: recovery stopped",
          "aborted",
        );
      if (await takeFault(db, "create_lost_before_effect")) {
        throw new TransportUncertainError(
          "Fixture: create response lost before PayPal acted",
          "timeout",
        );
      }
      const requestHash = hashPayload(request);
      const [existing] = await db
        .select()
        .from(fixtureProviderOrder)
        .where(eq(fixtureProviderOrder.requestId, request.requestId));
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new TransportRejectedError(
            "Request id reused with a different payload",
            422,
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return normalizeFixtureOrder(existing, appUrl);
      }
      const amountMinor = fromProviderValue(
        request.amount.value,
        request.amount.currency,
      );
      if (amountMinor === null || amountMinor <= 0) {
        throw new TransportRejectedError(
          "Invalid amount",
          422,
          "INVALID_PARAMETER_VALUE",
        );
      }
      const [created] = await db
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
        .returning();
      if (!created) throw new Error("fixture order insert returned nothing");
      if (await takeFault(db, "create_lost_after_effect")) {
        throw new TransportUncertainError(
          "Fixture: create response lost after PayPal acted",
          "timeout",
        );
      }
      return normalizeFixtureOrder(created, appUrl);
    },

    async getOrder(orderId: string, signal?: AbortSignal) {
      if (signal?.aborted)
        throw new TransportUncertainError(
          "Fixture: recovery stopped",
          "aborted",
        );
      if (await takeFault(db, "read_unavailable")) {
        throw new TransportUncertainError(
          "Fixture: PayPal read unavailable",
          "server",
        );
      }
      const row = await load(orderId);
      const amount = await takeFault(db, "evidence_wrong_amount");
      const payee = await takeFault(db, "evidence_wrong_payee");
      return normalizeFixtureOrder(row, appUrl, { amount, payee });
    },

    async captureOrder(
      orderId: string,
      requestId: string,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted)
        throw new TransportUncertainError(
          "Fixture: recovery stopped",
          "aborted",
        );
      if (await takeFault(db, "capture_lost_before_effect")) {
        throw new TransportUncertainError(
          "Fixture: capture response lost before PayPal acted",
          "timeout",
        );
      }
      const result = await transaction(db, async (tx) => {
        const [row] = await tx
          .select()
          .from(fixtureProviderOrder)
          .where(eq(fixtureProviderOrder.id, orderId))
          .for("update");
        if (!row)
          throw new TransportRejectedError(
            "Order not found",
            404,
            "RESOURCE_NOT_FOUND",
          );
        if (row.status === "COMPLETED") {
          if (row.captureRequestId === requestId) return row;
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
        const declined = await takeFault(db, "capture_declined");
        if (declined)
          throw new TransportRejectedError(
            "Instrument declined",
            422,
            "INSTRUMENT_DECLINED",
          );
        const pending = await takeFault(db, "capture_pending");
        const [updated] = await tx
          .update(fixtureProviderOrder)
          .set({
            status: "COMPLETED",
            captureId: `FXC${randomToken(9).replace(/[-_]/g, "0").toUpperCase().slice(0, 14)}`,
            captureStatus: pending ? "PENDING" : "COMPLETED",
            captureRequestId: requestId,
            captureAmountMinor: row.amountMinor,
            capturedAt: new Date(),
          })
          .where(eq(fixtureProviderOrder.id, orderId))
          .returning();
        return updated as FixtureRow;
      });
      if (await takeFault(db, "capture_lost_after_effect")) {
        throw new TransportUncertainError(
          "Fixture: capture response lost after PayPal acted",
          "timeout",
        );
      }
      return normalizeFixtureOrder(result, appUrl);
    },

    async verifyWebhook({ headers, rawBody }) {
      const received = headers.get(FIXTURE_SIGNATURE_HEADER);
      if (!received) return false;
      return secretsMatch(received, signFixtureWebhook(rawBody, secret));
    },
  };
}

/** The fixture "PayPal approval page" action: the payer approves or cancels. */
export async function decideFixtureOrder(
  db: Db,
  orderId: string,
  decision: "approve" | "cancel",
): Promise<FixtureRow | null> {
  return transaction(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(fixtureProviderOrder)
      .where(eq(fixtureProviderOrder.id, orderId))
      .for("update");
    if (!row) return null;
    if (row.status !== "PAYER_ACTION_REQUIRED" || decision === "cancel")
      return row;
    const [updated] = await tx
      .update(fixtureProviderOrder)
      .set({
        status: "APPROVED",
        approvedAt: new Date(),
        payerName: "Fixture Buyer",
        payerEmail: "buyer@example.test",
      })
      .where(eq(fixtureProviderOrder.id, orderId))
      .returning();
    return updated ?? null;
  });
}

/** Simulates PayPal finishing a pending capture (CLI and tests). */
export async function settleFixtureCapture(
  db: Db,
  orderId: string,
  outcome: "COMPLETED" | "DECLINED",
): Promise<void> {
  await db
    .update(fixtureProviderOrder)
    .set({ captureStatus: outcome })
    .where(
      and(
        eq(fixtureProviderOrder.id, orderId),
        eq(fixtureProviderOrder.captureStatus, "PENDING"),
      ),
    );
}

export async function readFixtureOrder(
  db: Db,
  orderId: string,
): Promise<FixtureRow | null> {
  const [row] = await db
    .select()
    .from(fixtureProviderOrder)
    .where(eq(fixtureProviderOrder.id, orderId));
  return row ?? null;
}
