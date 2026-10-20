/** Real database recovery: saved questions retry once; answered or superseded requests never rerun. */
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import { completeTurn, releaseTurn } from "@/server/ai/turn-control";
import { getDb } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import { changeConversationHandler } from "@/server/domain/conversation-control";
import { readBuyerConversation, receiveBuyerMessage } from "@/server/domain/conversation-messages";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

it("distinguishes a live reply from interrupted saved input and retries without another user message", async () => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer); const before = await tally();
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("idle");
  const input = { id: crypto.randomUUID(), text: "Check my existing purchase. Do not start another payment." };
  const first = await receiveBuyerMessage(buyer, id, input, true);
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("answering");
  await expect(receiveBuyerMessage(buyer, id, input, true)).rejects.toMatchObject({ code: "conflict" });
  await releaseTurn(first.claim!);
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("interrupted");
  const retry = await receiveBuyerMessage(buyer, id, input, true);
  expect(retry.claim).not.toBeNull(); expect(retry.claim?.id).not.toBe(first.claim?.id);
  expect(await loadMessages(id)).toHaveLength(1); expect(await tally()).toEqual(before);
});

it("acknowledges an already saved reply without claiming another model turn", async () => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer);
  const input = { id: crypto.randomUUID(), text: "Check my existing order." };
  const turn = await receiveBuyerMessage(buyer, id, input, true);
  const messages = await loadMessages(id);
  await completeTurn(turn.claim!, [...messages, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: "Stored test reply." }] }]);
  expect((await receiveBuyerMessage(buyer, id, input, true)).claim).toBeNull();
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("idle");
  expect(await loadMessages(id)).toHaveLength(2);
});

it("refuses replay of an older request after the customer changed their mind", async () => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer);
  const old = { id: crypto.randomUUID(), text: "Quote two mugs." };
  const first = await receiveBuyerMessage(buyer, id, old, true); await releaseTurn(first.claim!);
  const changed = await receiveBuyerMessage(buyer, id, { id: crypto.randomUUID(), text: "Actually, do not quote anything." }, true); await releaseTurn(changed.claim!);
  await expect(receiveBuyerMessage(buyer, id, old, true)).rejects.toMatchObject({ code: "conflict" });
  expect(await loadMessages(id)).toHaveLength(2);
});

it("makes expired execution recoverable without exposing another buyer's history", async () => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer);
  await receiveBuyerMessage(buyer, id, { id: crypto.randomUUID(), text: "Can you help?" }, true);
  await getDb().update(conversation).set({ activeTurnExpiresAt: new Date(0) }).where(eq(conversation.id, id));
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("interrupted");
  await expect(readBuyerConversation(await newBuyer(), id)).rejects.toMatchObject({ code: "not_found" });
  await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
  expect((await readBuyerConversation(buyer, id)).replyState).toBe("idle");
});
