/** Stream completion is not a useful answer unless the final model step actually answered. */
import type { TextStreamPart, ToolSet } from "ai";

/**
 * Preserves real text/tool output but marks empty, truncated or unfinished turns as failures.
 * This emits only a transport error, never replacement assistant prose or an automatic retry.
 */
export function requireCompletedAnswer<TOOLS extends ToolSet>(): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  let hasFinalText = false;
  let failed = false;
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "start-step") hasFinalText = false;
      if (part.type === "text-delta" && part.text.trim()) hasFinalText = true;
      if (part.type === "error") failed = true;
      if (part.type === "finish" && (failed || part.finishReason !== "stop" || !hasFinalText)) {
        if (!failed) controller.enqueue({ type: "error", error: new Error("The model did not complete a usable answer.") });
        // The SDK's UI outcome can become completed on finish. Retain an error
        // finish reason so both foreground and resumed persistence refuse it.
        controller.enqueue({ ...part, finishReason: "error" });
        return;
      }
      controller.enqueue(part);
    },
  });
}
