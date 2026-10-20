// @vitest-environment happy-dom
/**
 * A tab starts exactly one buyer session, even when React runs the start effect
 * twice (development StrictMode). Two sessions split the page: it loads one
 * conversation while every later request uses the other, so a shop's answer
 * never reaches the screen (found filming 14 Oct).
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readToken, useBuyerSession } from "../../src/lib/buyer-client";

let root: Root;
let container: HTMLDivElement;
let created: number;
let lastState = "";

function Probe() {
  const { state } = useBuyerSession("page");
  lastState = state.status;
  return null;
}

describe("starting a buyer session", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    created = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path !== "/api/buyer/session") throw new Error(`unexpected ${path}`);
      created += 1;
      const token = `token-${created}`;
      // Both effect runs start before any response arrives, as in a real browser.
      await Promise.resolve();
      return new Response(JSON.stringify({ requestId: "r", state: "ok", message: "OK", next: [], data: { token, expiresAt: "2099-01-01T00:00:00Z" } }), { status: 200 });
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("creates one session under StrictMode's double effect, and the page and later requests agree on it", async () => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Probe)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(created).toBe(1);
    expect(lastState).toBe("ready");
    expect(readToken()?.token).toBe("token-1");
  });
});
