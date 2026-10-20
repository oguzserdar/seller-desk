import { getDb } from "@/server/db/client";
import { recordAudit, type AuditEntry } from "@/server/domain/audit";
import { getRequestScope } from "@/server/request-scope";
import type { CheckoutStorage } from "./checkout";
import { createD1Storage } from "./d1";
import type { PaymentStorage } from "./payments";
import { createPostgresCheckoutStorage } from "./postgres/checkout";
import { createPostgresPaymentStorage } from "./postgres/payments";
import { createPostgresWebhookStorage } from "./postgres/webhooks";
import type { WebhookStorage } from "./webhooks";

/** Backend selection is explicit; incomplete D1 operations fail instead of touching PostgreSQL. */
export type SellerStorage =
  | {
      kind: "postgres";
      checkout: CheckoutStorage;
      payments: PaymentStorage;
      webhooks: WebhookStorage;
      audit: { record: (entry: AuditEntry) => Promise<void> };
    }
  | ReturnType<typeof createD1Storage>;

/** Resolves only the current installation's native storage and simulation scope. */
export function getStorage(): SellerStorage {
  const scope = getRequestScope();
  if (scope?.d1) return createD1Storage(scope.d1);
  const db = getDb();
  return {
    kind: "postgres",
    checkout: createPostgresCheckoutStorage(db),
    payments: createPostgresPaymentStorage(db),
    webhooks: createPostgresWebhookStorage(db),
    audit: { record: (entry) => recordAudit(db, entry) },
  };
}
