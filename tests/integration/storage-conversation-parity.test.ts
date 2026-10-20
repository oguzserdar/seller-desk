import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversationStorage } from "../support/conversation-storage";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

// Storage fixtures only. No model is invoked and these tests are not AI-quality evidence.
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: real durable conversations and capabilities`, () => {
    let f: StorageFixture, p: ReturnType<typeof conversationStorage>;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
      p = conversationStorage(f);
    });
    afterEach(async () => {
      await f?.close();
    });
    it("saves input once, restores it after interruption, and refuses simultaneous inference claims", async () => {
      const id = await p.ensureConversation(f.buyer),
        message = { id: crypto.randomUUID(), text: "When can I collect this?" };
      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          p.receiveBuyerMessage(f.buyer, id, message, true),
        ),
      );
      const wins = outcomes.filter((result) => result.status === "fulfilled");
      expect(wins).toHaveLength(1);
      const claim =
        wins[0]!.status === "fulfilled" ? wins[0]!.value.claim : null;
      expect(claim).toBeTruthy();
      expect((await p.readBuyerConversation(f.buyer, id)).replyState).toBe(
        "answering",
      );
      await p.releaseTurn(claim!);
      const restored = await p.readBuyerConversation(f.buyer, id);
      expect(restored.replyState).toBe("interrupted");
      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0]!.parts).toEqual([
        { type: "text", text: message.text },
      ]);
      const retry = await p.receiveBuyerMessage(f.buyer, id, message, true);
      expect(retry.claim).toBeTruthy();
      await p.completeTurn(retry.claim!, [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "[Storage fixture bytes, not a model answer]",
            },
          ],
        },
      ]);
      expect((await p.readBuyerConversation(f.buyer, id)).replyState).toBe(
        "idle",
      );
      expect(
        (await p.receiveBuyerMessage(f.buyer, id, message, true)).claim,
      ).toBeNull();
      expect(await p.loadMessages(id)).toHaveLength(2);
    });
    it("seller takeover invalidates old inference and delivers exact human words once", async () => {
      const id = await p.ensureConversation(f.buyer);
      const turn = await p.receiveBuyerMessage(
        f.buyer,
        id,
        { id: crypto.randomUUID(), text: "Can I collect tomorrow?" },
        true,
      );
      const control = await p.changeConversationHandler(f.owner, {
        id,
        expectedRevision: 1,
        handler: "seller",
      });
      await expect(
        p.completeTurn(turn.claim!, [
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text: "[Must never be saved]" }],
          },
        ]),
      ).rejects.toThrow();
      const reply = {
        id: crypto.randomUUID(),
        conversationId: id,
        expectedRevision: control.revision,
        text: "I can meet you at 2 pm tomorrow.",
      };
      await p.sendSellerMessage(f.owner, reply);
      await p.sendSellerMessage(f.owner, reply);
      const view = await p.readBuyerConversation(f.buyer, id);
      expect(view.control.handler).toBe("seller");
      expect(view.messages).toHaveLength(2);
      expect(JSON.stringify(view.messages)).not.toContain("Must never");
      expect(JSON.stringify(view.messages)).toContain(reply.text);
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from audit_event where operation='conversation.reply'",
            )
          )[0]!.n,
        ),
      ).toBe(1);
      await expect(
        p.sendSellerMessage(f.owner, { ...reply, text: "Different words" }),
      ).rejects.toThrow();
      await expect(
        p.readBuyerConversation(
          { ...f.buyer, buyerSessionId: crypto.randomUUID() },
          id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        p.readSellerConversation(
          { ...f.owner, userId: crypto.randomUUID() },
          id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await p.listSellerConversations(f.owner)).toHaveLength(1);
    });
    it("retains message order with tied timestamps and a bounded history after reconnect", async () => {
      const id = await p.ensureConversation(f.buyer);
      const messages = Array.from({ length: 45 }, (_, i) => ({
        id: `storage-order-${i}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: `fixture-${i}` }],
      }));
      await p.saveMessages(id, messages);
      await p.saveMessages(id, messages);
      await f.query("update message set created_at=?", [
        new Date("2026-10-15T00:00:00Z"),
      ]);
      const history = await p.loadMessages(id);
      expect(history).toHaveLength(40);
      expect(history.map((m) => m.id)).toEqual(
        messages.slice(5).map((m) => m.id),
      );
      expect(
        Number((await f.query("select count(*) n from message"))[0]!.n),
      ).toBe(45);
    });
    it("owner input, claim expiry, replacement and saved history survive a restarted client", async () => {
      const input = {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Show my open orders" }],
      };
      const first = await p.beginOwnerTurn(f.owner, input);
      await expect(
        p.beginOwnerTurn(f.owner, { ...input, id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "conflict" });
      await f.query(
        "update owner_conversation set active_turn_expires_at=? where id=?",
        [new Date(Date.now() - 1000), first.conversationId],
      );
      const second = await p.beginOwnerTurn(f.owner, {
        ...input,
        id: crypto.randomUUID(),
      });
      await expect(p.completeOwnerTurn(first, [])).rejects.toThrow();
      await p.releaseOwnerTurn(first);
      expect((await p.loadOwnerHistory(f.owner)).busyUntil).toBeTruthy();
      await p.completeOwnerTurn(second, [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text: "[Owner history storage fixture]" }],
        },
      ]);
      const saved = await p.loadOwnerHistory(f.owner);
      expect(saved.messages).toHaveLength(3);
      expect(saved.busyUntil).toBeNull();
      expect(saved.interrupted).toBe(false);
      await expect(p.beginOwnerTurn(f.owner, input)).rejects.toThrow();
    });
    it("exchanges a handoff only once and revokes every capability together", async () => {
      const issued = await p.startBuyerSession("widget"),
        buyer = await p.resolveBuyer(issued.token);
      const { code } = await p.createHandoff(buyer, null);
      const results = await Promise.allSettled([
        p.exchangeHandoff(code),
        p.exchangeHandoff(code),
      ]);
      const winners = results.filter((result) => result.status === "fulfilled");
      expect(winners).toHaveLength(1);
      const transferred =
        winners[0]!.status === "fulfilled" ? winners[0]!.value : null;
      expect((await p.resolveBuyer(transferred!.token)).buyerSessionId).toBe(
        buyer.buyerSessionId,
      );
      await p.endBuyerSession(buyer);
      await expect(p.resolveBuyer(issued.token)).rejects.toMatchObject({
        code: "unauthorized",
      });
      await expect(p.resolveBuyer(transferred!.token)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(
        JSON.stringify(
          await f.query("select capability_hash from buyer_capability"),
        ),
      ).not.toContain(issued.token);
    });
    it("enforces the same spend limit across simultaneous clients", async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          p.consumeUsage("acceptance", f.owner.sellerId, 3600, 5),
        ),
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
      expect(
        await p.hasUsageLeft("acceptance", f.owner.sellerId, 3600, 5),
      ).toBe(false);
      expect(
        (
          await f.query(
            "select count from usage_bucket where feature='acceptance'",
          )
        )[0]!.count,
      ).toBe(5);
    });
    it("native owner auth signs in, reads and revokes a real database session with public signup disabled", async () => {
      const ctx = await p.auth.$context,
        password = "Storage-acceptance-password-42";
      await ctx.internalAdapter.linkAccount({
        userId: f.owner.userId,
        providerId: "credential",
        accountId: f.owner.userId,
        password: await ctx.password.hash(password),
      });
      const login = await p.auth.handler(
        new Request("http://localhost:4310/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:4310",
          },
          body: JSON.stringify({
            email: `${f.owner.userId}@example.test`,
            password,
          }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(
        (await p.auth.api.getSession({ headers: new Headers({ cookie }) }))
          ?.user.id,
      ).toBe(f.owner.userId);
      const signup = await p.auth.handler(
        new Request("http://localhost:4310/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:4310",
          },
          body: JSON.stringify({
            email: "intruder@example.test",
            password,
            name: "Intruder",
          }),
        }),
      );
      expect(signup.status).toBe(404);
      await p.auth.api.signOut({ headers: new Headers({ cookie }) });
      expect(
        await p.auth.api.getSession({ headers: new Headers({ cookie }) }),
      ).toBeNull();
      expect(
        Number((await f.query("select count(*) n from session"))[0]!.n),
      ).toBe(0);
    });
  });
