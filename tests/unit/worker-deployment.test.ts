import { expect, it } from "vitest";
import { deployedWorkerAddress } from "../../scripts/lib/worker-deployment";

it("uses the renamed Worker's actual structured deployment address", () => {
  expect(deployedWorkerAddress(JSON.stringify({ type: "deploy", version: 1, worker_name: "isabel-shop", targets: ["https://isabel-shop.account-example.workers.dev", "schedule: * * * * *"] }))).toEqual({ name: "isabel-shop", origin: "https://isabel-shop.account-example.workers.dev" });
});
it("refuses missing, ambiguous or non-Workers destinations instead of guessing an origin", () => {
  for (const targets of [[], ["https://attacker.example.test"], ["https://one.example.workers.dev", "https://two.example.workers.dev"], ["https://one.example.workers.dev/path"], ["http://one.example.workers.dev"]]) expect(() => deployedWorkerAddress(JSON.stringify({ type: "deploy", version: 1, worker_name: "isabel-shop", targets }))).toThrow();
});
