import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: native constraints`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    it("rejects oversold stock and invalid money without modifying existing rows", async () => {
      for (const sql of [
        "update inventory set held=3",
        "update inventory set sold=-1",
        "update inventory set total=2147483648",
      ])
        await expect(f.query(sql)).rejects.toThrow();
      for (const amount of [-1, 0, 10000001, 1.5])
        await expect(
          f.query("update offer set unit_amount_minor=? where id=?", [
            amount,
            f.goodsId,
          ]),
        ).rejects.toThrow();
      expect(
        (await f.query("select total,held,sold from inventory"))[0],
      ).toEqual({ total: 2, held: 0, sold: 0 });
    });
    it("retains every image path rule, currency rule and required digital relationship", async () => {
      for (const image of [
        "https://elsewhere.test/a.jpg",
        "/shop/.jpg",
        "/shop/a/b.jpg",
        "/shop/UPPER.jpg",
        "/shop/" + "x".repeat(61) + ".png",
      ])
        await expect(
          f.query("update offer set image_path=? where id=?", [
            image,
            f.goodsId,
          ]),
        ).rejects.toThrow();
      for (const image of [
        "/shop/a.jpg",
        "/shop/front-light.webp",
        "/shop/" + "x".repeat(60) + ".png",
        null,
      ])
        await f.query("update offer set image_path=? where id=?", [
          image,
          f.goodsId,
        ]);
      await expect(
        f.query("update offer set currency='usd' where id=?", [f.goodsId]),
      ).rejects.toThrow();
      await expect(
        f.query("update offer set digital_asset_id=? where id=?", [
          crypto.randomUUID(),
          f.digitalId,
        ]),
      ).rejects.toThrow();
      await expect(
        f.query("delete from digital_asset where id=?", [f.assetId]),
      ).rejects.toThrow();
      expect(
        String((await f.query("select count(*) n from digital_asset"))[0]!.n),
      ).toBe("1");
    });
    it("round-trips a private one MiB asset exactly and rejects a size mismatch", async () => {
      const bytes = Buffer.alloc(1048576);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
      await f.query(
        "update digital_asset set bytes=?,size_bytes=? where id=?",
        [bytes, bytes.length, f.assetId],
      );
      const [row] = await f.query(
        "select bytes,size_bytes from digital_asset where id=?",
        [f.assetId],
      );
      // Native D1 returns BLOBs as a byte array; PostgreSQL returns Buffer.
      expect(Buffer.from(row!.bytes as Uint8Array)).toEqual(bytes);
      await expect(
        f.query("update digital_asset set size_bytes=4 where id=?", [
          f.assetId,
        ]),
      ).rejects.toThrow();
    });
  });
