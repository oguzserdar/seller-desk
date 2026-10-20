/** Model-facing shop facts; original tool results remain available for source evidence. */
import type { GuideSource } from "@/lib/shop-guide";

/**
 * Keeps facts, scope and expiry while exposing record handles only when the
 * model needs them to request an approved next-step card. No answer is authored.
 */
export function guideFactsForModel(sources: GuideSource[]) {
  return sources.map(({ id, revision, title, topic, body, hasNextStep, productId, validUntil }) => ({
    title, topic, body, hasNextStep, productId, validUntil,
    ...(hasNextStep ? { id, revision } : {}),
  }));
}
