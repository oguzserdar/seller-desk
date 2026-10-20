import { describe, expect, it } from "vitest";
import { assertEvalDatabase } from "../../scripts/chat-eval/fixtures";

describe("live evaluation database boundary", () => {
  it("accepts only a separately named local evaluation database", () => {
    expect(() => assertEvalDatabase("postgresql://user@127.0.0.1:54329/seller_desk_chat_eval")).not.toThrow();
  });
  it.each([
    "postgresql://user@127.0.0.1:54329/seller_desk_paypal_sandbox_20261009",
    "postgresql://user@127.0.0.1:54329/seller_desk_test",
    "postgresql://user@production.example/seller_desk_chat_eval",
    "postgresql://user@127.0.0.1:54329/seller_desk_chat_eval/extra",
    "",
  ])("refuses unsafe database %s", (url) => {
    expect(() => assertEvalDatabase(url)).toThrow();
  });
});
