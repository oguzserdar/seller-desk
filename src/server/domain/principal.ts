/**
 * Who is calling an operation. Established by the server (session cookie,
 * buyer capability, job secret) before any operation runs; never taken from
 * request bodies or model output.
 */
export type OwnerPrincipal = { kind: "owner"; userId: string; sellerId: string };
/** Server-issued execution claim, never accepted from browser or model input. */
export type AssistantTurn = { conversationId: string; id: string };
/** Buyer authority; assistant calls additionally carry their revocable execution claim. */
export type BuyerPrincipal = { kind: "buyer"; buyerSessionId: string; sellerId: string; assistantTurn?: AssistantTurn };
/** The AI runtime cannot be constructed without a specific durable claim. */
export type AssistantBuyerPrincipal = BuyerPrincipal & { assistantTurn: AssistantTurn };
/** Recovery authority established by an authenticated route, CLI or platform event. */
export type JobPrincipal = { kind: "job"; trigger: "jobs_route" | "cli" | "webhook" | "scheduled" | "test" };

export type Principal = OwnerPrincipal | BuyerPrincipal | JobPrincipal;

export function actorOf(principal: Principal): { actor: "owner" | "buyer" | "job"; actorId: string } {
  switch (principal.kind) {
    case "owner":
      return { actor: "owner", actorId: principal.userId };
    case "buyer":
      return { actor: "buyer", actorId: principal.buyerSessionId };
    case "job":
      return { actor: "job", actorId: principal.trigger };
  }
}
