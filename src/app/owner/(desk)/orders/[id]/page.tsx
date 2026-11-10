import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { formatMoney } from "@/lib/money";
import { requireOwner } from "@/server/auth/owner";
import { DomainError } from "@/server/domain/errors";
import { describeTask, ownerStep, getOwnerOrder } from "@/server/domain/orders";
import { TaskActions } from "./task-actions";
import { OwnerOrderHelp } from "./order-help";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Order" };

const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
const DAY: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };

/** Each independent check of PayPal's record, in plain words. */
const CHECK_WORDS: Record<string, string> = {
  environment: "Right PayPal environment",
  order_id: "Same PayPal order",
  reference_id: "Carries our reference",
  payee: "Paid to this shop",
  amount: "Amount",
  capture_status: "Capture completed",
};

export default async function OwnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { owner } = await requireOwner(await headers());
  const { id } = await params;
  let detail;
  try {
    detail = await getOwnerOrder(owner, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "not_found") notFound();
    throw error;
  }
  const { order, attempt, tasks, grants, accessReview } = detail;
  const evidence = attempt.evidence;
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <Link href="/owner/orders" className="text-brand text-[14px] font-semibold hover:underline">
        ← Desk
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.025em]">Order #{order.number}</h1>
          <p className="text-ink-2 mt-1">
            {order.buyerName ?? "Buyer"}
            {order.buyerEmail ? `, ${order.buyerEmail}` : ""}. Paid <LocalTime value={order.paidAt} options={WHEN} />.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {order.environment === "fixture" ? <Badge tone="neutral">Demo order</Badge> : <Badge tone="neutral">PayPal sandbox</Badge>}
          <Badge tone="success">Paid {formatMoney(order.totalMinor, order.currency)}</Badge>
        </div>
      </div>

      {detail.followup.state !== "none" ? <div className="mt-6"><OwnerOrderHelp orderId={order.id} initial={detail.followup} /></div> : null}

      <section aria-labelledby="work-heading" className="mt-6">
        <h2 id="work-heading" className="mb-2 text-[17px] font-semibold">
          {tasks.some((task) => task.state !== "completed") ? "What this order still needs" : "Nothing left to do on this order"}
        </h2>
        <div className="flex flex-col gap-3">
          {tasks.map((task) => {
            const words = describeTask(task);
            return (
              <section key={task.id} className="surface flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={words.tone === "attention" ? "text-attention text-[17px] font-semibold" : "text-[17px] font-semibold"}>{task.type === "digital_access" && task.state !== "completed" && accessReview ? "Review download access" : ownerStep(task)}</h3>
                  {task.retryCount > 0 ? <span className="text-ink-3 text-[13px]">{task.retryCount} retr{task.retryCount === 1 ? "y" : "ies"}</span> : null}
                </div>
                {task.lastError && task.state !== "completed" && !(task.type === "digital_access" && accessReview) ? <Alert tone="warning" title="Last problem">{task.lastError}</Alert> : null}
                {task.details.followUps?.length ? (
                  <ul className="text-ink-2 list-disc pl-5 text-[14px]">
                    {task.details.followUps.map((entry) => (
                      <li key={entry.recordedAt}>
                        <LocalTime value={entry.recordedAt} options={WHEN} />: {entry.note}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {task.details.pickupNote ? <p className="text-ink-2 text-[14px]">Pickup note: {task.details.pickupNote}</p> : null}
                {task.details.completionNote ? <p className="text-ink-2 text-[14px]">Shared with your buyer: {task.details.completionNote}</p> : null}
                {task.type === "digital_access" && accessReview ? <Alert tone="warning" title={accessReview} /> : null}
                <TaskActions orderId={order.id} task={{ id: task.id, type: task.type, state: task.state, revision: task.revision }} accessReview={accessReview} />
              </section>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="items-heading" className="mt-6">
        <h2 id="items-heading" className="mb-2 text-[17px] font-semibold">
          What was bought (as reviewed by the buyer)
        </h2>
        <section className="surface p-5">
          <ul className="flex flex-col gap-1.5 text-[15px]">
            {order.snapshot.lines.map((line) => (
              <li key={line.offerId} className="flex justify-between gap-4">
                <span>
                  {line.quantity} × {line.title}
                </span>
                <span className="tabular">{formatMoney(line.lineTotalMinor, order.currency)}</span>
              </li>
            ))}
          </ul>
          {order.snapshot.approvedScope ? <p className="text-ink-2 mt-3 text-[14px]">Approved scope: {order.snapshot.approvedScope}</p> : null}
          {order.snapshot.buyerNote ? <p className="text-ink-2 mt-1 text-[14px]">Buyer note: {order.snapshot.buyerNote}</p> : null}
        </section>
      </section>

      {grants.length > 0 ? (
        <section aria-labelledby="access-heading" className="mt-6">
          <h2 id="access-heading" className="mb-2 text-[17px] font-semibold">
            Download access
          </h2>
          <section className="surface divide-line divide-y">
            {grants.map((grant) => (
              <div key={grant.id} className="flex flex-wrap justify-between gap-3 px-5 py-3 text-[15px]">
                <span>{grant.filename}</span>
                <span className="text-ink-2">
                  {grant.state !== "active" ? "Withdrawn" : grant.expiresAt <= new Date() ? "Expired" : "Available"} · {grant.downloadCount} download{grant.downloadCount === 1 ? "" : "s"} · until <LocalTime value={grant.expiresAt} options={DAY} />
                </span>
              </div>
            ))}
          </section>
        </section>
      ) : null}

      <section aria-labelledby="evidence-heading" className="mt-6">
        <h2 id="evidence-heading" className="mb-2 text-[17px] font-semibold">
          How PayPal&apos;s record was checked
        </h2>
        <section className="surface p-5 text-[14px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-3">PayPal order</dt>
            <dd className="font-mono text-[13px]">{order.providerOrderId}</dd>
            <dt className="text-ink-3">Capture</dt>
            <dd className="font-mono text-[13px]">{order.providerCaptureId}</dd>
            <dt className="text-ink-3">Checked</dt>
            <dd>{evidence ? <LocalTime value={evidence.observedAt} options={WHEN} /> : "Not yet"}</dd>
          </dl>
          {evidence ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Independent checks against PayPal">
              {evidence.checks.map((check) => (
                <li key={check.name}>
                  <Badge tone={check.passed ? "success" : "danger"}>
                    {check.passed ? "✓" : "✗"} {CHECK_WORDS[check.name] ?? check.name.replace("_", " ")}
                    {check.detail ? ` (${check.detail})` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </section>
    </section>
  );
}
