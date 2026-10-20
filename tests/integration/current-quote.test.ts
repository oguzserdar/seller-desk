import { beforeEach, describe, expect, it } from "vitest";
import * as quoteRoute from "../../src/app/api/buyer/quote/route";
import { endBuyerSession } from "@/server/domain/buyer-session";
import { cancelQuote, proposeQuote } from "@/server/domain/quotes";
import { newBuyer, offerId, quoteFor, resetShop } from "../support/shop";

async function read(token: string) {
  const handler = (quoteRoute as unknown as { GET?: (request: Request, ctx: unknown) => Promise<Response> }).GET;
  expect(handler, "reload must expose the buyer's stored quote").toBeTypeOf("function");
  const response = await handler!(new Request("http://localhost/api/buyer/quote", { headers: { Authorization: `Bearer ${token}` } }), undefined);
  return { response, body: await response.json() };
}

describe("buyer quote restoration", () => {
  beforeEach(resetShop);

  it("restores a manual quote without requiring an AI tool message", async () => {
    const buyer = await newBuyer();
    const quote = await quoteFor(buyer, "Disc brake pads");
    const { response, body } = await read(buyer.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.data).toMatchObject({ id: quote.id, totalMinor: 3500, isLatest: true });
  });

  it("restores the newest revision and does not revive a cancelled quote", async () => {
    const buyer = await newBuyer();
    const first = await quoteFor(buyer, "Disc brake pads");
    const second = await proposeQuote(buyer, { threadId: first.threadId, lines: [{ offerId: await offerId("Disc brake pads"), quantity: 2 }] });
    expect((await read(buyer.token)).body.data).toMatchObject({ id: second.id, revision: 2, totalMinor: 7000 });
    await cancelQuote(buyer, { quoteId: second.id, revision: 2 });
    expect((await read(buyer.token)).body.data).toBeNull();
  });

  it("cannot recover another buyer's quote or read after the session ends", async () => {
    const buyer = await newBuyer();
    const other = await newBuyer();
    await quoteFor(buyer, "Disc brake pads");
    expect((await read(other.token)).body.data).toBeNull();
    await endBuyerSession(buyer);
    expect((await read(buyer.token)).response.status).toBe(401);
  });
});
