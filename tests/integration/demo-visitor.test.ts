import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readOwner, requireOwner, requireOwnerWrite, VIEWER_REFUSAL } from "@/server/auth/owner";
import { VIEWER_COOKIE, VIEWER_SECONDS, hasViewerPass, issueViewerPass } from "@/server/auth/viewer-pass";
import { resetServerConfigForTests } from "@/server/env";
import { resetShop } from "../support/shop";

const withPass = (pass: string) => new Headers({ cookie: `other=1; ${VIEWER_COOKIE}=${pass}` });

beforeEach(async () => {
  await resetShop();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerConfigForTests();
});

function publicDemo(on: boolean) {
  vi.stubEnv("PUBLIC_DEMO", on ? "true" : "");
  resetServerConfigForTests();
}

it("lets a visitor with a pass read a public demo's desk and change nothing", async () => {
  publicDemo(true);
  const headers = withPass(await issueViewerPass());
  const context = await readOwner(headers);
  expect(context).toMatchObject({ viewer: true, name: "Demo visitor", email: "" });
  expect(context!.owner.sellerId).toBe(context!.seller.id);
  expect((await requireOwner(headers)).viewer).toBe(true);
  await expect(requireOwnerWrite(headers)).rejects.toThrow(VIEWER_REFUSAL);
});

it("accepts no pass on an installation that is not a public demo", async () => {
  publicDemo(true);
  const pass = await issueViewerPass();
  publicDemo(false);
  expect(await hasViewerPass(`${VIEWER_COOKIE}=${pass}`)).toBe(false);
  expect(await readOwner(withPass(pass))).toBeNull();
});

it("refuses an expired, altered or missing pass", async () => {
  publicDemo(true);
  const now = Date.now();
  const pass = await issueViewerPass(now);
  expect(await hasViewerPass(`${VIEWER_COOKIE}=${pass}`, now)).toBe(true);
  expect(await hasViewerPass(`${VIEWER_COOKIE}=${pass}`, now + (VIEWER_SECONDS + 1) * 1000)).toBe(false);
  const [expires, mac] = pass.split(".");
  // A later expiry with the old signature, and a changed signature.
  expect(await hasViewerPass(`${VIEWER_COOKIE}=${Number(expires) + 3600}.${mac}`, now)).toBe(false);
  expect(await hasViewerPass(`${VIEWER_COOKIE}=${expires}.${"0".repeat(mac!.length)}`, now)).toBe(false);
  expect(await hasViewerPass(null, now)).toBe(false);
  expect(await readOwner(new Headers())).toBeNull();
});
