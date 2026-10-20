// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const script = readFileSync("integrations/wordpress/seller-desk-widget/settings.js", "utf8");
const fetcher = vi.fn();
let button: HTMLButtonElement;
let address: HTMLInputElement;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = `<input id="seller-desk-origin" value="https://desk.example"><button id="seller-desk-check" data-desk-origin="https://desk.example">Check connection</button><p id="seller-desk-check-result" role="status"></p><span id="seller-desk-connection-state"></span>`;
  button = document.querySelector("button")!;
  address = document.querySelector("input")!;
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ allowed: true }) });
  new Function(script)();
});
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); fetcher.mockReset(); });

it("cannot claim a changed, unsaved address is connected", async () => {
  button.click(); await flush();
  expect(document.body.textContent).toContain("Connected");
  address.value = "https://different.example";
  address.dispatchEvent(new Event("input"));
  expect(button.disabled).toBe(true);
  expect(document.getElementById("seller-desk-check-result")?.textContent).toContain("Save");
  expect(document.getElementById("seller-desk-connection-state")?.textContent).not.toBe("Connected");
});

it("ignores a successful check that arrives after editing the address", async () => {
  let finish!: (value: unknown) => void;
  fetcher.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  button.click();
  address.value = "https://different.example";
  address.dispatchEvent(new Event("input"));
  finish({ ok: true, json: async () => ({ allowed: true }) });
  await flush();
  expect(button.disabled).toBe(true);
  expect(document.getElementById("seller-desk-connection-state")?.textContent).toBe("Unsaved changes");
});

it("sends the seller to the approval step when this website is not allowed", async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ allowed: false }) });
  button.click(); await flush();
  expect(document.getElementById("seller-desk-connection-state")?.textContent).toBe("Website needs approval");
  expect(document.getElementById("seller-desk-check-result")?.textContent).toContain("step 2");
  expect(button.disabled).toBe(false);
});

it("does not turn malformed or failed checks into a connected state", async () => {
  for (const response of [{ ok: true, json: async () => ({ allowed: "true" }) }, { ok: false }]) {
    fetcher.mockResolvedValue(response);
    button.click(); await flush();
    expect(document.getElementById("seller-desk-connection-state")?.textContent).toBe("Could not connect");
    expect(button.disabled).toBe(false);
  }
});
