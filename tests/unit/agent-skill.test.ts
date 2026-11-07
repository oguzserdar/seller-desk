/**
 * @fileoverview The agent skill and setup prompt a coding agent fetches to connect itself.
 * - The skill describes exactly the tools the connector registers.
 * - The discovery digest is the SHA-256 of the served SKILL.md.
 * - Every address in the setup prompt is this installation's own.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SKILL_NAME, SKILL_TOOL_NAMES, skillIndex, skillMarkdown } from "@/lib/agent-skill";
import { setupLine, setupPrompt } from "@/lib/agent-setup";
import { buildConnectorServer } from "@/server/connector/tools";

const MCP = "https://shop.example.com/api/mcp";

describe("agent skill", () => {
  it("names exactly the tools the connector registers", () => {
    const server = buildConnectorServer({ kind: "owner", userId: "u", sellerId: "s" } as never);
    // Private on purpose: if the MCP library renames it, this fails instead of passing on an empty list.
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(registered.length).toBeGreaterThan(0);
    expect([...SKILL_TOOL_NAMES].sort()).toEqual(registered.sort());
  });

  it("starts with Agent Skills front matter and carries the connector address", () => {
    const md = skillMarkdown(MCP);
    expect(md.startsWith(`---\nname: ${SKILL_NAME}\ndescription: "`)).toBe(true);
    expect(md).toContain(MCP);
  });

  it("publishes the digest of the text it serves", async () => {
    const index = await skillIndex(MCP);
    const expected = createHash("sha256").update(skillMarkdown(MCP)).digest("hex");
    expect(index.skills[0]).toMatchObject({ name: SKILL_NAME, url: `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`, digest: `sha256:${expected}` });
  });
});

describe("agent setup", () => {
  it("points every command at this installation, with or without a trailing slash", () => {
    for (const appUrl of ["https://shop.example.com", "https://shop.example.com/"]) {
      expect(setupLine(appUrl)).toBe("Fetch and follow the instructions to connect me to my Seller Desk from https://shop.example.com/agent-setup/prompt.md");
      const prompt = setupPrompt(appUrl);
      const urls = prompt.match(/https?:\/\/[^\s"`)]+/g) ?? [];
      expect(urls.length).toBeGreaterThan(3);
      for (const url of urls) expect(new URL(url.replace(/[.,]$/, "")).origin).toBe("https://shop.example.com");
      expect(prompt).not.toContain("//api");
    }
  });
});
