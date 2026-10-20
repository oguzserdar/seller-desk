import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAt, scalarChecks, ts } from "./columns";

/** Fixture provider order records in the D1 dialect. */
export const fixtureProviderOrder = sqliteTable(
  "fixture_provider_order",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    referenceId: text("reference_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    payeeMerchantId: text("payee_merchant_id").notNull(),
    captureId: text("capture_id"),
    captureStatus: text("capture_status"),
    captureRequestId: text("capture_request_id"),
    captureAmountMinor: integer("capture_amount_minor"),
    payerName: text("payer_name"),
    payerEmail: text("payer_email"),
    returnUrl: text("return_url").notNull(),
    cancelUrl: text("cancel_url").notNull(),
    createdAt: createdAt(),
    approvedAt: ts("approved_at"),
    capturedAt: ts("captured_at"),
  },
  (t) => [
    ...scalarChecks("fixture_provider_order", t),
    uniqueIndex("fixture_provider_order_request_key").on(t.requestId),
  ],
);

/** Fixture fault records in the D1 dialect. */
export const fixtureFault = sqliteTable(
  "fixture_fault",
  {
    name: text("name").primaryKey(),
    remaining: integer("remaining").notNull(),
    createdAt: createdAt(),
  },
  (t) => scalarChecks("fixture_fault", t),
);
