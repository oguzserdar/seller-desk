import { describe, expect, it } from "vitest";
import { ownerQuoteTitle } from "../../src/lib/quote-status";

describe("the owner's quote page title", () => {
  it("names a quote with no service a quote, not a service request", () => {
    expect(ownerQuoteTitle({ status: "consumed", totalMinor: 3500, hasService: false })).toBe("Quote");
  });
  it("keeps 'Service request' for a quote that contains a service", () => {
    expect(ownerQuoteTitle({ status: "consumed", totalMinor: 11500, hasService: true })).toBe("Service request");
  });
  it("asks the owner to act while the quote waits for them", () => {
    expect(ownerQuoteTitle({ status: "seller_review", totalMinor: null, hasService: true })).toBe("Price this request");
    expect(ownerQuoteTitle({ status: "seller_review", totalMinor: 11500, hasService: true })).toBe("Confirm the work");
  });
});
