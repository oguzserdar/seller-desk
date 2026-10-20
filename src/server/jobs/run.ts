/**
 * Recovery with a shared work deadline. Payment, webhook, grant and seller
 * continuation queues take turns instead of exhausting one queue first.
 * Cancellation stops new work and interrupts external requests. The current
 * operation's database cleanup is awaited, never left running by Promise.race.
 */
import { resumeAfterAnswer } from "@/server/ai/resume";
import { getDb } from "@/server/db/client";
import { job } from "@/server/db/schema";
import { issueGrants } from "@/server/domain/digital";
import type { JobPrincipal } from "@/server/domain/principal";
import { dueResumes } from "@/server/domain/seller-questions";
import { listDueAttempts, reconcilePayment } from "@/server/payments/engine";
import {
  listDueWebhookEvents,
  processWebhookEvent,
} from "@/server/payments/webhooks";
import { getStorage } from "@/server/storage";
import { and, eq, lte, sql } from "drizzle-orm";

/** Cooperative deadline, leaving headroom beneath the hosted route's platform ceiling. */
export const RECOVERY_BUDGET_MS = 45_000;
const LIMITS = { payments: 25, grants: 25, webhooks: 50, resumes: 10 } as const;

/** Observed work in this pass; finishing a batch does not mean the whole backlog is empty. */
export type JobRunSummary = {
  paymentsChecked: number;
  grantsTried: number;
  webhooksProcessed: number;
  conversationsResumed: number;
  problems: string[];
  stoppedBecause: "batch_finished" | "time_budget" | "cancelled";
  elapsedMs: number;
};

/** Internal execution controls, never accepted from an unauthenticated request body. */
export type RecoveryOptions = { budgetMs?: number; signal?: AbortSignal };

type WorkItem = {
  kind: "payment" | "webhook" | "grant" | "resume";
  id: string;
};

/** Runs a finite recovery pass and awaits durable cleanup before returning its result. */
export async function runDueWork(
  trigger: JobPrincipal["trigger"],
  options: RecoveryOptions = {},
): Promise<JobRunSummary> {
  const budgetMs = options.budgetMs ?? RECOVERY_BUDGET_MS;
  if (
    !Number.isInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > RECOVERY_BUDGET_MS
  )
    throw new Error(
      "Recovery budget must be between 1 and 45000 milliseconds.",
    );
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const stopped = () => {
    if (performance.now() - started >= budgetMs && !controller.signal.aborted)
      controller.abort();
    return signal.aborted;
  };
  const principal: JobPrincipal = { kind: "job", trigger };
  const summary: JobRunSummary = {
    paymentsChecked: 0,
    grantsTried: 0,
    webhooksProcessed: 0,
    conversationsResumed: 0,
    problems: [],
    stoppedBecause: "batch_finished",
    elapsedMs: 0,
  };
  try {
    if (stopped()) return summary;
    const payments = await listDueAttempts(LIMITS.payments);
    if (stopped()) return summary;
    const webhooks = await listDueWebhookEvents(LIMITS.webhooks);
    if (stopped()) return summary;
    const backend = getStorage();
    const grants =
      backend.kind === "d1"
        ? await backend.jobs.dueGrants(LIMITS.grants)
        : await getDb()
            .select({ targetId: job.targetId })
            .from(job)
            .where(
              and(
                eq(job.kind, "grant_access"),
                eq(job.state, "pending"),
                lte(job.runAfter, sql`now()`),
              ),
            )
            .orderBy(job.runAfter, job.id)
            .limit(LIMITS.grants);
    if (stopped()) return summary;
    const resumes = await dueResumes(LIMITS.resumes);
    let queues: WorkItem[][] = [
      payments.map((id) => ({ kind: "payment", id })),
      webhooks.map((id) => ({ kind: "webhook", id })),
      grants.map(({ targetId: id }) => ({ kind: "grant", id })),
      resumes.map((id) => ({ kind: "resume", id })),
    ];
    // A free D1 invocation has a finite query allowance. Recover one item,
    // rotating queue priority each minute so grant/resume work cannot starve.
    if (backend.kind === "d1") {
      const offset = Math.floor(Date.now() / 60000) % queues.length;
      queues = [...queues.slice(offset), ...queues.slice(0, offset)];
    }
    let completedItems = 0;
    for (
      let index = 0;
      index < Math.max(...queues.map((queue) => queue.length));
      index += 1
    ) {
      for (const queue of queues) {
        if (stopped()) return summary;
        const item = queue[index];
        if (!item) continue;
        if (backend.kind === "d1" && completedItems >= 1) return summary;
        completedItems++;
        try {
          switch (item.kind) {
            case "payment":
              summary.paymentsChecked += 1;
              await reconcilePayment(principal, item.id, {
                mayCapture: true,
                signal,
              });
              break;
            case "webhook": {
              const outcome = await processWebhookEvent(item.id, signal);
              if (outcome !== "deferred") summary.webhooksProcessed += 1;
              if (outcome === "failed")
                summary.problems.push(`webhook ${item.id} failed`);
              break;
            }
            case "grant": {
              summary.grantsTried += 1;
              const outcome = await issueGrants(item.id, {
                actor: "job",
                actorId: trigger,
              });
              if (outcome.outcome === "failed")
                summary.problems.push(
                  `grant for order ${item.id}: ${outcome.reason}`,
                );
              break;
            }
            case "resume": {
              const outcome = await resumeAfterAnswer(item.id, signal);
              if (outcome === "resumed") summary.conversationsResumed += 1;
              if (outcome === "failed")
                summary.problems.push(
                  `conversation for question ${item.id} did not resume`,
                );
              break;
            }
          }
        } catch {
          summary.problems.push(
            `${item.kind} ${item.id} failed; its durable state will be checked again`,
          );
        }
      }
    }
    return summary;
  } finally {
    clearTimeout(timer);
    summary.elapsedMs = Math.round(performance.now() - started);
    if (options.signal?.aborted) summary.stoppedBecause = "cancelled";
    else if (controller.signal.aborted || summary.elapsedMs >= budgetMs)
      summary.stoppedBecause = "time_budget";
  }
}
