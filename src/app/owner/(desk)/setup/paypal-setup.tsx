import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/arc/badge/badge";
import {
  sandboxWebhookUrl,
  PAYPAL_CHECKOUT_EVENTS,
} from "@/server/paypal/connection-check";
import { CopyField } from "../install/copy-field";
import { PayPalCheckButton } from "./paypal-check-button";

const DASHBOARD = "https://developer.paypal.com/dashboard/applications/sandbox";
const GUIDE =
  "https://github.com/paypaldev/getting-started-with-paypal-sandbox";
const SETTINGS = [
  ["PAYPAL_CLIENT_ID", "Client ID from your Sandbox app."],
  ["PAYPAL_CLIENT_SECRET", "Secret from that same app. Keep it private."],
  ["PAYPAL_MERCHANT_ID", "Merchant ID of that app’s sandbox Business account."],
  ["PAYPAL_WEBHOOK_ID", "ID of the webhook you register below."],
] as const;

/** Guides self-hosted owners through test credentials, server configuration and a separate purchase. */
export function PayPalSetup({
  mode,
  appUrl,
  configured,
}: {
  mode: "fixture" | "sandbox";
  appUrl: string;
  configured: boolean;
}) {
  const webhookUrl = sandboxWebhookUrl(appUrl);
  return (
    <section
      id="paypal"
      aria-labelledby="paypal-heading"
      className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 px-5 py-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="paypal-heading" className="text-[22px] font-semibold">
          PayPal payments
        </h2>
        <Badge tone="neutral">
          {mode === "fixture"
            ? "Simulation active"
            : configured
              ? "Sandbox configured"
              : "Not connected"}
        </Badge>
      </div>
      <p className="text-ink-2 mt-2 max-w-2xl text-[15px]">
        {configured
          ? "Your sandbox settings are saved. Check the connection, then try checkout with a test account."
          : "Use PayPal’s free sandbox to try checkout with test money."}
      </p>
      {!configured ? (
        <div className="mt-6">
          <h3 className="text-[17px] font-semibold">Get your test keys</h3>
          <p className="text-ink-2 mt-2 text-[15px]">
            Sign in with your normal PayPal account. Choose{" "}
            <strong>Sandbox</strong>, then open{" "}
            <strong>Default Application</strong> or create an app named Seller
            Desk. You’ll find its <strong>Client ID</strong> and{" "}
            <strong>Secret</strong> there.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <LinkButton href={DASHBOARD} target="_blank" rel="noreferrer">
              Open PayPal sandbox
            </LinkButton>
            <a
              href={GUIDE}
              target="_blank"
              rel="noreferrer"
              className="text-brand inline-flex min-h-11 items-center text-[14px] font-semibold hover:underline"
            >
              PayPal’s setup guide
            </a>
          </div>
        </div>
      ) : null}
      <details className="border-line mt-6 border-y py-1">
        <summary className="min-h-11 cursor-pointer py-3 text-[15px] font-semibold">
          {configured ? "Review server setup" : "Finish server setup"}
        </summary>
        <div className="text-ink-2 space-y-4 pb-5 text-[14px]">
          <p>
            Save these values in your hosting provider’s private environment
            settings. For local development, use an untracked{" "}
            <code>.env.local</code> file; Cloudflare preview uses{" "}
            <code>.dev.vars</code>. Restart or redeploy after changes. Never put
            the Secret in WordPress, the widget or a public repository.
          </p>
          <dl className="divide-line divide-y">
            {SETTINGS.map(([name, description]) => (
              <div key={name} className="py-2.5">
                <dt className="text-ink break-all font-mono text-[13px] font-semibold">
                  {name}
                </dt>
                <dd className="mt-1">{description}</dd>
              </div>
            ))}
          </dl>
          <p>
            Use <code>APP_MODE=sandbox</code> with a separate database. Keep
            your current simulated shop separate. Set <code>APP_URL</code> to
            your hosted HTTPS address on port 443.
          </p>
          <div>
            <h3 className="text-ink text-[15px] font-semibold">
              Register the payment notification address
            </h3>
            <p className="my-2">
              In the same Sandbox app, add a webhook. PayPal sends payment
              updates to this address:
            </p>
            {webhookUrl ? (
              <CopyField
                label="PayPal webhook address"
                value={webhookUrl}
                multiline
              />
            ) : (
              <p className="bg-sunken rounded-[var(--radius-control)] p-3">
                This app is using a local or unsupported address. A hosted HTTPS
                address is needed before PayPal can deliver updates. The
                listener path is <code>/api/paypal/webhook</code>.
              </p>
            )}
            <p className="mt-3">
              Select both events, then save the webhook’s ID as{" "}
              <code>PAYPAL_WEBHOOK_ID</code>:
            </p>
            <ul className="mt-2 list-inside list-disc break-all font-mono text-[12px]">
              {PAYPAL_CHECKOUT_EVENTS.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          </div>
          <p>
            For the Merchant ID, open{" "}
            <strong>Testing Tools → Sandbox Accounts</strong> and find the
            Business account associated with your app. Sign into
            sandbox.paypal.com with that test account, then open{" "}
            <strong>
              Account Settings → Business information → PayPal Merchant ID
            </strong>
            .
          </p>
          <p>
            PayPal’s API guide requires a Business account for testing
            integrations outside the US.{" "}
            <a
              className="text-brand font-semibold hover:underline"
              href="https://developer.paypal.com/api/rest/"
              target="_blank"
              rel="noreferrer"
            >
              Read the account requirements
            </a>
            .
          </p>
        </div>
      </details>
      <div className="mt-5">
        <PayPalCheckButton />
      </div>
      <div className="border-line mt-6 border-t pt-5">
        <h3 className="text-[17px] font-semibold">
          Then make one test purchase
        </h3>
        <p className="text-ink-2 mt-2 text-[15px]">
          Open the customer shop and pay using the Personal test account under{" "}
          <strong>Testing Tools → Sandbox Accounts</strong>. Confirm the payment
          also appears in the sandbox Business account. A successful connection
          check alone does not prove checkout.
        </p>
        <a
          className="text-brand mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold hover:underline"
          href="/buy"
          target="_blank"
          rel="noreferrer"
        >
          Open customer shop
        </a>
      </div>
    </section>
  );
}
