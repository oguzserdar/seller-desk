/** Platform build dispatch. Local and Vercel builds stay native Next.js; Workers CI builds the Worker. */
import { spawnSync } from "node:child_process";
const cloudflare = ["1", "true"].includes(process.env.WORKERS_CI ?? "");
const child = spawnSync("pnpm", cloudflare ? ["build:cloudflare:install"] : ["exec", "next", "build"], { stdio: "inherit", env: process.env });
if (child.error || child.status !== 0) process.exitCode = child.status || 1;
