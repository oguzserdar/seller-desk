import { job } from "@/server/db/sqlite/schema";
import { and, eq, lte } from "drizzle-orm";
import { createD1AuditStorage } from "./audit";
import { createD1Bootstrap } from "./bootstrap";
import { createD1BuyerPurchases } from "./buyer-purchases";
import { createD1BuyerSessionStorage } from "./buyer-session";
import { createD1CatalogReads } from "./catalog-read";
import { createD1CatalogWrites } from "./catalog-write";
import { createD1CheckoutStorage } from "./checkout";
import type { D1Db } from "./client";
import { createD1ConversationStorage } from "./conversation";
import { createD1ConversationControl } from "./conversation-control";
import { createD1ConversationMessages } from "./conversation-messages";
import { createD1ConversationReads } from "./conversation-read";
import { createD1Desk } from "./desk";
import { createD1AssetStorage } from "./digital-asset";
import { createD1DigitalGrants } from "./digital-grants";
import { createD1DigitalReads } from "./digital-read";
import { createD1FixtureStore } from "./fixture-paypal";
import { createD1GuideReads } from "./guide-read";
import { createD1GuideWrites } from "./guide-write";
import { createD1Imports } from "./imports";
import { createD1LearningDrafts } from "./learning-draft";
import { createD1LearningPreviews } from "./learning-preview";
import { createD1LearningPublication } from "./learning-publication";
import { createD1LearningReviews } from "./learning-review";
import { createD1ModelCheckStorage } from "./model-check";
import { createD1OrderFollowup } from "./order-followup";
import { createD1OrderReads } from "./order-read";
import { createD1OrderWrites } from "./order-write";
import { createD1OwnerConversationStorage } from "./owner-conversation";
import { readD1OwnerQuoteReview } from "./owner-quote";
import { readD1PaidRows } from "./paid-summary";
import { createD1PaymentStorage } from "./payments";
import { createD1ProcedurePreviews } from "./procedure-preview";
import { createD1ProcedureStorage } from "./procedures";
import { createD1Proposals } from "./proposals";
import { createD1QuoteApproval } from "./quote-approval";
import { createD1QuoteReads } from "./quote-view";
import { createD1QuoteWrites } from "./quote-write";
import { createD1SellerStorage } from "./seller";
import { createD1SellerQuestions } from "./seller-questions";
import { createD1SetupStorage } from "./setup";
import { installD1SimulationShop } from "./simulation-install";
import { createD1SimulationRuns } from "./simulation-runs";
import { captureD1SimulationShop } from "./simulation-snapshot";
import { createD1UsageStorage } from "./usage";
import { createD1WebhookStorage } from "./webhooks";
import { readD1WorkRow } from "./work-summary";

/** Native command surface for a single invocation's binding. No operation falls back to PG. */
export function createD1Storage(db: D1Db) {
  return {
    kind: "d1" as const,
    simulation: {
      installShop: (
        snapshot: import("@/server/simulation/snapshot").SimulationShopSnapshot,
      ) => installD1SimulationShop(db, snapshot),
      captureShop: (
        owner: import("@/server/domain/principal").OwnerPrincipal,
      ) => captureD1SimulationShop(db, owner),
      ...createD1SimulationRuns(db),
    },
    jobs: {
      dueGrants: (limit: number) =>
        db
          .select({ targetId: job.targetId })
          .from(job)
          .where(
            and(
              eq(job.kind, "grant_access"),
              eq(job.state, "pending"),
              lte(job.runAfter, new Date()),
            ),
          )
          .orderBy(job.runAfter, job.id)
          .limit(limit),
    },
    bootstrap: createD1Bootstrap(db),
    imports: createD1Imports(db),
    proposals: createD1Proposals(db),
    desk: createD1Desk(db),
    purchases: createD1BuyerPurchases(db),
    reports: {
      paidRows: (
        owner: import("@/server/domain/principal").OwnerPrincipal,
        bounds: { start: Date | null; end: Date | null; now: Date },
      ) => readD1PaidRows(db, owner, bounds),
      workRow: (owner: import("@/server/domain/principal").OwnerPrincipal) =>
        readD1WorkRow(db, owner),
    },
    webhooks: createD1WebhookStorage(db),
    audit: createD1AuditStorage(db),
    setup: createD1SetupStorage(db),
    procedures: createD1ProcedureStorage(db),
    guides: { ...createD1GuideReads(db), ...createD1GuideWrites(db) },
    learning: {
      ...createD1LearningReviews(db),
      ...createD1LearningDrafts(db),
      ...createD1LearningPublication(db),
      ...createD1LearningPreviews(db),
      ...createD1ProcedurePreviews(db),
    },
    orders: {
      ...createD1OrderReads(db),
      ...createD1OrderWrites(db),
      ...createD1OrderFollowup(db),
    },
    digital: {
      ...createD1DigitalReads(db),
      ...createD1AssetStorage(db),
      ...createD1DigitalGrants(db),
    },
    fixture: createD1FixtureStore(db),
    checkout: createD1CheckoutStorage(db),
    payments: createD1PaymentStorage(db),
    seller: createD1SellerStorage(db),
    catalog: { ...createD1CatalogReads(db), ...createD1CatalogWrites(db) },
    quotes: {
      ownerReview: (
        owner: import("@/server/domain/principal").OwnerPrincipal,
        id: string,
      ) => readD1OwnerQuoteReview(db, owner, id),
      ...createD1QuoteReads(db),
      ...createD1QuoteWrites(db),
      ...createD1QuoteApproval(db),
    },
    questions: createD1SellerQuestions(db),
    sessions: createD1BuyerSessionStorage(db),
    conversations: {
      ...createD1ConversationStorage(db),
      ...createD1ConversationReads(db),
      ...createD1ConversationMessages(db),
      ...createD1ConversationControl(db),
    },
    ownerChat: createD1OwnerConversationStorage(db),
    usage: createD1UsageStorage(db),
    modelCheck: createD1ModelCheckStorage(db),
  };
}
