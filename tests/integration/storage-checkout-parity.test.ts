import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

const context = {
  environment: "fixture" as const,
  payeeMerchantId: "FIXTURE-MERCHANT",
  appUrl: "http://localhost:4310",
};

for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: the same real checkout acceptance cases`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    const totals = async () => ({
      attempts: Number(
        (await f.query("select count(*) n from payment_attempt"))[0]!.n,
      ),
      reservations: Number(
        (await f.query("select count(*) n from reservation"))[0]!.n,
      ),
      audits: Number(
        (
          await f.query(
            "select count(*) n from audit_event where operation='checkout.start'",
          )
        )[0]!.n,
      ),
      guards: Number(
        (
          await f.query(
            "select count(*) n from operation_key where scope='d1-batch-guard'",
          )
        )[0]!.n,
      ),
    });

    it.each([
      ["goods"],
      ["service"],
      ["digital"],
      ["goods", "service", "digital"],
    ] as const)(
      "reserves %j with one durable intent and no provider charge",
      async (...kinds) => {
        const q = await f.makeQuote(kinds);
        const id = await f.checkout.holdAndRecord(
          f.buyer,
          { quoteId: q.id, revision: q.revision },
          context,
        );
        const [row] = await f.query(
          "select * from payment_attempt where id=?",
          [id],
        );
        expect(row).toMatchObject({
          quote_id: q.id,
          state: "planned",
          environment: "fixture",
        });
        expect(Number(row!.amount_minor)).toBe(
          kinds.reduce(
            (sum, kind) =>
              sum +
              (kind === "goods" ? 3500 : kind === "service" ? 4000 : 2500),
            0,
          ),
        );
        expect(
          (await f.query("select status from quote where id=?", [q.id]))[0]!
            .status,
        ).toBe("accepted");
        expect(await totals()).toEqual({
          attempts: 1,
          reservations: (kinds as readonly string[]).includes("goods") ? 1 : 0,
          audits: 1,
          guards: 0,
        });
        expect(
          String((await f.query("select count(*) n from orders"))[0]!.n),
        ).toBe("0");
      },
    );

    it("joins simultaneous retries without holding stock twice", async () => {
      const q = await f.makeQuote();
      const replies = await Promise.all(
        Array.from({ length: 6 }, () =>
          f.checkout.holdAndRecord(
            f.buyer,
            { quoteId: q.id, revision: 1 },
            context,
          ),
        ),
      );
      expect(new Set(replies).size).toBe(1);
      expect(
        (
          await f.query("select held,sold from inventory where offer_id=?", [
            f.goodsId,
          ])
        )[0],
      ).toEqual({ held: 1, sold: 0 });
      expect(await totals()).toEqual({
        attempts: 1,
        reservations: 1,
        audits: 1,
        guards: 0,
      });
      expect(
        await f.checkout.holdAndRecord(
          f.buyer,
          { quoteId: q.id, revision: 999 },
          context,
        ),
      ).toBe(replies[0]);
    });

    it("allows only one checkout for the last unit across competing buyers", async () => {
      await f.query("update inventory set total=1 where offer_id=?", [
        f.goodsId,
      ]);
      const a = await f.makeQuote(),
        b = await f.makeQuote();
      const replies = await Promise.allSettled(
        [a, b].map((q) =>
          f.checkout.holdAndRecord(
            f.buyer,
            { quoteId: q.id, revision: 1 },
            context,
          ),
        ),
      );
      expect(replies.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = replies.find((r) => r.status === "rejected");
      expect(failure?.status === "rejected" && failure.reason.code).toBe(
        "sold_out",
      );
      expect(await totals()).toEqual({
        attempts: 1,
        reservations: 1,
        audits: 1,
        guards: 0,
      });
      expect(
        (
          await f.query(
            "select total,held,sold from inventory where offer_id=?",
            [f.goodsId],
          )
        )[0],
      ).toEqual({ total: 1, held: 1, sold: 0 });
    });

    it("hides another buyer's quote and refuses a forged seller scope", async () => {
      const q = await f.makeQuote();
      await expect(
        f.checkout.holdAndRecord(
          { ...f.buyer, buyerSessionId: crypto.randomUUID() },
          { quoteId: q.id, revision: 1 },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.checkout.holdAndRecord(
          { ...f.buyer, sellerId: crypto.randomUUID() },
          { quoteId: q.id, revision: 1 },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await totals()).toEqual({
        attempts: 0,
        reservations: 0,
        audits: 0,
        guards: 0,
      });
    });

    it.each(["price", "terms", "publication", "revision", "expiry"])(
      "rejects changed %s and leaves all effects absent",
      async (change) => {
        const q = await f.makeQuote();
        if (change === "price")
          await f.query("update offer set unit_amount_minor=3600 where id=?", [
            f.goodsId,
          ]);
        if (change === "terms")
          await f.query("update seller set policy_revision=2 where id=?", [
            f.owner.sellerId,
          ]);
        if (change === "publication")
          await f.query("update offer set published=? where id=?", [
            false,
            f.goodsId,
          ]);
        if (change === "expiry")
          await f.query("update quote set expires_at=? where id=?", [
            new Date(Date.now() - 1000),
            q.id,
          ]);
        await expect(
          f.checkout.holdAndRecord(
            f.buyer,
            { quoteId: q.id, revision: change === "revision" ? 2 : 1 },
            context,
          ),
        ).rejects.toMatchObject({
          code: change === "expiry" ? "expired" : "conflict",
        });
        expect(await totals()).toEqual({
          attempts: 0,
          reservations: 0,
          audits: 0,
          guards: 0,
        });
        expect(
          (
            await f.query("select held from inventory where offer_id=?", [
              f.goodsId,
            ])
          )[0]!.held,
        ).toBe(0);
      },
    );

    it("revokes assistant authority on takeover, including an existing payment retry", async () => {
      const q = await f.makeQuote();
      const id = crypto.randomUUID(),
        claim = crypto.randomUUID();
      await f.query(
        "insert into conversation(id,seller_id,buyer_session_id,active_turn_id,active_turn_expires_at) values (?,?,?,?,?)",
        [
          id,
          f.buyer.sellerId,
          f.buyer.buyerSessionId,
          claim,
          new Date(Date.now() + 60_000),
        ],
      );
      const buyer = {
        ...f.buyer,
        assistantTurn: { conversationId: id, id: claim },
      };
      const attempt = await f.checkout.holdAndRecord(
        buyer,
        { quoteId: q.id, revision: 1 },
        context,
      );
      await f.query(
        "update conversation set handler='seller',active_turn_id=null where id=?",
        [id],
      );
      await expect(
        f.checkout.holdAndRecord(
          buyer,
          { quoteId: q.id, revision: 1 },
          context,
        ),
      ).rejects.toMatchObject({ name: "AssistantTurnEnded" });
      expect(
        await f.checkout.holdAndRecord(
          f.buyer,
          { quoteId: q.id, revision: 1 },
          context,
        ),
      ).toBe(attempt);
      expect(await totals()).toEqual({
        attempts: 1,
        reservations: 1,
        audits: 1,
        guards: 0,
      });
    });

    it("rolls back inventory, quote, intent and guards when the final audit write fails", async () => {
      const q = await f.makeQuote();
      if (dialect === "postgres") {
        await f.query(
          "create or replace function reject_parity_checkout_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$",
        );
        await f.query(
          "create trigger fail_checkout_audit before insert on audit_event for each row execute function reject_parity_checkout_audit()",
        );
      } else
        await f.query(
          "create trigger fail_checkout_audit before insert on audit_event begin select raise(abort, 'injected audit failure'); end",
        );
      try {
        await expect(
          f.checkout.holdAndRecord(
            f.buyer,
            { quoteId: q.id, revision: 1 },
            context,
          ),
        ).rejects.toThrow();
        expect(await totals()).toEqual({
          attempts: 0,
          reservations: 0,
          audits: 0,
          guards: 0,
        });
        expect(
          (await f.query("select status from quote where id=?", [q.id]))[0]!
            .status,
        ).toBe("review_ready");
        expect(
          (
            await f.query("select held from inventory where offer_id=?", [
              f.goodsId,
            ])
          )[0]!.held,
        ).toBe(0);
      } finally {
        await f.query(
          dialect === "postgres"
            ? "drop trigger fail_checkout_audit on audit_event"
            : "drop trigger fail_checkout_audit",
        );
      }
      await f.checkout.holdAndRecord(
        f.buyer,
        { quoteId: q.id, revision: 1 },
        context,
      );
      expect(await totals()).toEqual({
        attempts: 1,
        reservations: 1,
        audits: 1,
        guards: 0,
      });
    });
  });
