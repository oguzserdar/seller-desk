import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { checkPayPalAction } from "@/app/owner/(desk)/setup/actions";

it("refuses a direct connection-check action without an owner session, before any provider request", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    const result = await checkPayPalAction();
    expect(result).toMatchObject({ serverError: "Sign in as the shop owner to continue." });
    expect(result?.data).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
