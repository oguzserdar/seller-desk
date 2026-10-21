import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversationStorage } from "../support/conversation-storage";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

// Storage fixtures only. No model is invoked.
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: Stop frees the buyer's turn`, () => {
    let f: StorageFixture, p: ReturnType<typeof conversationStorage>;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
      p = conversationStorage(f);
    });
    afterEach(async () => {
      await f?.close();
    });

    it("lets the buyer send again at once and stops the old worker committing", async () => {
      const id = await p.ensureConversation(f.buyer);
      const running = await p.claimTurn(f.buyer, id);
      expect(running).toBeTruthy();
      expect(await p.claimTurn(f.buyer, id)).toBeUndefined();

      await p.stopTurn(f.buyer, id);

      const next = await p.claimTurn(f.buyer, id);
      expect(next).toBeTruthy();
      await p.releaseTurn(running!);
      expect(await p.claimTurn(f.buyer, id)).toBeUndefined();
    });
  });
