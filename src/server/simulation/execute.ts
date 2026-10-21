/** Real buyer runtime inside isolated shops. Existing app and sandbox databases are never reset. */
import {
  SimulationInput,
  type SimulationSideResult,
  type SimulationStep,
} from "@/lib/simulation";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import type { LanguageModel } from "ai";
import { getAssistantModel } from "@/server/ai/registry";
import { getDb } from "@/server/db/client";
import { resolveBuyer, startBuyerSession } from "@/server/domain/buyer-session";
import { DomainError, invalid } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { hasUsageLeft, requireUsage } from "@/server/domain/usage";
import {
  getRequestScope,
  withD1Database,
  withRequestDatabase,
} from "@/server/request-scope";
import { executeSimulationActor } from "./actors";
import { installSimulationShop } from "./install-snapshot";
import { simulationTranscript } from "./observe";
import {
  claimSimulation,
  failSimulation,
  listSimulations,
  saveSimulationResult,
  simulationSnapshotForSide,
  simulationView,
} from "./runs";
import { withIsolatedSimulation, type SimulationTarget } from "./scope";
import { executeSimulationTurn } from "./turn";
import { nextCustomerMessage } from "./simulated-customer";
import { withFreshSimulation } from "./trial-database";

/** Trusted operator configuration only. Never accept database destinations from an HTTP body or model. */
export type SimulationTargets = {
  current: SimulationTarget;
  proposed?: SimulationTarget;
};

/**
 * Executes a bounded actor plan on each frozen shop version, sequentially.
 * Uses the same authenticated handler, routing, tools and approvals as real chat.
 * Expected outcomes are for seller review, never injected as desired model answers.
 * Seller runs allocate fresh isolated storage for each side. Explicit operator
 * destinations remain available for independent dialect acceptance tests. The plan
 * is saved before execution; only explicit fictional actors approve scope/payment.
 */
export async function executeSimulation(
  owner: OwnerPrincipal,
  raw: SimulationInput,
  targets?: SimulationTargets,
) {
  const input = SimulationInput.parse(raw);
  const assistant = await getAssistantModel();
  if (!assistant.ok)
    throw new DomainError(
      "unavailable",
      "Connect an AI model before running shop tests.",
    );
  if (
    targets && input.change.kind === "instruction" &&
    (!targets.proposed || targets.proposed === targets.current)
  ) {
    throw invalid("A comparison needs two separate simulation databases.");
  }
  const claimed = await claimSimulation(
    owner,
    input,
    `configured ${assistant.provider}:${assistant.modelId}`,
  );
  if (!claimed.created) return simulationView(claimed.row);
  let row = claimed.row;
  const native = getRequestScope()?.d1;
  const source = native ? null : getDb();
  const deadline = Date.now() + 240_000;
  const reserveTurn = () => {
    if (Date.now() + 45_000 > deadline) throw new DomainError("unavailable", "This test reached its time limit. Earlier results are kept; try a shorter plan.");
    const reserve = () =>
      requireUsage(
        "seller_ai_day",
        owner.sellerId,
        86_400,
        row.snapshot.shop.sellerDailyAiTurns,
        "The shop assistant has reached its daily limit.",
      );
    return native
      ? withD1Database(native, reserve)
      : withRequestDatabase(source!, reserve);
  };
  try {
    await requireUsage(
      "simulation",
      owner.sellerId,
      600,
      5,
      "Wait before starting more shop tests.",
    );
    // Look before opening a target: a shop with no AI turns left must not install a fictional copy it cannot use.
    if (
      !(await hasUsageLeft(
        "seller_ai_day",
        owner.sellerId,
        86_400,
        row.snapshot.shop.sellerDailyAiTurns,
      ))
    ) {
      throw new DomainError(
        "rate_limited",
        "The shop assistant has reached its daily limit.",
      );
    }
    const sides = row.change
      ? (["current", "proposed"] as const)
      : (["current"] as const);
    for (const side of sides) {
      const operation = async () => {
          const snapshot = simulationSnapshotForSide(row, side);
          const installed = await installSimulationShop(snapshot);
          const titles = snapshot.products.map((product) => product.title);
          return executeScenario(input, installed, reserveTurn, { model: assistant.model, titles });
        };
      const observed = targets
        ? await withIsolatedSimulation(owner, targets[side]!, operation)
        : await withFreshSimulation(owner, operation);
      row = await saveSimulationResult(
        owner,
        row.id,
        side,
        observed.result,
        observed.finished,
      );
      if (!observed.finished) break;
    }
  } catch (error) {
    // Never log raw SQL, provider bodies, prompts or customer data.
    console.warn("Seller trial stopped", { runId: row.id, category: error instanceof DomainError ? error.code : "internal" });
    await failSimulation(owner, row.id);
    const saved = (await listSimulations(owner)).find(
      (run) => run.id === row.id,
    );
    if (!saved) throw new Error("The saved simulation is unavailable.");
    return saved;
  }
  return simulationView(row);
}

