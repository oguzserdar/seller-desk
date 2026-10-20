import { getEffectiveConfig } from "@/server/effective-config";
import { getStorage } from "@/server/storage";
import type { ReadinessFacts } from "@/server/storage/readiness";
/**
 * Installation readiness, one check per part. "Fixture ready" and "Ready for
 * sandbox checkout" are different results; neither is shown unless every
 * required part passes.
 */
import { parseOriginList } from "@/lib/origin";
import { aiSetupKey } from "@/server/ai/setup-check";
import { getDb } from "@/server/db/client";
import { installation, offer, orders } from "@/server/db/schema";
import { getServerConfig } from "@/server/env";
import { and, count, eq } from "drizzle-orm";
import type { SellerRow } from "./seller";

/** One installation check, with configuration kept separate from executed proof. */
export type ReadinessCheck = {
  key:
    | "database"
    | "owner"
    | "offers"
    | "policies"
    | "ai"
    | "paypal"
    | "widget"
    | "purchase";
  label: string;
  state: "pass" | "fail" | "fixture" | "pending" | "configured";
  detail: string;
  fix?: { label: string; href: string };
  /** A live check the owner can run from this row. */
  action?: "check_model";
};

/** Setup summary derived from the current configuration and recorded local evidence. */
export type Readiness = {
  mode: "fixture" | "sandbox";
  checks: ReadinessCheck[];
  summary: {
    state: "fixture_ready" | "sandbox_ready" | "not_ready";
    label: string;
    blocking: number;
  };
};

const CHECKED = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Reads setup evidence for the authenticated owner's shop. */
export async function getReadiness(sellerRow: SellerRow): Promise<Readiness> {
  const config = await getEffectiveConfig();
  const { installed, published, paid, databaseLabel } = await readinessFacts(
    sellerRow.id,
  );
  const checks: ReadinessCheck[] = [];
  checks.push(
    installed?.environment === config.mode
      ? {
          key: "database",
          label: "Database",
          state: "pass",
          detail: `${databaseLabel} connected and set up for ${config.mode} data.`,
        }
      : {
          key: "database",
          label: "Database",
          state: "fail",
          detail:
            "This database was set up for a different mode. Use separate databases for fixture and sandbox.",
        },
  );
  checks.push({
    key: "owner",
    label: "Owner account",
    state: "pass",
    detail: `Signed in as the owner of ${sellerRow.displayName}.`,
  });

  checks.push(
    published > 0
      ? {
          key: "offers",
          label: "Published offers",
          state: "pass",
          detail: `${published} offer${published === 1 ? "" : "s"} visible to buyers.`,
        }
      : {
          key: "offers",
          label: "Published offers",
          state: "fail",
          detail: "Buyers see nothing until you publish an offer.",
          fix: { label: "Add offers", href: "/owner/offers" },
        },
  );

  checks.push(
    sellerRow.taxPolicy
      ? {
          key: "policies",
          label: "Terms",
          state: "pass",
          detail:
            "Tax statement set. Each offer type also needs its own terms before it can be published.",
        }
      : {
          key: "policies",
          label: "Terms",
          state: "fail",
          detail: "Add a tax statement; checkout stays paused without one.",
          fix: { label: "Edit terms", href: "/owner/setup#terms" },
        },
  );

  if (config.ai.status === "ready") {
    const checked =
      installed?.aiCheckModel === aiSetupKey(config) ? installed : null;
    checks.push(
      checked?.aiCheckOk && checked.aiCheckedAt
        ? {
            key: "ai",
            label: "AI model",
            state: "pass",
            detail: `Enabled AI connections checked on ${CHECKED.format(checked.aiCheckedAt)}. ${checked.aiCheckDetail}. Conversation quality needs a separate trial.`,
            action: "check_model",
          }
        : checked
          ? {
              key: "ai",
              label: "AI model",
              state: "fail",
              detail: `${config.ai.modelId} did not pass the last connection check: ${checked.aiCheckDetail ?? "try the check again"}`,
              action: "check_model",
            }
          : {
              key: "ai",
              label: "AI model",
              state: "pending",
              detail: `Configured: ${config.ai.modelId} through ${config.ai.provider}. Check every enabled connection, including decision routing and any optional routine model.`,
              action: "check_model",
            },
    );
  } else {
    checks.push({
      key: "ai",
      label: "AI model",
      state: "fail",
      detail: `${config.ai.problem} Buyers can still browse and buy without the assistant.`,
    });
  }

  if (config.paypal.status === "fixture") {
    checks.push({
      key: "paypal",
      label: "PayPal",
      state: "fixture",
      detail: "Approvals and captures are simulated. PayPal is not connected.",
      fix: { label: "Connect sandbox", href: "/owner/setup#paypal" },
    });
  } else if (config.paypal.status === "ready") {
    checks.push({
      key: "paypal",
      label: "PayPal",
      state: "configured",
      detail:
        "Sandbox settings are present. This does not verify the app, webhook delivery or a payment.",
      fix: { label: "Check connection", href: "/owner/setup#paypal" },
    });
  } else {
    checks.push({
      key: "paypal",
      label: "PayPal",
      state: "fail",
      detail: "Finish the sandbox connection to enable checkout.",
      fix: { label: "Get test keys", href: "/owner/setup#paypal" },
    });
  }

  const origins = parseOriginList(sellerRow.allowedOrigins).valid;
  checks.push(
    origins.length > 0
      ? {
          key: "widget",
          label: "Widget website",
          state: "pass",
          detail: `May embed the widget: ${origins.join(", ")}.`,
        }
      : {
          key: "widget",
          label: "Widget website",
          state: "fail",
          detail:
            "Add your website's exact origin to use the widget. The buyer page works without it.",
          fix: { label: "Install", href: "/owner/install" },
        },
  );

  checks.push(
    paid > 0
      ? {
          key: "purchase",
          label: "Test purchase",
          state: config.mode === "fixture" ? "fixture" : "pass",
          detail: `${paid} ${config.mode === "fixture" ? "simulated" : "verified sandbox"} order${paid === 1 ? "" : "s"} on record.`,
        }
      : {
          key: "purchase",
          label: "Test purchase",
          state: "fail",
          detail:
            "Complete one purchase on the buyer page to prove the whole path.",
          fix: { label: "Open the buyer page", href: "/buy" },
        },
  );

  const blocking = checks.filter(
    (check) => check.state === "fail" || check.state === "pending",
  ).length;
  const summary: Readiness["summary"] =
    blocking > 0
      ? {
          state: "not_ready",
          label: `${blocking} item${blocking === 1 ? "" : "s"} to finish`,
          blocking,
        }
      : config.mode === "fixture"
        ? {
            state: "fixture_ready",
            label: "Demo ready (PayPal simulated)",
            blocking,
          }
        : {
            state: "sandbox_ready",
            label: "Ready for sandbox checkout",
            blocking,
          };
  return { mode: config.mode, checks, summary };
}

async function readinessFacts(sellerId: string): Promise<ReadinessFacts> {
  const config = await getEffectiveConfig();
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.setup.readinessFacts(sellerId, config.mode);
  const db = getDb();
  const [installed] = await db.select().from(installation);
  const [published] = await db
    .select({ n: count() })
    .from(offer)
    .where(and(eq(offer.sellerId, sellerId), eq(offer.published, true)));
  const [paid] = await db
    .select({ n: count() })
    .from(orders)
    .where(
      and(eq(orders.sellerId, sellerId), eq(orders.environment, config.mode)),
    );
  return {
    installed,
    published: published?.n ?? 0,
    paid: paid?.n ?? 0,
    databaseLabel: "PostgreSQL",
  };
}
