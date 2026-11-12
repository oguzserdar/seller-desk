/**
 * @fileoverview A drafted reply with unfilled [blanks] cannot be sent.
 * @module tests/unit/reply-blanks
 */
import { expect, it } from "vitest";
import { hasBlanks } from "@/lib/reply-blanks";

it("finds a blank the owner still has to fill in", () => {
  expect(hasBlanks("We [do or don't] ship to Canada.")).toBe(true);
  expect(hasBlanks("Thanks. [Which items, and the cost.]")).toBe(true);
});

it("lets a finished reply through", () => {
  expect(hasBlanks("Yes, we ship to Canada for $25.")).toBe(false);
  expect(hasBlanks("Use the code [] at checkout")).toBe(false);
  expect(hasBlanks("")).toBe(false);
});
