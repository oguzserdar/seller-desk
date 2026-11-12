/**
 * @fileoverview The demo desk shows an offer read-only: no Publish toggle and a disabled form, while the
 * owner keeps both. The server refuses demo writes anyway; this keeps the page from offering them.
 * @module tests/ui/demo-viewer-offer
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const viewer = vi.hoisted(() => ({ value: true }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/auth/owner", () => ({ requireOwner: async () => ({ owner: { kind: "owner", userId: "u", sellerId: "s" }, seller: { currency: "USD" }, viewer: viewer.value }) }));
vi.mock("@/server/domain/offers", () => ({
  publishBlockers: () => [],
  listOwnerOffers: async () => [{ row: { id: "o1", revision: 2, published: true, kind: "physical", title: "Disc brake pads", description: "Pads", unitAmountMinor: 3500, fulfillmentNote: "", requiresScopeReview: false, serviceScope: null, accessDays: null, digitalAssetId: null, maxQuantity: 4 }, stock: null, assetName: null }],
}));
vi.mock("../../src/app/owner/(desk)/offers/publish-toggle", () => ({ PublishToggle: () => "PUBLISH-TOGGLE" }));
vi.mock("../../src/app/owner/(desk)/offers/offer-form", () => ({ OfferForm: () => "<button>Save</button>" }));
import EditOfferPage from "../../src/app/owner/(desk)/offers/[id]/page";

async function render() {
  const page = await EditOfferPage({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(page);
}

it("a demo visitor sees the offer with no Publish toggle and a disabled form", async () => {
  viewer.value = true;
  const html = await render();
  expect(html).not.toContain("PUBLISH-TOGGLE");
  expect(html).toMatch(/<fieldset disabled=""/);
});

it("the owner keeps Publish and an editable form", async () => {
  viewer.value = false;
  const html = await render();
  expect(html).toContain("PUBLISH-TOGGLE");
  expect(html).not.toMatch(/<fieldset disabled=""/);
});
