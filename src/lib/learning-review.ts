/** Private review contracts. Model classifications are suggestions, never permission to publish. */
import { z } from "zod";

/** Checkout rules are authoritative purchase terms, not replaceable knowledge entries. */
export const LEARNING_POLICY_FIELDS = ["pickupPolicy", "serviceRequestPolicy", "digitalAccessPolicy", "cancellationPolicy", "taxPolicy"] as const;

/** Distinguishes knowledge improvements from exceptions and operational failures. */
export const LEARNING_KINDS = ["reusable_fact", "product_rule", "customer_exception", "temporary_information", "missing_integration", "app_failure", "unclear"] as const;
/** Bounded structured output from the configured model. Nothing here is buyer-visible. */
export const LearningAnalysis = z.object({
  summary: z.string().trim().min(1).max(500),
  findings: z.array(z.object({
    kind: z.enum(LEARNING_KINDS),
    title: z.string().trim().min(3).max(100),
    explanation: z.string().trim().min(1).max(600),
    answerQuote: z.string().trim().min(3).max(1000).describe("Exact supporting text copied from the seller answer, not the customer request"),
    proposedFact: z.string().trim().max(1000).nullable().describe("Proposed public wording only for a reusable fact or product rule; otherwise null"),
    scope: z.string().trim().min(1).max(300).describe("Who or which product this applies to, including any uncertainty"),
    questions: z.array(z.string().trim().min(1).max(200)).max(4),
    conflictingGuideIds: z.array(z.uuid()).max(24),
    coveredByGuideIds: z.array(z.uuid()).max(24).describe("IDs of active published guides that already state this same fact for the same scope; empty when it is new"),
    conflictingPolicyFields: z.array(z.enum(LEARNING_POLICY_FIELDS)).max(5),
    conflictingProductIds: z.array(z.uuid()).max(40),
  }).strict()).max(6),
}).strict();
/** Parsed model analysis, retained privately for seller review. */
export type LearningAnalysis = z.infer<typeof LearningAnalysis>;

/** Immutable inputs for a review; private customer context must never enter buyer sources. */
export type LearningSource = {
  questionId: string; sourceRevision: number; question: string; customerGoal: string;
  knownFacts: string[]; answer: string;
  terms: import("@/server/db/types").PolicySnapshot;
  products: { id: string; revision: number; title: string; description: string; fulfillmentNote: string; serviceScope: string | null; unitAmountMinor: number | null; currency: string; accessDays: number | null }[];
  guides: { id: string; revision: number; title: string; body: string; topic: string; productId: string | null; validUntil: string | null }[];
};

/** Owner-only browser data: recent answers and their latest saved review, without internal claim fields. */
export type LearningWorkspaceItem = {
  questionId: string; question: string; answer: string; customerGoal: string;
  review: {
    id: string; revision: number; state: "draft" | "deferred" | "rejected"; stale: boolean;
    analysis: LearningAnalysis; source: LearningSource;
    editedDrafts: import("./learning-draft").LearningDraft[];
    publications: import("./learning-publication").LearningPublicationView[];
  } | null;
};

/**
 * Published guides that already state a finding. Reviews saved before this field
 * existed read as covering nothing.
 */
export function coveredBy(finding: LearningAnalysis["findings"][number]): string[] {
  return (finding as { coveredByGuideIds?: string[] }).coveredByGuideIds ?? [];
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Rejects invented evidence and unsafe promotion rather than silently producing a repaired draft. */
export function validateLearningAnalysis(source: LearningSource, value: unknown): LearningAnalysis {
  // The model schema requires coverage (strict providers need every field); an absent list from older saved input means it covers nothing.
  const findings = (value as { findings?: unknown })?.findings;
  const withCoverage = Array.isArray(findings)
    ? { ...(value as object), findings: findings.map((item) => item && typeof item === "object" && !("coveredByGuideIds" in item) ? { ...item, coveredByGuideIds: [] } : item) }
    : value;
  const parsed = LearningAnalysis.parse(withCoverage);
  const guideIds = new Set(source.guides.map((guide) => guide.id));
  for (const finding of parsed.findings) {
    if (!source.answer.includes(finding.answerQuote)) throw new Error("The review contains evidence not present in the seller's answer.");
    if (finding.conflictingGuideIds.some((id) => !guideIds.has(id)) || finding.coveredByGuideIds.some((id) => !guideIds.has(id))) throw new Error("The review refers to shop knowledge outside its source snapshot.");
    if (finding.coveredByGuideIds.some((id) => finding.conflictingGuideIds.includes(id))) throw new Error("The review calls one shop rule both the same fact and a conflict.");
    // A word-for-word repeat of a published guide is covered whatever the model said, so the seller is never asked to approve it twice.
    const proposed = finding.proposedFact;
    if (proposed) for (const guide of source.guides) {
      if (sameText(guide.body, proposed) && !finding.coveredByGuideIds.includes(guide.id) && !finding.conflictingGuideIds.includes(guide.id)) finding.coveredByGuideIds.push(guide.id);
    }
    if (finding.conflictingPolicyFields.some(field => !source.terms[field]) || finding.conflictingProductIds.some(id => !source.products.some(product => product.id === id))) throw new Error("The review refers to terms or products outside its source snapshot.");
    if (finding.proposedFact !== null && !["reusable_fact", "product_rule"].includes(finding.kind)) {
      throw new Error("Private exceptions and operational findings cannot propose public shop facts.");
    }
  }
  return parsed;
}
