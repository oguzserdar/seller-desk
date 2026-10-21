import { describe, expect, it } from "vitest";
import { pollDelay } from "@/components/buyer/use-conversation-sync";

describe("pollDelay", () => {
  it("checks every 2 s while the chat is active", () => {
    expect(pollDelay(false, 0)).toBe(2_000);
    expect(pollDelay(false, 29_999)).toBe(2_000);
  });
  it("keeps checking every 2 s while a seller owns the chat, however quiet", () => {
    expect(pollDelay(true, 10 * 60_000)).toBe(2_000);
  });
  it("backs off to 10 s, then 30 s, as the chat goes quiet", () => {
    expect(pollDelay(false, 30_000)).toBe(10_000);
    expect(pollDelay(false, 119_999)).toBe(10_000);
    expect(pollDelay(false, 120_000)).toBe(30_000);
  });
});
