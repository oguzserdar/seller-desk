import { describe, expect, it } from "vitest";
import { maskSecret, openSecret, parseSettingsKey, sealSecret } from "@/server/secret-box";

const KEY = parseSettingsKey("a".repeat(64))!;
const OTHER = parseSettingsKey("b".repeat(64))!;

describe("secret box", () => {
  it("round-trips a value and never stores it in the clear", async () => {
    const sealed = await sealSecret(KEY, "purpose-a", "sk-ant-fake-1234");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("secret-value");
    expect(await openSecret(KEY, "purpose-a", sealed)).toBe("sk-ant-fake-1234");
  });

  it("uses a fresh IV, so equal values seal differently", async () => {
    const a = await sealSecret(KEY, "p", "same");
    const b = await sealSecret(KEY, "p", "same");
    expect(a).not.toBe(b);
  });

  it("refuses a different key, a different purpose, tampering and unknown versions", async () => {
    const sealed = await sealSecret(KEY, "purpose-a", "value-to-protect");
    expect(await openSecret(OTHER, "purpose-a", sealed)).toBeNull();
    expect(await openSecret(KEY, "purpose-b", sealed)).toBeNull();
    const body = sealed.slice(3);
    const flipped = `v1.${body.slice(0, -2)}${body.at(-2) === "A" ? "B" : "A"}${body.at(-1)}`;
    expect(await openSecret(KEY, "purpose-a", flipped)).toBeNull();
    expect(await openSecret(KEY, "purpose-a", `v2.${body}`)).toBeNull();
    expect(await openSecret(KEY, "purpose-a", "v1.")).toBeNull();
    expect(await openSecret(KEY, "purpose-a", "v1.%%%")).toBeNull();
  });

  it("accepts only a 64-hex host key", () => {
    expect(parseSettingsKey(undefined)).toBeNull();
    expect(parseSettingsKey("a".repeat(63))).toBeNull();
    expect(parseSettingsKey("g".repeat(64))).toBeNull();
    expect(parseSettingsKey("0F".repeat(32))?.length).toBe(32);
  });

  it("masks keys to a known prefix and the last four characters", () => {
    expect(maskSecret("sk-ant-fake-key-wxyz")).toBe("sk-ant-••••wxyz");
    expect(maskSecret("AIzaSyExampleExampleExample1234")).toBe("AIza••••1234");
    expect(maskSecret("short")).toBe("••••");
  });
});
