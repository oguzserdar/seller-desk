import { armFault, decideFixtureOrder } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import {
  downloadWithGrant,
  retryAccess,
  storeAsset,
} from "@/server/domain/digital";
import { saveOffer } from "@/server/domain/offers";
import {
  buyerOrderFollowup,
  replyOrderFollowup,
} from "@/server/domain/order-followup";
import {
  completePickup,
  getBuyerOrder,
  getOwnerOrder,
  recordServiceFollowUp,
} from "@/server/domain/orders";
import { approveQuoteScope, proposeQuote } from "@/server/domain/quotes";
import { getSeller } from "@/server/domain/seller";
import { completeServiceWork } from "@/server/domain/service-work";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { withD1Database } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

// These are the application's actual public domain functions and shared payment
// driver. Explicit payment simulation only; no scripted AI answers or AI mocks.
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: shared public commerce journeys`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    function run<T>(work: () => Promise<T>): Promise<T> {
      return f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    }
    async function approve(url: string) {
      const id = url.split("/").at(-1)!;
      await run(async () => {
        const store = getStorage();
        if (store.kind === "d1")
          await store.fixture.decideFixtureOrder(id, "approve");
        else await decideFixtureOrder(getDb(), id, "approve");
      });
    }
    async function fault(
      name:
        | "create_lost_after_effect"
        | "capture_lost_after_effect"
        | "access_storage_error",
    ) {
      await run(async () => {
        const store = getStorage();
        if (store.kind === "d1") await store.fixture.armFault(name);
        else await armFault(getDb(), name);
      });
    }
    async function purchase(offerId: string) {
      const q = await run(() =>
        proposeQuote(f.buyer, { lines: [{ offerId, quantity: 1 }] }),
      );
      const checkout = await run(() =>
        startCheckout(f.buyer, { quoteId: q.id, revision: q.revision }),
      );
      expect(checkout.approvalUrl).toBeTruthy();
      await approve(checkout.approvalUrl!);
      const paid = await run(() =>
        reconcilePayment(f.buyer, checkout.attemptId, { mayCapture: true }),
      );
      expect(paid.state).toBe("paid");
      return paid.order!.id;
    }
    it("buys goods, restores a paid receipt, records pickup and retains explicit customer-help history", async () => {
      const id = await purchase(f.goodsId);
      let view = await run(() =>
        getBuyerOrder({ buyer: f.buyer, key: null }, id),
      );
      expect(view.number).toBe(1001);
      expect(view.tasks[0]!.label).toBe("Paid, pickup pending");
      await expect(
        run(() =>
          getBuyerOrder(
            {
              buyer: { ...f.buyer, buyerSessionId: crypto.randomUUID() },
              key: null,
            },
            id,
          ),
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        (
          await run(() =>
            getBuyerOrder({ buyer: null, key: view.accessKey }, id),
          )
        ).id,
      ).toBe(id);
      const owned = await run(() => getOwnerOrder(f.owner, id));
      await run(() =>
        completePickup(f.owner, {
          taskId: owned.tasks[0]!.id,
          expectedRevision: 1,
          note: "Collected by the buyer",
        }),
      );
      view = await run(() => getBuyerOrder({ buyer: f.buyer, key: null }, id));
      expect(view.tasks[0]!.label).toBe("Picked up");
      const help = await run(() =>
        buyerOrderFollowup(
          { buyer: f.buyer, key: null },
          {
            orderId: id,
            expectedRevision: 0,
            action: "help",
            message: "The handle is broken",
          },
        ),
      );
      expect(help.state).toBe("needs_help");
      const answer = await run(() =>
        replyOrderFollowup(f.owner, {
          orderId: id,
          expectedRevision: 1,
          message: "Bring it back and I will inspect it",
        }),
      );
      expect(answer.state).toBe("awaiting_customer");
      const confirmed = await run(() =>
        buyerOrderFollowup(
          { buyer: f.buyer, key: null },
          { orderId: id, expectedRevision: 2, action: "confirm" },
        ),
      );
      expect(confirmed.state).toBe("confirmed");
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 0,
        sold: 1,
      });
    });
    it("uploads private bytes, sells the digital product, downloads once and refuses revoked access", async () => {
      const bytes = Buffer.from(
        "%PDF-1.4\nSeller Desk storage acceptance PDF bytes\n",
      );
      const asset = await run(() =>
        storeAsset(f.owner, { filename: "../private-guide.pdf", bytes }),
      );
      const shop = (await run(() => getSeller()))!;
      await run(() =>
        saveOffer(f.owner, shop, {
          id: f.digitalId,
          expectedRevision: 1,
          kind: "digital",
          title: "Private guide",
          description: "A private PDF",
          unitAmountMinor: 2500,
          fulfillmentNote: "Download after verified payment",
          requiresScopeReview: false,
          serviceScope: null,
          accessDays: 30,
          digitalAssetId: asset.id,
          maxQuantity: 1,
          stockTotal: null,
        }),
      );
      const id = await purchase(f.digitalId),
        view = await run(() =>
          getBuyerOrder({ buyer: f.buyer, key: null }, id),
        );
      expect(view.downloads).toHaveLength(1);
      const grant = view.downloads[0]!;
      expect(
        (await run(() => downloadWithGrant(grant.grantId, grant.token))).bytes,
      ).toEqual(bytes);
      expect(
        (
          await f.query("select download_count from access_grant where id=?", [
            grant.grantId,
          ])
        )[0]!.download_count,
      ).toBe(1);
      await f.query("update access_grant set state='revoked' where id=?", [
        grant.grantId,
      ]);
      expect((await run(() => retryAccess(f.owner, id))).outcome).toBe(
        "not_eligible",
      );
      await expect(
        run(() => downloadWithGrant(grant.grantId, grant.token)),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        (await run(() => getBuyerOrder({ buyer: f.buyer, key: null }, id)))
          .downloads,
      ).toEqual([]);
    });
    it("sells a custom service after seller review and keeps timing, work and payment separate", async () => {
      const shop = (await run(() => getSeller()))!;
      await run(() =>
        saveOffer(f.owner, shop, {
          id: f.serviceId,
          expectedRevision: 1,
          kind: "service",
          title: "Custom repair",
          description: "Review a repair",
          unitAmountMinor: null,
          fulfillmentNote: "Arrange timing after payment",
          requiresScopeReview: true,
          serviceScope: "Repair subject to scope review",
          accessDays: null,
          digitalAssetId: null,
          maxQuantity: 1,
          stockTotal: null,
        }),
      );
      const q = await run(() =>
        proposeQuote(f.buyer, {
          lines: [{ offerId: f.serviceId, quantity: 1 }],
          buyerNote: "Repair my damaged wheel",
        }),
      );
      expect(q.status).toBe("seller_review");
      const reviewed = await run(() =>
        approveQuoteScope(f.owner, {
          quoteId: q.id,
          expectedRevision: 1,
          approvedScope: "Repair one wheel including parts",
          prices: [{ offerId: f.serviceId, unitAmountMinor: 9000 }],
        }),
      );
      const checkout = await run(() =>
        startCheckout(f.buyer, { quoteId: reviewed.id, revision: 2 }),
      );
      await approve(checkout.approvalUrl!);
      const paid = await run(() =>
          reconcilePayment(f.buyer, checkout.attemptId, { mayCapture: true }),
        ),
        id = paid.order!.id;
      const owned = await run(() => getOwnerOrder(f.owner, id)),
        timing = owned.tasks.find((task) => task.type === "service_followup")!,
        work = owned.tasks.find((task) => task.type === "service_work")!;
      await run(() =>
        recordServiceFollowUp(f.owner, {
          taskId: timing.id,
          expectedRevision: 1,
          note: "Confirmed Thursday at 2 pm",
          timeConfirmed: true,
        }),
      );
      let view = await run(() =>
        getBuyerOrder({ buyer: f.buyer, key: null }, id),
      );
      expect(
        view.tasks.find((task) => task.type === "service_work")!.state,
      ).toBe("pending");
      await run(() =>
        completeServiceWork(f.owner, {
          taskId: work.id,
          expectedRevision: 1,
          note: "Replaced and tested the wheel",
        }),
      );
      view = await run(() => getBuyerOrder({ buyer: f.buyer, key: null }, id));
      expect(
        view.tasks.find((task) => task.type === "service_work")!.state,
      ).toBe("completed");
      expect(view.followup.state).toBe("none");
      expect(
        (await f.query("select state from payment_attempt"))[0]!.state,
      ).toBe("paid");
    });
    it("recovers lost create and capture responses without creating a second provider charge", async () => {
      const q = await run(() =>
        proposeQuote(f.buyer, { lines: [{ offerId: f.goodsId, quantity: 1 }] }),
      );
      await fault("create_lost_after_effect");
      const first = await run(() =>
        startCheckout(f.buyer, { quoteId: q.id, revision: 1 }),
      );
      expect(first.state).toBe("create_in_flight");
      const created = await run(() =>
        reconcilePayment(f.buyer, first.attemptId, { mayCapture: false }),
      );
      expect(created.state).toBe("order_created");
      await approve(created.approvalUrl!);
      await fault("capture_lost_after_effect");
      const paid = await run(() =>
        reconcilePayment(f.buyer, first.attemptId, { mayCapture: true }),
      );
      expect(paid.state).toBe("paid");
      await run(() =>
        reconcilePayment(f.buyer, first.attemptId, { mayCapture: true }),
      );
      expect(
        Number(
          (await f.query("select count(*) n from fixture_provider_order"))[0]!
            .n,
        ),
      ).toBe(1);
      expect(
        Number((await f.query("select count(*) n from orders"))[0]!.n),
      ).toBe(1);
    });
    it("leaves a verified payment intact when digital delivery fails, then recovers access without another payment", async () => {
      const q = await run(() =>
          proposeQuote(f.buyer, {
            lines: [{ offerId: f.digitalId, quantity: 1 }],
          }),
        ),
        checkout = await run(() =>
          startCheckout(f.buyer, { quoteId: q.id, revision: 1 }),
        );
      await approve(checkout.approvalUrl!);
      await fault("access_storage_error");
      const paid = await run(() =>
        reconcilePayment(f.buyer, checkout.attemptId, { mayCapture: true }),
      );
      expect(paid.state).toBe("paid");
      const id = paid.order!.id;
      const before = await run(() =>
        getBuyerOrder({ buyer: f.buyer, key: null }, id),
      );
      expect(before.downloads).toHaveLength(0);
      expect(before.canRetryAccess).toBe(true);
      expect((await run(() => retryAccess(f.owner, id))).outcome).toBe(
        "granted",
      );
      expect(
        (await run(() => getBuyerOrder({ buyer: f.buyer, key: null }, id)))
          .downloads,
      ).toHaveLength(1);
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from fixture_provider_order where capture_id is not null",
            )
          )[0]!.n,
        ),
      ).toBe(1);
    });
  });
