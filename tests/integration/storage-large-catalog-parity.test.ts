import { loadOwnerHistory } from "@/server/ai/owner-conversation";
import { listPublishedOffers } from "@/server/domain/offers";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: published catalog beyond one parameter batch`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    it("loads availability for 120 products with native storage instead of exceeding D1's binding limit", async () => {
      for (let i = 0; i < 117; i++)
        await f.query(
          "insert into offer(id,seller_id,kind,published,title,description,unit_amount_minor,currency,service_scope) values(?,?,?,?,?,?,?,?,?)",
          [
            crypto.randomUUID(),
            f.owner.sellerId,
            "service",
            true,
            `Service ${i}`,
            "Acceptance service",
            1000,
            "USD",
            "Fixed work",
          ],
        );
      expect(
        await run(() => listPublishedOffers(f.owner.sellerId)),
      ).toHaveLength(120);
    });
    it("recovers all saved approval decisions across 40 messages without a parameter overflow", async () => {
      const conversation = crypto.randomUUID();
      await f.query(
        "insert into owner_conversation(id,owner_id,seller_id) values(?,?,?)",
        [conversation, f.owner.userId, f.owner.sellerId],
      );
      for (let i = 0; i < 40; i++) {
        const parts = Array.from({ length: 3 }, () => ({
          type: "tool-propose_action",
          toolCallId: crypto.randomUUID(),
          state: "output-available",
          input: { action: "mark_picked_up", targetId: crypto.randomUUID() },
          output: { proposalId: crypto.randomUUID() },
        }));
        await f.query(
          `insert into owner_message(id,conversation_id,sequence,role,parts) ${dialect === "postgres" ? "overriding system value" : ""} values(?,?,?,?,?)`,
          [
            crypto.randomUUID(),
            conversation,
            i + 1,
            "assistant",
            JSON.stringify(parts),
          ],
        );
      }
      const history = await run(() => loadOwnerHistory(f.owner));
      expect(history.messages).toHaveLength(40);
      expect(Object.keys(history.decisions)).toHaveLength(120);
      expect(
        Object.values(history.decisions).every(
          (value) => value.state === "unconfirmed",
        ),
      ).toBe(true);
    });
  });
