"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import type { TaskType } from "@/server/domain/orders";
import { completePickupAction, completeServiceWorkAction, retryAccessAction, serviceFollowUpAction } from "../../actions";

type TaskSummary = { id: string; type: TaskType; state: string; revision: number };

/** The owner's actions for one obligation. Each shows its result read back from the server. */
export function TaskActions({ orderId, task, accessReview }: { orderId: string; task: TaskSummary; accessReview: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState<{ kind: "pickup" | "time" | "work"; note: string; revision: number } | null>(null);
  const editNote = (value: string) => { setNote(value); setConfirmation(null); };
  const review = (kind: "pickup" | "time" | "work") => setConfirmation({ kind, note: note.trim(), revision: task.revision });
  const [result, setResult] = useState<string | null>(null);
  const [resultTone, setResultTone] = useState<"success" | "warning">("success");
  const done = () => { setConfirmation(null); router.refresh(); };

  const pickup = useAction(completePickupAction, {
    onSuccess: () => {
      setResult("Pickup recorded.");
      done();
    },
  });
  const followUp = useAction(serviceFollowUpAction, {
    onSuccess: ({ data }) => {
      setResult(data?.state === "completed" ? "Time confirmed and recorded." : "Follow-up recorded. The task stays open until a time is confirmed.");
      setNote("");
      done();
    },
  });
  const access = useAction(retryAccessAction, {
    onSuccess: ({ data }) => {
      setResultTone(data?.outcome === "granted" ? "success" : "warning");
      setResult(data?.outcome === "granted" ? "Access opened. The buyer can download now." : data ? `Access did not open: ${data.reason}` : "Access could not be checked. Reload the order before trying again.");
      done();
    },
  });
  const serviceWork = useAction(completeServiceWorkAction, {
    onSuccess: () => {
      setResult("Work recorded as finished. Your buyer can see the completion note on their order.");
      setNote("");
      done();
    },
  });
  const error = pickup.result.serverError ?? followUp.result.serverError ?? access.result.serverError ?? serviceWork.result.serverError ?? null;

  if (task.type === "digital_access" && accessReview) return null;
  if (task.state === "completed") return result ? <Alert tone={resultTone} title={result} /> : null;

  return (
    <div className="flex flex-col gap-3">
      {task.type === "pickup" ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            review("pickup");
          }}
        >
          <div className="flex-1">
            <Input label="Pickup note (optional)" id={`note-${task.id}`} value={note} onChange={(e) => editNote(e.target.value)} maxLength={300} placeholder="Collected by the buyer" />
          </div>
          <Button type="submit" loading={pickup.isPending}>
            Mark picked up
          </Button>
        </form>
      ) : null}
      {task.type === "service_followup" ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
          <Textarea label="What did you agree with the buyer?" description="For example: “Called, drop-off Saturday 10:00.” Only mark the time confirmed once the buyer agreed; your buyer then sees this note on their order." id={`follow-${task.id}`} rows={2} value={note} onChange={(e) => editNote(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={note.trim().length < 3}
              loading={followUp.isPending}
              onClick={() => followUp.execute({ taskId: task.id, expectedRevision: task.revision, note, timeConfirmed: false })}
            >
              Record follow-up
            </Button>
            <Button
              type="button"
              disabled={note.trim().length < 3}
              loading={followUp.isPending}
              onClick={() => review("time")}
            >
              Time confirmed
            </Button>
          </div>
        </form>
      ) : null}
      {task.type === "digital_access" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={access.isPending} onClick={() => access.execute({ orderId })}>
            Retry download access
          </Button>
          <span className="text-ink-3 text-[13px]">Retrying never charges the buyer again.</span>
        </div>
      ) : null}
      {task.type === "service_work" ? (
        <form className="flex flex-col gap-3" onSubmit={event => {
          event.preventDefault();
          review("work");
        }}>
          <Textarea label="What work did you finish?" description="Your buyer will see this note on their order. Record only work you have actually completed." id={`work-${task.id}`} rows={2} value={note} onChange={event => editNote(event.target.value)} minLength={3} maxLength={500} required />
          <Button type="submit" className="self-start" disabled={note.trim().length < 3} loading={serviceWork.isPending}>Mark work finished</Button>
        </form>
      ) : null}
      {confirmation ? <Alert tone="info" title={confirmation.kind === "work" ? "Record this work as finished?" : confirmation.kind === "time" ? "Record the time as agreed with the buyer?" : "Record that the buyer collected this order?"}>
        {confirmation.note ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{confirmation.note}</p> : null}
        <p className="mt-2 text-[13px]">{confirmation.kind === "work" ? "Your buyer will see this note. This records your completed work, not their satisfaction." : "This records what happened. You cannot undo it here."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" loading={pickup.isPending || followUp.isPending || serviceWork.isPending} onClick={() => {
            const input = { taskId: task.id, expectedRevision: confirmation.revision, note: confirmation.note };
            if (confirmation.kind === "work") serviceWork.execute(input);
            else if (confirmation.kind === "time") followUp.execute({ ...input, timeConfirmed: true });
            else pickup.execute(input);
          }}>{confirmation.kind === "work" ? "Confirm finished work" : confirmation.kind === "time" ? "Confirm agreed time" : "Confirm pickup"}</Button>
          <Button type="button" variant="ghost" disabled={pickup.isPending || followUp.isPending || serviceWork.isPending} onClick={() => setConfirmation(null)}>Keep editing</Button>
        </div>
      </Alert> : null}
      {error ? <Alert tone="danger" title={error} /> : null}
      {result ? <Alert tone={resultTone} title={result} /> : null}
    </div>
  );
}
