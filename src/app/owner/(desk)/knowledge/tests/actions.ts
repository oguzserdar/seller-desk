"use server";
import { SimulationInput } from "@/lib/simulation";
import { ownerAction } from "@/server/actions/safe-action";
import { executeSimulation } from "@/server/simulation/execute";

/** Runs the validated fictional actor plan after re-establishing owner identity inside the action. */
export const runSimulationAction = ownerAction.inputSchema(SimulationInput).action(async ({ parsedInput, ctx }) => {
  const result = await executeSimulation(ctx.owner, parsedInput);
  // The client refreshes in a separate request. Do not add the whole owner
  // layout's reads to this long-running request's D1 query budget.
  return result;
});
