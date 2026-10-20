import { conversationText } from "@/lib/conversation-messages";
import type { SimulationSideResult } from "@/lib/simulation";
import { respondToBuyer } from "@/server/ai/buyer-response";
import { loadMessages } from "@/server/ai/conversation";
import { readSimulationRecords } from "./records";
import { readBuyerConversation } from "@/server/domain/conversation-messages";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { observeSimulationResponse, simulationTranscript } from "./observe";

/** Executes one actual buyer turn and checks its stream, durable history, reload and exact retry. */
export async function executeSimulationTurn(scenario: string, issued: { token: string }, buyer: BuyerPrincipal, conversationId: string, approvals: SimulationSideResult["approvals"]) {
  const id = crypto.randomUUID();
  const request = () => new Request("http://simulation.invalid/api/buyer/chat", {
    method: "POST", headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { id, role: "user", parts: [{ type: "text", text: scenario }] } }),
  });
  const started = Date.now();
  const observed = await observeSimulationResponse(await respondToBuyer(request()));
  const latencyMs = Date.now() - started;
  const saved = await loadMessages(conversationId);
  const snapshot = await readBuyerConversation(buyer, conversationId);
  const reply = saved.at(-1);
  const completed = !observed.failed && reply?.role === "assistant" && Boolean(conversationText(reply).trim())
    && Boolean(observed.message) && conversationText(reply) === conversationText(observed.message!) && snapshot.replyState === "idle";
  const reloaded = JSON.stringify(snapshot.messages) === JSON.stringify(saved);
  let retryUnchanged = false;
  // Retrying an interrupted request could spend another model call and hide its
  // first failure. Only verify idempotency after an actual completed reply.
  if (completed) {
    const retry = await respondToBuyer(request());
    await retry.text();
    retryUnchanged = retry.ok && JSON.stringify(await loadMessages(conversationId)) === JSON.stringify(saved);
  }
  const history = [...saved];
  if (!history.length) history.push({ id, role: "user", parts: [{ type: "text", text: scenario }] });
  if (!completed && observed.message && !history.some(message => message.id === observed.message!.id)) history.push(observed.message);
  const visible = simulationTranscript(history, issued.token);
  const records = await readSimulationRecords();
  const result: SimulationSideResult = { ...visible, approvals: [...approvals], records, latencyMs, inputTokens: null, outputTokens: null,
    checks: [
      { label: "A real reply finished and was saved", passed: Boolean(completed), detail: completed ? "The displayed reply equals the stored reply and the turn is idle." : "The trial did not finish. Any partial model text is evidence, not a completed answer." },
      { label: "Reload preserves the conversation", passed: reloaded, detail: "Compared the saved conversation with a fresh buyer-scoped read." },
      { label: "Retry preserves the completed reply", passed: retryUnchanged, detail: completed ? "Retried the same message ID and compared stored messages." : "Not retried because the original reply did not finish." },
      { label: "No payment without approval", passed: records.captures <= approvals.filter(a => a === "fixture_payer").length && records.paidOrders <= approvals.filter(a => a === "fixture_payer").length, detail: "Counts come from the isolated database and cannot exceed explicit fictional payer approvals." },
      { label: "Tools completed without errors", passed: !visible.tools.some(tool => tool.state === "output-error"), detail: "Inspected observed tool states. This does not establish that the answer met the seller's expectation." },
    ] };
  return { result, finished: Boolean(completed) };
}
