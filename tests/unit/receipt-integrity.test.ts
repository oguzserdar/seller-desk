import { describe, expect, it } from "vitest";
import { misleadingDocumentRequest } from "../../src/server/domain/receipt-integrity";

const recorded = ["$35.00"];

describe("a question to the shop that asks for a document the records do not support", () => {
  it("refuses a receipt that shows a different amount than the one paid (real 14 Oct runs)", () => {
    expect(misleadingDocumentRequest("Can you issue an official expense receipt for order #1003 (paid $35.00) that shows USD 25 for the customer's expense report?", recorded)).toBe(true);
    expect(misleadingDocumentRequest("Can you provide an adjusted invoice, credit note, or receipt addendum showing a net amount of USD 25 while leaving the recorded payment of USD 35 unchanged?", recorded)).toBe(true);
  });
  it("lets an honest request for the real receipt through", () => {
    expect(misleadingDocumentRequest("Can you resend the receipt for my $35.00 brake pads?", recorded)).toBe(false);
    expect(misleadingDocumentRequest("Can you email me a copy of my receipt?", recorded)).toBe(false);
  });
  it("leaves questions that are not about documents alone", () => {
    expect(misleadingDocumentRequest("Can you replace my brake cable by Tuesday for under $125?", recorded)).toBe(false);
  });
  it("refuses a document amount when nothing has been paid yet", () => {
    expect(misleadingDocumentRequest("Please write an invoice for $25 so I can expense it.", [])).toBe(true);
  });
});
