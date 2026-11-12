/**
 * The setup instructions a coding agent fetches and follows to connect itself to this installation:
 * save the Seller Desk skill and add the connector, per agent. Setup copies one line that points at
 * it, so the owner pastes one sentence instead of following steps. Every command carries this
 * installation's own address.
 */
import { SKILL_NAME } from "./agent-skill";

/**
 * The one line Setup copies for a coding agent.
 *
 * @param appUrl - This installation's address, such as https://shop.example.com
 */
export function setupLine(appUrl: string): string {
  return `Fetch and follow the instructions to connect me to my Seller Desk from ${appUrl.replace(/\/$/, "")}/agent-setup/prompt.md`;
}

/**
 * The prompt.md text for one installation.
 *
 * @param appUrl - This installation's address
 */
export function setupPrompt(appUrl: string): string {
  const origin = appUrl.replace(/\/$/, "");
  const mcp = `${origin}/api/mcp`;
  const skill = `${origin}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;
  const fetchSkill = (dir: string) => `mkdir -p ${dir}/${SKILL_NAME} && curl -fsSL ${skill} -o ${dir}/${SKILL_NAME}/SKILL.md`;
  return `These are the setup instructions for Seller Desk at ${origin}. Seller Desk is the user's shop desk. Once connected you can see which buyers are waiting, read conversations, orders, payments and offers, and draft answers. You can send an answer to a waiting customer only if the user turned that on in Seller Desk Setup and asks you to; you cannot change offers, prices, stock, orders or payments.

Complete the steps for your agent yourself by running the commands. Do not ask the user to run them. Sign-in happens in the browser with the shop owner's account the first time you use a Seller Desk tool, and the owner approves your access there.

---

## Claude Code

Run \`claude mcp list\` first. If seller-desk is already listed, skip the \`claude mcp add\` line.

\`\`\`
${fetchSkill("~/.claude/skills")}
claude mcp add --transport http --scope user seller-desk ${mcp}
\`\`\`

Then tell the user to run \`/reload-skills\`, then \`/mcp\` inside Claude Code and sign in to seller-desk.

## Codex

\`codex mcp add\` opens the sign-in itself. Run \`codex mcp login seller-desk\` only if no browser window opened.

\`\`\`
${fetchSkill("~/.agents/skills")}
codex mcp add seller-desk --url ${mcp}
\`\`\`

## Cursor

\`\`\`
${fetchSkill("~/.agents/skills")}
\`\`\`

Add this under "mcpServers" in \`~/.cursor/mcp.json\`, keeping the entries already there:

\`\`\`json
"seller-desk": { "url": "${mcp}" }
\`\`\`

## Any other agent

Save ${skill} as \`${SKILL_NAME}/SKILL.md\` in your skills folder, and add a remote MCP server (Streamable HTTP) named seller-desk at ${mcp}. Sign-in starts on first use.

## ChatGPT or Claude in the browser

These cannot run commands. Tell the user to add ${mcp} as a custom connector in the app's settings and sign in when asked.

---

Once the user has signed in, call \`list_waiting\`. Only when it answers, tell the user:

\`\`\`
Seller Desk connected
  Skill   <path>
  Server  seller-desk, ${mcp}
Ask me what needs you today.
\`\`\`

If a tool still asks for sign-in, say the connector is added but not signed in yet.
`;
}
