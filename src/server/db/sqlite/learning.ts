import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  createdAt,
  inList,
  scalarChecks,
  ts,
  uuid,
  uuidDefault,
} from "./columns";
import { learningReview, shopGuide } from "./guides";
import { seller } from "./shop";

/** Learning publication records in the D1 dialect. */
export const learningPublication = sqliteTable(
  "learning_publication",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => learningReview.id, { onDelete: "restrict" }),
    findingIndex: integer("finding_index").notNull(),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => shopGuide.id, { onDelete: "restrict" }),
    guideRevision: integer("guide_revision").notNull(),
    approvedInput: text("approved_input", { mode: "json" })
      .$type<import("@/lib/learning-publication").PublishLearningInput>()
      .notNull(),
    publicSource: text("public_source", { mode: "json" })
      .$type<import("@/lib/learning-review").LearningSource["guides"][number]>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("learning_publication", t),
    uniqueIndex("learning_publication_finding_unique").on(
      t.reviewId,
      t.findingIndex,
    ),
    index("learning_publication_seller_idx").on(t.sellerId),
    check(
      "learning_publication_finding_range",
      sql`${t.findingIndex} between 0 and 5`,
    ),
    check(
      "learning_publication_revision_positive",
      sql`${t.guideRevision} > 0`,
    ),
  ],
);

/** Learning preview records in the D1 dialect. */
export const learningPreview = sqliteTable(
  "learning_preview",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => learningReview.id, { onDelete: "restrict" }),
    reviewRevision: integer("review_revision").notNull(),
    findingIndex: integer("finding_index").notNull(),
    question: text("question").notNull(),
    sourceHash: text("source_hash").notNull(),
    draftBody: text("draft_body").notNull(),
    currentFacts: text("current_facts", { mode: "json" })
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    proposedFacts: text("proposed_facts", { mode: "json" })
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["running", "completed", "failed"] })
      .default("running")
      .notNull(),
    currentAnswer: text("current_answer", { mode: "json" }).$type<
      import("@/lib/learning-preview").PreviewAnswer
    >(),
    proposedAnswer: text("proposed_answer", { mode: "json" }).$type<
      import("@/lib/learning-preview").PreviewAnswer
    >(),
    failure: text("failure"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    ...scalarChecks("learning_preview", t),
    index("learning_preview_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("learning_preview_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "learning_preview_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check("learning_preview_revision_positive", sql`${t.reviewRevision} > 0`),
    check(
      "learning_preview_finding_range",
      sql`${t.findingIndex} between 0 and 5`,
    ),
    check(
      "learning_preview_question_length",
      sql`length(trim(${t.question})) between 5 and 1000`,
    ),
    check(
      "learning_preview_completed_answers",
      sql`${t.state} <> 'completed' or (${t.currentAnswer} is not null and ${t.proposedAnswer} is not null)`,
    ),
  ],
);
