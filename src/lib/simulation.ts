/** Browser-safe inputs and recorded evidence for private seller simulations. */
import { z } from "zod";
import type { ProcedureContent } from "./assistant-procedure";
import { PERSONA_IDS } from "./simulation-personas";

/** Matches the maximum host request lifetime; execution stops admitting AI work earlier. */
export const SIMULATION_RUN_TTL_MS = 300_000;

/** Exact selected purchase; a model-created quote alone never authorizes a fixture payment. */
const ExpectedQuote = z.object({
  lines: z.array(z.object({ sourceOfferId: z.uuid(), quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(10),
  totalMinor: z.number().int().positive().max(10000000), currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
/** Human-authored fictional actors. No step can supply an assistant reply or live payment credentials. */
export const SimulationStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer"), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("seller_reply"), text: z.string().trim().min(1).max(1000) }).strict(),
  // A preset customer played by a model for a few turns; it writes customer messages only, never replies or approvals.
  z.object({ kind: z.literal("simulated_customer"), persona: z.enum(PERSONA_IDS), turns: z.number().int().min(1).max(3) }).strict(),
  // The total is the one the seller means to approve; it is checked after approval, when custom prices exist.
  z.object({ kind: z.literal("approve_scope"), expected: ExpectedQuote, scope: z.string().trim().min(3).max(1000),
    prices: z.array(z.object({ sourceOfferId: z.uuid(), unitAmountMinor: z.number().int().positive().max(10000000) }).strict()).max(10) }).strict(),
  z.object({ kind: z.literal("pay_quote"), expected: ExpectedQuote,
    fault: z.enum(["none", "lost_capture_and_download"]) }).strict(),
]);
/** Validated fictional action in a private simulation. */
export type SimulationStep = z.infer<typeof SimulationStep>;

/** Customer follow-ups a plan will send, written or simulated; each one is a real assistant turn. */
export function customerTurns(steps: SimulationStep[]): number {
  return steps.reduce((sum, step) => sum + (step.kind === "customer" ? 1 : step.kind === "simulated_customer" ? step.turns : 0), 0);
}

/** A saved instruction is optional; scenario and expectations never grant approvals. */
export const SimulationInput = z.object({
  requestId: z.uuid(), scenario: z.string().trim().min(5).max(2000),
  expectedOutcome: z.string().trim().min(5).max(1000),
  steps: z.array(SimulationStep).max(6).refine(steps => customerTurns(steps) <= 3, "Use at most three follow-up customer turns.").optional(),
  change: z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("instruction"), id: z.uuid(), revision: z.number().int().positive() }).strict()]),
}).strict();
/** Validated owner request; facts, credentials and tool results cannot be supplied here. */
export type SimulationInput = z.infer<typeof SimulationInput>;
const count = z.number().int().nonnegative();
/** Only the executor writes evidence. Completion means the trial ended, not that its checks passed. */
export const SimulationSideResult = z.object({
  transcript: z.array(z.object({ role: z.enum(["user", "assistant", "seller"]), text: z.string().min(1).max(10000) }).strict()).min(1).max(40),
  tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), state: z.enum(["output-available", "output-error"]) }).strict()).max(200),
  approvals: z.array(z.enum(["buyer_checkout", "seller_scope", "fixture_payer"])).max(40),
  records: z.object({ quotes: count, paidOrders: count, captures: count, pendingTasks: count, completedTasks: count, openSellerQuestions: count }).strict(),
  checks: z.array(z.object({ label: z.string().min(1).max(120), passed: z.boolean(), detail: z.string().min(1).max(1000) }).strict()).min(1).max(30),
  latencyMs: count, inputTokens: count.nullable(), outputTokens: count.nullable(),
}).strict();
/** Actual transcript and independent outcomes, excluding tokens, capability URLs and raw tool payloads. */
export type SimulationSideResult = z.infer<typeof SimulationSideResult>;
/** Server-selected proposed wording retained alongside the published source snapshot. */
export type SimulationChange = { id: string; revision: number; publishedRevision: number | null; content: ProcedureContent } | null;
/** Owner report. Internal snapshots and database destinations stay server-side. */
export type SimulationView = {
  id: string; scenario: string; expectedOutcome: string; change: SimulationChange;
  /** Frozen published names let an owner read the exact authorized purchase after catalog edits. */
  products: { id: string; title: string }[];
  /** The saved fictional actor plan, so a report shows which approvals made any payment possible. */
  steps: SimulationStep[];
  state: "running" | "completed" | "failed"; generator: string; capturedAt: string;
  current: SimulationSideResult | null; proposed: SimulationSideResult | null;
  failure: string | null; limitations: string[]; createdAt: string;
};
