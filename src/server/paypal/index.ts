/**
 * Selects the PayPal transport for this process from APP_MODE. Fixture mode
 * gets the fixture transport; sandbox mode gets the REST transport or a
 * readiness problem. A missing sandbox credential never selects the fixture.
 */
import {
  createFixtureTransport,
  FIXTURE_MERCHANT_ID,
} from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { getServerConfig } from "@/server/env";
import { getRequestScope } from "@/server/request-scope";
import { createD1FixtureTransport } from "@/server/storage/d1/fixture-paypal";
import { createSandboxTransport } from "./live";
import type { PayPalTransport } from "./types";

/** A configured transport or an explicit setup problem, without a silent fallback. */
export type TransportResolution =
  | { ok: true; transport: PayPalTransport; payeeMerchantId: string }
  | { ok: false; problem: string };

const holder = globalThis as unknown as {
  __sellerDeskTransport?: TransportResolution;
  __sellerDeskTransportOverride?: PayPalTransport;
};

/** Resolves the payment adapter inside the current request on Workers. */
export function getPayPal(): TransportResolution {
  const scope = getRequestScope();
  // Simulations must never inherit a process-global transport, even a test seam.
  if (scope?.simulation) {
    if (!scope.paypal?.ok || scope.paypal.transport.environment !== "fixture")
      throw new Error("Simulation payment isolation is missing.");
    return scope.paypal;
  }
  const override = holder.__sellerDeskTransportOverride;
  if (override) {
    const config = getServerConfig();
    const payee =
      config.paypal.status === "ready"
        ? config.paypal.merchantId
        : FIXTURE_MERCHANT_ID;
    return { ok: true, transport: override, payeeMerchantId: payee };
  }
  const cached = scope ? scope.paypal : holder.__sellerDeskTransport;
  if (cached) return cached;
  const config = getServerConfig();
  let resolved: TransportResolution;
  if (config.mode === "fixture") {
    resolved = {
      ok: true,
      transport: scope?.d1
        ? createD1FixtureTransport(scope.d1, {
            appUrl: config.appUrl,
            secret: config.jobsSecret,
          })
        : createFixtureTransport(getDb(), {
            appUrl: config.appUrl,
            secret: config.jobsSecret,
          }),
      payeeMerchantId: FIXTURE_MERCHANT_ID,
    };
  } else if (config.paypal.status === "ready") {
    resolved = {
      ok: true,
      transport: createSandboxTransport(config.paypal),
      payeeMerchantId: config.paypal.merchantId,
    };
  } else {
    const missing =
      config.paypal.status === "unavailable" ? config.paypal.missing : [];
    resolved = {
      ok: false,
      problem: `PayPal sandbox is not configured (missing ${missing.join(", ")}).`,
    };
  }
  if (scope) scope.paypal = resolved;
  else holder.__sellerDeskTransport = resolved;
  return resolved;
}

/** Test seam: run the real payment engine against a scripted transport. */
export function setTransportForTests(transport: PayPalTransport | null): void {
  holder.__sellerDeskTransportOverride = transport ?? undefined;
  holder.__sellerDeskTransport = undefined;
}
