/**
 * Grades a finished shop test against the seller's expected outcome. The verdict
 * rests on the final shop records (quotes, orders, open questions) as well as the
 * visible conversation, and every claim must quote the transcript verbatim; an
 * unverifiable quote fails the check rather than passing on the judge's word.
 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { SimulationSideResult } from "@/lib/simulation";

const Verdict = z.object({
  met: z.boolean(),
  reason: z.string().min(1).max(600),
  evidence: z.array(z.string().min(3).max(300)).min(1).max(4),
});

const INSTRUCTIONS = [
  "You grade one private test of a shop's AI assistant. The seller wrote what should happen; decide whether it did.",
  "Judge the outcome, not the style. Use the final shop records as the source of truth for what was quoted, paid or left open; the transcript shows what the customer was told.",
  "If the expected outcome needs something the records do not show (for example a quote or a paid order), it was not met, whatever the assistant said.",
  "Quote 1 to 4 short passages from the transcript, copied exactly, that support your verdict. Do not paraphrase inside a quote.",
  "Write the reason for the seller in one or two plain sentences.",
].join("\n");

/** One graded check for the report, using the shop's connected model as the grader. */
export async function judgeOutcome(model: LanguageModel, expectedOutcome: string, side: Pick<SimulationSideResult, "transcript" | "records">): Promise<SimulationSideResult["checks"][number]> {
  const label = "Meets the expected outcome";
  try {
    const { output } = await generateText({
      model,
      instructions: INSTRUCTIONS,
      prompt: JSON.stringify({ expectedOutcome, records: side.records, transcript: side.transcript }),
      output: Output.object({ schema: Verdict, name: "shop_test_verdict" }),
      maxOutputTokens: 800, maxRetries: 0, timeout: 45_000,
    });
    const said = side.transcript.map((line) => line.text).join("\n");
    const unfound = output.evidence.filter((quote) => !said.includes(quote));
    if (unfound.length)
      return { label, passed: false, detail: "The grader quoted text that is not in the conversation, so its verdict was not trusted." };
    return { label, passed: output.met, detail: `${output.reason} Evidence: "${output.evidence.join('" / "')}"`.slice(0, 1000) };
  } catch {
    return { label, passed: false, detail: "The grader could not finish, so this test is not counted as meeting the expected outcome." };
  }
}
