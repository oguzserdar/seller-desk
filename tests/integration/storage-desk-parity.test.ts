import { decideFixtureOrder } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { queryDesk } from "@/server/domain/desk";
import {
  importOfferDrafts,
  previewOfferImport,
} from "@/server/domain/offer-import";
import {
  completePickup,
  getOwnerOrder,
  recordServiceFollowUp,
} from "@/server/domain/orders";
import { readPaidSummary } from "@/server/domain/paid-summary";
import { decideProposal, proposeAction } from "@/server/domain/proposals";
import { proposeQuote } from "@/server/domain/quotes";
import { getSeller } from "@/server/domain/seller";
import { readWorkSummary } from "@/server/domain/work-summary";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { withD1Database } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: real seller desk operations`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    async function buy(kind: "goods" | "service" = "goods") {
      const q = await run(() =>
        proposeQuote(f.buyer, {
          lines: [
            {
              offerId: kind === "goods" ? f.goodsId : f.serviceId,
              quantity: 1,
            },
          ],
        }),
      );
      const c = await run(() =>
        startCheckout(f.buyer, { quoteId: q.id, revision: 1 }),
      );
      await run(async () => {
        const storage = getStorage();
        if (storage.kind === "d1")
          await storage.fixture.decideFixtureOrder(
            c.approvalUrl!.split("/").at(-1)!,
            "approve",
          );
        else
          await decideFixtureOrder(
            getDb(),
            c.approvalUrl!.split("/").at(-1)!,
            "approve",
          );
      });
      return (
        await run(() =>
          reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
        )
      ).order!.id;
    }
    it("shows paid rows, whole-shop receipts and unfinished work from the same committed facts", async () => {
      const id = await buy();
      const desk = await run(() => queryDesk(f.owner, { view: "all_orders" }));
      expect(desk.rows).toHaveLength(1);
      expect(desk.rows[0]).toMatchObject({
        id,
        status: "Paid",
        nextStep: "Hand over at pickup",
        needsOwner: true,
      });
      expect(desk.totals[0]!.paidMinor).toBe(3500);
      expect(
        (
          await run(() =>
            readPaidSummary(f.owner, {
              period: "all_time",
              timeZone: "America/Edmonton",
            }),
          )
        ).totals[0]!.paidMinor,
      ).toBe(3500);
      const summary = await run(() => readWorkSummary(f.owner));
      expect(summary.counts.paidOrders).toBe(1);
      expect(summary.counts.ordersWithUnfinishedTasks).toBe(1);
    });
    it("imports 50 reviewed products once, with no publication and no parameter-limit failure", async () => {
      const shop = (await run(() => getSeller()))!,
        text =
          "title,kind,price,stock\n" +
          Array.from({ length: 50 }, (_, i) => `Goods ${i},goods,12.50,3`).join(
            "\n",
          );
      const preview = await run(() => previewOfferImport(f.owner, shop, text));
      expect(preview.rows).toHaveLength(50);
      const result = await run(() =>
        importOfferDrafts(f.owner, shop, {
          draftId: preview.draftId,
          reviewRevision: 1,
        }),
      );
      expect(result.created).toBe(50);
      await expect(
        run(() =>
          importOfferDrafts(f.owner, shop, {
            draftId: preview.draftId,
            reviewRevision: 1,
          }),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        Number(
          (
            await f.query("select count(*) n from offer where published=?", [
              false,
            ])
          )[0]!.n,
        ),
      ).toBe(50);
      expect(
        Number((await f.query("select count(*) n from inventory"))[0]!.n),
      ).toBe(51);
    });
    it("requires seller approval, rejects repeated approval and retains the exact fulfillment outcome", async () => {
      const id = await buy(),
        suggestion = await run(() =>
          proposeAction(f.owner, { action: "mark_picked_up", targetId: id }),
        );
      expect(
        (await run(() => getOwnerOrder(f.owner, id))).tasks[0]!.state,
      ).toBe("pending");
      expect(
        (
          await run(() =>
            decideProposal(f.owner, {
              proposalId: suggestion.proposalId,
              approve: true,
            }),
          )
        ).state,
      ).toBe("executed");
      await expect(
        run(() =>
          decideProposal(f.owner, {
            proposalId: suggestion.proposalId,
            approve: true,
          }),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        (await run(() => queryDesk(f.owner, { view: "completed" }))).rows.map(
          (r) => r.id,
        ),
      ).toContain(id);
    });
    it.each(["goods", "service"] as const)(
      "rolls back %s fulfillment when its audit fails",
      async (kind) => {
        const id = await buy(kind),
          order = await run(() => getOwnerOrder(f.owner, id)),
          task = order.tasks.find(
            (t) =>
              t.type === (kind === "goods" ? "pickup" : "service_followup"),
          )!;
        if (dialect === "postgres") {
          await f.query(
            "create or replace function reject_fulfillment_audit() returns trigger language plpgsql as $$ begin if NEW.operation like 'fulfillment.%' then raise exception 'injected fulfillment audit failure'; end if; return NEW; end $$",
          );
          await f.query(
            "create trigger fail_fulfillment_audit before insert on audit_event for each row execute function reject_fulfillment_audit()",
          );
        } else
          await f.query(
            "create trigger fail_fulfillment_audit before insert on audit_event when NEW.operation like 'fulfillment.%' begin select raise(abort,'injected fulfillment audit failure'); end",
          );
        try {
          await expect(
            run(() =>
              kind === "goods"
                ? completePickup(f.owner, {
                    taskId: task.id,
                    expectedRevision: 1,
                    note: "Collected",
                  })
                : recordServiceFollowUp(f.owner, {
                    taskId: task.id,
                    expectedRevision: 1,
                    note: "Thursday at 2",
                    timeConfirmed: true,
                  }),
            ),
          ).rejects.toThrow();
          expect(
            (
              await f.query(
                "select state,revision from fulfillment_task where id=?",
                [task.id],
              )
            )[0],
          ).toEqual({ state: "pending", revision: 1 });
        } finally {
          await f.query(
            dialect === "postgres"
              ? "drop trigger fail_fulfillment_audit on audit_event"
              : "drop trigger fail_fulfillment_audit",
          );
        }
      },
    );
  });
