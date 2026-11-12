/**
 * @fileoverview The owner's "let connected AI apps answer customers" setting on PostgreSQL.
 * @module tests/integration/connector-settings-postgres
 *
 * The D1 path is covered by ai-connector.test.ts. This file covers the PostgreSQL path of
 * src/server/domain/connector-settings.ts against the migrated test database:
 * - the setting starts off (the migration's column default)
 * - turning it on and off is read back and audited
 */
import { asc, inArray } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditEvent } from "@/server/db/schema";
import { connectorMayAnswer, setConnectorMayAnswer } from "@/server/domain/connector-settings";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getStorage } from "@/server/storage";
import { resetShop } from "../support/shop";

let owner: OwnerPrincipal;

beforeEach(async () => {
  ({ owner } = await resetShop());
});

it("starts off, saves on and off, and audits each change on PostgreSQL", async () => {
  expect(getStorage().kind).not.toBe("d1");
  expect(await connectorMayAnswer()).toBe(false);

  await setConnectorMayAnswer(owner, true);
  expect(await connectorMayAnswer()).toBe(true);

  await setConnectorMayAnswer(owner, false);
  expect(await connectorMayAnswer()).toBe(false);

  const audits = await getDb()
    .select({ operation: auditEvent.operation, actorId: auditEvent.actorId, outcome: auditEvent.outcome })
    .from(auditEvent)
    .where(inArray(auditEvent.operation, ["allow_connector_answers", "stop_connector_answers"]))
    .orderBy(asc(auditEvent.createdAt));
  expect(audits).toEqual([
    { operation: "allow_connector_answers", actorId: owner.userId, outcome: "ok" },
    { operation: "stop_connector_answers", actorId: owner.userId, outcome: "ok" },
  ]);
});
