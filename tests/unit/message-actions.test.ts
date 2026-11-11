/**
 * @fileoverview Unit tests for the text an answer's Copy action copies.
 * @module tests/unit/message-actions
 *
 * Only written parts are copied, in order, trimmed, with tool steps and blank parts left out.
 */
import { describe, expect, it } from "vitest";
import { answerText } from "@/components/assistant/message-actions";

describe("answerText", () => {
  it("joins the written parts in order and skips tool steps and blanks", () => {
    expect(
      answerText([
        { type: "text", text: "  Brake service is $120. " },
        { type: "tool-search_catalog" },
        { type: "text", text: "   " },
        { type: "text", text: "Drop-off is Saturday." },
      ]),
    ).toBe("Brake service is $120.\n\nDrop-off is Saturday.");
  });

  it("is empty when nothing was written, so no Copy button shows", () => {
    expect(answerText([{ type: "tool-search_catalog" }])).toBe("");
  });
});
