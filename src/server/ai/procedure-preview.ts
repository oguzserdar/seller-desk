import type { ProcedurePreviewInput } from "@/lib/procedure-preview";
import { claimProcedurePreview, failProcedurePreview, procedurePreviewView, saveProcedurePreviewAnswer } from "@/server/domain/procedure-preview";
import { DomainError } from "@/server/domain/errors";
import { requireUsage } from "@/server/domain/usage";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { generatePreviewAnswer } from "./learning-preview";
import { getAssistantModel } from "./registry";

/** Two sequential real-model replies using frozen facts and directions; no publication or action tools. */
export async function runProcedurePreview(owner: OwnerPrincipal, input: ProcedurePreviewInput) {
  const assistant = await getAssistantModel();
  if (!assistant.ok) throw new DomainError("unavailable", "Connect an AI model before comparing replies. Your saved instruction is unchanged.");
  const run = await claimProcedurePreview(owner, input, `${assistant.provider}:${assistant.modelId}`);
  if (!run.created) return procedurePreviewView(run.row);
  let row = run.row;
  try {
    await requireUsage("learning_preview", owner.sellerId, 600, 5, "Wait before starting more comparisons.");
    for (const side of ["current", "proposed"] as const) {
      await requireUsage("seller_ai_day", owner.sellerId, 86_400, run.dailyLimit, "The shop assistant has reached its daily limit.");
      const answer = await generatePreviewAnswer(assistant.model, row.facts, row.question, side === "current" ? row.currentInstructions : row.proposedInstructions);
      row = await saveProcedurePreviewAnswer(owner, row.id, side, answer);
    }
    return procedurePreviewView(row);
  } catch {
    await failProcedurePreview(owner, row.id);
    return procedurePreviewView({ ...row, state: "failed", failure: "The model could not finish. Any completed reply is saved. Check the connection or try again later." });
  }
}
