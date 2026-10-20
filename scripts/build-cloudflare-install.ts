/** Build only: the template's Wrangler config remains the authoritative deployment destination. */
import { spawnSync } from "node:child_process";
// Never load this checkout's private .dev.vars or existing account/database IDs.
const env = { ...process.env, SELLER_DESK_INSTALL_BUILD: "1", DATABASE_KIND: "d1" };
const child = spawnSync("pnpm", ["build:cloudflare", "--mode", "install"], { env, stdio: "inherit" });
if (child.error || child.status !== 0) throw new Error("The Cloudflare installation build failed.");
