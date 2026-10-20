import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import path from "node:path";
import { readCloudflareSettings } from "./cloudflare.config";

export default defineConfig(({ mode }) => {
  const settings = readCloudflareSettings(mode);
  return {
    resolve: { alias: { "@/server/simulation/node-sqlite": path.resolve("src/server/simulation/worker-node-disabled.ts") } },
    plugins: [
      vinext(),
      cloudflare({
        ...(settings.DATABASE_KIND === "d1"
          ? {
              persistState: {
                path: settings.D1_LOCAL_STATE_PATH || ".seller-desk/d1",
              },
            }
          : {}),
        viteEnvironment: {
          name: "rsc",
          childEnvironments: ["ssr"],
        },
      }),
    ],
  };
});