const STEP_NAME: Record<SimulationStep["kind"], string> = {
  customer: "customer message",
  seller_reply: "seller reply",
  simulated_customer: "simulated customer",
  approve_scope: "seller scope approval",
  pay_quote: "fictional payment",
};

/** Preserves successful earlier turns and actor effects when any later step stops. */
async function executeScenario(
  input: SimulationInput,
  installed: Awaited<ReturnType<typeof installSimulationShop>>,
  reserveTurn: () => Promise<void>,
  simulator: { model: LanguageModel; titles: string[] },
) {
  if (!getRequestScope()?.simulation)
    throw new Error("Scenario execution requires simulation isolation.");
  const issued = await startBuyerSession("page"),
    buyer = await resolveBuyer(issued.token);
  const conversationId = await ensureConversation(buyer);
  const approvals: SimulationSideResult["approvals"] = [];
  // Assigned inside customerTurn, so the declared type is kept wide on purpose.
  let result = null as SimulationSideResult | null;
  let turns = 0,
    elapsed = 0;
  const checks: SimulationSideResult["checks"] = [];
  const plan = [
    { kind: "customer" as const, text: input.scenario },
    ...(input.steps ?? []),
  ];
  let stepNumber = 0;
  /** Runs one real assistant turn; returns the stopped result when the reply did not finish. */
  const customerTurn = async (text: string) => {
    await reserveTurn();
    const turn = await executeSimulationTurn(text, issued, buyer, conversationId, approvals);
    turns++;
    elapsed += turn.result.latencyMs;
    result = turn.result;
    checks.push(...result.checks.map((check) => ({ ...check, label: `Turn ${turns}: ${check.label}` })));
    return turn.finished ? null : { result: { ...result, checks, latencyMs: elapsed }, finished: false as const };
  };
  try {
    for (const step of plan) {
      stepNumber++;
      if (step.kind === "customer") {
        const stopped = await customerTurn(step.text);
        if (stopped) return stopped;
      } else if (step.kind === "simulated_customer") {
        for (let turn = 0; turn < step.turns; turn++) {
          // Writing the customer's message is a model call too, so it counts against the same daily limit.
          await reserveTurn();
          const { transcript } = simulationTranscript(await loadMessages(conversationId), issued.token);
          const text = await nextCustomerMessage(simulator.model, step.persona, simulator.titles, transcript, turn === step.turns - 1);
          const stopped = await customerTurn(text);
          if (stopped) return stopped;
        }
      } else {
        await executeSimulationActor({
          step,
          installed,
          buyer,
          conversationId,
          approvals,
        });
        checks.push({
          label: `Fictional ${step.kind}`,
          passed: true,
          detail:
            "The explicit saved actor action completed through the existing domain controls.",
        });
      }
    }
  } catch (error) {
    // Domain refusals are written for people; anything else may carry provider or database detail, so it stays generic.
    const reason =
      error instanceof DomainError
        ? error.message
        : "An unexpected error stopped it.";
    const kind = plan[stepNumber - 1]?.kind ?? "customer";
    checks.push({
      label: `Step ${stepNumber} of ${plan.length} stopped (${STEP_NAME[kind]})`,
      passed: false,
      detail: `${reason} No later step ran; earlier messages, approvals and records are kept.`,
    });
    if (!result)
      throw new Error("The trial stopped before its first model result.");
    result = {
      ...result,
      ...simulationTranscript(await loadMessages(conversationId), issued.token),
      approvals: [...approvals],
      checks,
      latencyMs: elapsed,
    };
    return { result: await refreshRecords(result), finished: false };
  }
  if (!result) throw new Error("No real turn was executed.");
  return {
    result: await refreshRecords({
      ...result,
      ...simulationTranscript(await loadMessages(conversationId), issued.token),
      approvals: [...approvals],
      checks,
      latencyMs: elapsed,
    }),
    finished: true,
  };
}

async function refreshRecords(
  result: SimulationSideResult,
): Promise<SimulationSideResult> {
  const { readSimulationRecords } = await import("./records");
  return { ...result, records: await readSimulationRecords() };
}
