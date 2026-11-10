import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { parseOriginList } from "@/lib/origin";
import { requireOwner } from "@/server/auth/owner";
import { getServerConfig } from "@/server/env";
import { CopyField } from "./copy-field";
import { searchWooProducts } from "@/server/commerce/woo-products";

export const metadata: Metadata = { title: "Install" };

/** Guide the seller through WordPress first, with other installation paths on demand. */
export default async function InstallPage({ searchParams }: { searchParams: Promise<{ checkStore?: string }> }) {
  const { seller } = await requireOwner(await headers());
  const config = getServerConfig();
  const origins = parseOriginList(seller.allowedOrigins).valid;
  const snippet = `<script src="${config.appUrl}/widget.js" async></script>`;
  const checkStore = (await searchParams).checkStore === "1";
  const storeCheck = config.store && checkStore ? await searchWooProducts(config.store, { search: "", page: 1 }).catch(() => null) : undefined;
  return (
    <section className="mx-auto w-full max-w-4xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="page-title">Bring your assistant to your website</h1>
      <p className="text-ink-2 mt-3 max-w-xl text-[17px] leading-relaxed">Give customers an “Ask the shop” button. They can find the right product and get answers while they browse.</p>

      <section aria-labelledby="wordpress-heading" className="bg-surface border-line mt-8 overflow-hidden rounded-[14px] border">
        <header className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-5 py-5 sm:px-7">
          <div><h2 id="wordpress-heading" className="text-[20px] font-semibold">Add to WordPress</h2><p className="text-ink-2 mt-1 text-[14px]">Works with your theme. WooCommerce is optional.</p></div>
          <Badge>Free plugin</Badge>
        </header>
        <ol className="divide-line divide-y">
          <li className="flex gap-4 px-5 py-6 sm:px-7">
            <span aria-hidden className="border-line-strong text-ink-2 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold">1</span>
            <div className="min-w-0 flex-1"><h3 className="text-[17px] font-semibold">Install the plugin</h3>
              <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">In WordPress, open <strong className="text-ink font-medium">Plugins → Add New Plugin → Upload Plugin</strong>. Upload this file, then install and activate it.</p>
              <LinkButton href="/downloads/seller-desk-widget.zip" download className="mt-4">Download WordPress plugin</LinkButton>
              <p className="text-ink-3 mt-2 text-[12px]">ZIP file · WordPress 6.3+ · PHP 8.0+</p>
            </div>
          </li>
          <li className="flex gap-4 px-5 py-6 sm:px-7">
            <span aria-hidden className="border-line-strong text-ink-2 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold">2</span>
            <div className="min-w-0 flex-1"><h3 className="text-[17px] font-semibold">Connect your assistant</h3>
              <p className="text-ink-2 mt-2 mb-3 text-[15px] leading-relaxed">Open <strong className="text-ink font-medium">WordPress Settings → Seller Desk</strong>. Paste this address and save.</p>
              <CopyField label="Seller Desk address" value={config.appUrl} />
            </div>
          </li>
          <li className="flex gap-4 px-5 py-6 sm:px-7">
            <span aria-hidden className="border-line-strong text-ink-2 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold">3</span>
            <div className="min-w-0 flex-1"><h3 className="text-[17px] font-semibold">Allow your website, then try it</h3>
              <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">Add your website address in Setup. Back in WordPress, select <strong className="text-ink font-medium">Check connection</strong>, then open your website and try “Ask the shop”.</p>
              {origins.length ? <div className="mt-4"><p className="text-ink-3 text-[12px] font-medium">Currently allowed</p><ul className="mt-1 space-y-1">{origins.map((origin) => <li key={origin} className="break-all text-[14px]">{origin}</li>)}</ul></div> : <Alert tone="warning" className="mt-3" title={"Add your website before testing. The button is hidden on websites you have not allowed."} />}
              <Link href="/owner/setup#widget" className="text-brand mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold hover:underline">Manage allowed websites →</Link>
            </div>
          </li>
        </ol>
      </section>
      <p className="text-ink-3 mt-3 text-[13px]">This plugin connects your running Seller Desk. Hosting and AI setup are separate; their providers may charge.</p>

      <section aria-labelledby="existing-store-heading" className="border-line mt-8 border-b pb-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="existing-store-heading" className="text-[18px] font-semibold">Already sell with WooCommerce?</h2><Badge tone={storeCheck ? "success" : "neutral"}>{storeCheck ? "Catalog checked" : config.store ? "Address saved" : "Optional"}</Badge></div>
        <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">Let your assistant check current products, prices and stock. Customers choose options and pay in your existing shop.</p>
        {config.store ? <>
          <p className="text-ink-2 mt-3 break-all text-[14px]">{config.store.baseUrl}</p>
          <Link href="/owner/install?checkStore=1" prefetch={false} className="text-brand mt-1 inline-flex min-h-11 items-center text-[15px] font-semibold hover:underline">Check product connection →</Link>
          {checkStore ? <Alert tone={storeCheck ? "success" : "warning"} className="mt-2" title={storeCheck ? `Your shop responded with ${storeCheck.products.length} public products on the first page${storeCheck.hasMore ? "; more are available" : ""}.` : "We could not check your shop. Confirm its address and that public products are available."} /> : null}
        </> : <details className="mt-3"><summary className="text-brand cursor-pointer py-2 text-[14px] font-semibold">How to connect your catalog</summary><p className="text-ink-2 mt-2 text-[14px]">In your Seller Desk hosting settings, set <code>WOO_STORE_URL</code> to your WordPress address, then restart Seller Desk. No WooCommerce admin key is needed.</p></details>}
        <p className="text-ink-3 mt-2 text-[13px]">Public products only. Customer accounts, existing orders and refunds are not connected.</p>
      </section>

      <details className="border-line border-b py-5">
        <summary className="cursor-pointer py-1 text-[17px] font-semibold">Use a different website builder</summary>
        <p className="text-ink-2 mt-3 mb-3 text-[15px]">Paste this into your website’s custom code area. Allow that website in Setup, then test the button on a published page.</p>
        <CopyField label="Widget code" value={snippet} multiline />
      </details>
      <details className="border-line border-b py-5">
        <summary className="cursor-pointer py-1 text-[17px] font-semibold">Share a link instead</summary>
        <p className="text-ink-2 mt-3 mb-3 text-[15px]">Add your assistant to a social profile, an email or a QR code at the counter.</p>
        <CopyField label="Shop page link" value={`${config.appUrl}/buy`} />
      </details>
    </section>
  );
}
