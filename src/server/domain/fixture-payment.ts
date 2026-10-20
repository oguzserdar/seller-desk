import {
  decideFixtureOrder,
  readFixtureOrder,
} from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { getServerConfig } from "@/server/env";
import { getStorage } from "@/server/storage";
/** Simulator page reads are unavailable in sandbox installations. */
export async function readDemoPayment(id: string) {
  if (getServerConfig().mode !== "fixture") return null;
  const backend = getStorage();
  return backend.kind === "d1"
    ? backend.fixture.readFixtureOrder(id)
    : readFixtureOrder(getDb(), id);
}
/** Explicit fictional payer choice; never reaches real PayPal. */
export async function decideDemoPayment(
  id: string,
  decision: "approve" | "cancel",
) {
  if (getServerConfig().mode !== "fixture") return null;
  const backend = getStorage();
  return backend.kind === "d1"
    ? backend.fixture.decideFixtureOrder(id, decision)
    : decideFixtureOrder(getDb(), id, decision);
}
