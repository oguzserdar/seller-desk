import type { ToolSet } from "ai";
import { assertAssistantTurn, AssistantTurnEnded } from "@/server/domain/assistant-turn";
import type { AssistantBuyerPrincipal } from "@/server/domain/principal";

/** Checks actual tool execution, including results, rather than SDK observers. */
export function guardTurnTools<T extends ToolSet>(tools: T, buyer: AssistantBuyerPrincipal): T {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute) return [name, definition];
    return [name, { ...definition, execute: async (...args: Parameters<typeof execute>) => {
      await assertAssistantTurn(buyer);
      args[1].abortSignal?.throwIfAborted();
      const result = await execute(...args);
      await assertAssistantTurn(buyer);
      return result;
    } }];
  })) as T;
}

/**
 * Cancels an idle/in-flight provider after a durable claim is revoked. Each
 * outgoing stream chunk is checked separately, so the polling interval is not
 * permission to emit stale output. There is no process-local ownership state.
 */
export function watchTurn(buyer: AssistantBuyerPrincipal, parent: AbortSignal) {
  const controller = new AbortController();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = AbortSignal.any([parent, controller.signal]);
  const dispose = () => { disposed = true; clearTimeout(timer); signal.removeEventListener("abort", dispose); };
  signal.addEventListener("abort", dispose, { once: true });
  const poll = async () => {
    if (disposed) return;
    try { await assertAssistantTurn(buyer); }
    catch (error) { controller.abort(error); }
    if (!disposed) timer = setTimeout(poll, 500);
  };
  if (signal.aborted) dispose(); else timer = setTimeout(poll, 500);
  return { signal, dispose, abort: () => controller.abort(new AssistantTurnEnded()) };
}

/** Filters already-generated chunks against durable ownership before releasing them. */
export function guardTurnStream<T>(buyer: AssistantBuyerPrincipal, abortProvider: () => void): TransformStream<T, T> {
  let revoked = false;
  return new TransformStream<T, T>({
    async transform(chunk, controller) {
      if (revoked) return;
      try { await assertAssistantTurn(buyer); }
      catch (error) {
        revoked = true; abortProvider();
        // Abort the provider and let its stream settle. SDK stopStream closes
        // its stitchable controller twice if the watcher already aborted it.
        // Suppress remaining chunks; takeover is an expected end, not a failure.
        if (error instanceof AssistantTurnEnded) return;
        throw new Error("Conversation control could not be verified.");
      }
      controller.enqueue(chunk);
    },
  });
}
