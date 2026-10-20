import type { OfferInput } from "@/server/domain/offers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commerceStorage } from "../support/commerce-storage";
import { conversationStorage } from "../support/conversation-storage";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: real catalog and quote revisions`, () => {
    let f: StorageFixture, p: ReturnType<typeof commerceStorage>;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
      p = commerceStorage(f);
    });
    afterEach(async () => {
      await f?.close();
    });
    const edit = (): OfferInput => ({
      id: f.goodsId,
      expectedRevision: 1,
      kind: "goods",
      title: "A revised goods offer",
      description: "Reviewed stock and price",
      unitAmountMinor: 3500,
      fulfillmentNote: "Collect at the shop",
      requiresScopeReview: false,
      serviceScope: null,
      accessDays: null,
      digitalAssetId: null,
      maxQuantity: 10,
      stockTotal: 2,
    });
    it("prices goods, services and downloads with shared rules and persists the frozen digital terms", async () => {
      const q = await p.proposeQuote(f.buyer, {
        lines: [f.goodsId, f.serviceId, f.digitalId].map((offerId) => ({
          offerId,
          quantity: 1,
        })),
      });
      expect(q.status).toBe("review_ready");
      expect(q.totalMinor).toBe(10000);
      expect((await p.getBuyerQuote(f.buyer, q.id)).lines).toEqual(q.lines);
      expect((await p.getCurrentBuyerQuote(f.buyer))?.id).toBe(q.id);
      expect(
        (
          await f.query(
            "select asset_id,access_days from digital_quote_line where quote_id=?",
            [q.id],
          )
        )[0],
      ).toEqual({ asset_id: f.assetId, access_days: 30 });
      await expect(
        p.getBuyerQuote(
          { ...f.buyer, buyerSessionId: crypto.randomUUID() },
          q.id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      const revised = await p.proposeQuote(f.buyer, {
        threadId: q.threadId,
        lines: [{ offerId: f.goodsId, quantity: 2 }],
      });
      expect(revised.revision).toBe(2);
      expect(revised.totalMinor).toBe(7000);
      expect((await p.getBuyerQuote(f.buyer, q.id)).status).toBe("replaced");
      expect(
        (await p.cancelQuote(f.buyer, { quoteId: revised.id, revision: 2 }))
          .status,
      ).toBe("cancelled");
      expect(await p.getCurrentBuyerQuote(f.buyer)).toBeNull();
    });
    it("requires explicit seller price/scope and commits a selected answer with a new buyer quote", async () => {
      const shop = (await p.getSeller())!;
      await p.saveOffer(f.owner, shop, {
        ...edit(),
        id: f.serviceId,
        kind: "service",
        title: "Custom repair",
        unitAmountMinor: null,
        requiresScopeReview: true,
        serviceScope: "Seller reviews the repair",
        stockTotal: null,
      });
      const q = await p.proposeQuote(f.buyer, {
        lines: [{ offerId: f.serviceId, quantity: 1 }],
        buyerNote: "Repair a broken wheel",
      });
      expect(q.status).toBe("seller_review");
      expect(q.totalMinor).toBeNull();
      const chat = conversationStorage(f);
      await chat.ensureConversation(f.buyer);
      const question = await p.askSeller(f.buyer, {
        question: "Can you repair this wheel?",
        customerGoal: "Repair the wheel",
        knownFacts: [],
      });
      const input = {
        quoteId: q.id,
        expectedRevision: 1,
        approvedScope: "Repair the wheel including parts",
        prices: [{ offerId: f.serviceId, unitAmountMinor: 9000 }],
        answer: {
          questionId: question.question.id,
          expectedRevision: 1,
          answer: "Yes. I will confirm a time with you.",
        },
      };
      const results = await Promise.allSettled([
        p.approveQuoteScope(f.owner, input),
        p.approveQuoteScope(f.owner, input),
      ]);
      const wins = results.filter((result) => result.status === "fulfilled");
      expect(wins).toHaveLength(1);
      const accepted = wins[0]!.status === "fulfilled" ? wins[0]!.value : null;
      expect(accepted).toMatchObject({
        revision: 2,
        status: "review_ready",
        totalMinor: 9000,
        approvedScope: input.approvedScope,
      });
      expect(
        (
          await f.query(
            "select state,revision from seller_question where id=?",
            [question.question.id],
          )
        )[0],
      ).toEqual({ state: "answered", revision: 2 });
      expect(
        Number((await f.query("select count(*) n from payment_attempt"))[0]!.n),
      ).toBe(0);
    });
    it("rejects stale concurrent catalog edits and records one version and audit", async () => {
      const shop = (await p.getSeller())!;
      const results = await Promise.allSettled([
        p.saveOffer(f.owner, shop, edit()),
        p.saveOffer(f.owner, shop, { ...edit(), title: "Competing words" }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          await f.query("select revision from offer where id=?", [f.goodsId])
        )[0]!.revision,
      ).toBe(2);
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from audit_event where operation='offer.update'",
            )
          )[0]!.n,
        ),
      ).toBe(1);
      await p.setOfferPublished(f.owner, shop, {
        offerId: f.goodsId,
        expectedRevision: 2,
        published: false,
      });
      expect(
        (await p.listPublishedOffers(shop.id)).some(
          (row) => row.id === f.goodsId,
        ),
      ).toBe(false);
    });
    it("requires the actual owner identity for a catalog write", async () => {
      const shop = (await p.getSeller())!;
      await expect(
        p.saveOffer({ ...f.owner, userId: crypto.randomUUID() }, shop, edit()),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        (
          await f.query("select revision from offer where id=?", [f.goodsId])
        )[0]!.revision,
      ).toBe(1);
    });
    it("an answered seller question resumes once, with stale claims unable to finish or release it", async () => {
      await conversationStorage(f).ensureConversation(f.buyer);
      const saved = await p.askSeller(f.buyer, {
        question: "What time can I collect?",
        customerGoal: "Arrange collection",
        knownFacts: ["One goods item"],
      });
      const duplicate = await p.askSeller(f.buyer, {
        question: "Repeated wording",
        customerGoal: "Same goal",
        knownFacts: [],
      });
      expect(duplicate.question.id).toBe(saved.question.id);
      expect(duplicate.created).toBe(false);
      const answered = await p.answerQuestion(f.owner, {
        questionId: saved.question.id,
        expectedRevision: 1,
        answer: "At 2 pm tomorrow.",
      });
      expect(answered.state).toBe("answered");
      const claims = await Promise.all([
        p.claimResume(answered.id),
        p.claimResume(answered.id),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const first = claims.find(Boolean)!;
      await f.query("update seller_question set resumed_at=? where id=?", [
        new Date(Date.now() - 121000),
        first.id,
      ]);
      const second = (await p.claimResume(first.id))!;
      expect(second.resumeClaimId).not.toBe(first.resumeClaimId);
      expect(await p.completeResume(first)).toBe(false);
      await p.releaseResume(first, "old failure");
      expect(await p.completeResume(second)).toBe(true);
      expect((await p.latestQuestion(f.buyer))?.state).toBe("resumed");
    });
  });
