import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { offer } from "./catalog";
import {
  boolean,
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { sellerQuestion } from "./questions";
import { seller } from "./shop";

/** Shop guide records in the D1 dialect. */
export const shopGuide = sqliteTable(
  "shop_guide",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    topic: text("topic", {
      enum: [
        "shipping",
        "returns",
        "options",
        "booking",
        "subscriptions",
        "downloads",
        "general",
      ],
    }).notNull(),
    body: text("body").notNull(),
    actionLabel: text("action_label"),
    actionUrl: text("action_url"),
    published: boolean("published").default(false).notNull(),
    productId: uuid("product_id").references(() => offer.id, {
      onDelete: "restrict",
    }),
    validUntil: ts("valid_until"),
    archived: boolean("archived").default(false).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("shop_guide", t),
    index("shop_guide_seller_idx").on(t.sellerId),
    check("shop_guide_revision_positive", sql`${t.revision} > 0`),
    check(
      "shop_guide_archived_unpublished",
      sql`not ${t.archived} or not ${t.published}`,
    ),
    check("shop_guide_title_length", sql`length(${t.title}) between 3 and 100`),
    check("shop_guide_body_length", sql`length(${t.body}) between 10 and 2000`),
    check(
      "shop_guide_topic_valid",
      inList("topic", [
        "shipping",
        "returns",
        "options",
        "booking",
        "subscriptions",
        "downloads",
        "general",
      ]),
    ),
    check(
      "shop_guide_action_pair",
      sql`(${t.actionLabel} is null and ${t.actionUrl} is null) or (${t.actionLabel} is not null and ${t.actionUrl} is not null and length(${t.actionLabel}) between 1 and 60 and length(${t.actionUrl}) between 1 and 1500 and ${t.actionUrl} like 'https://%')`,
    ),
  ],
);

/** Shop guide version records in the D1 dialect. */
export const shopGuideVersion = sqliteTable(
  "shop_guide_version",
  {
    guideId: uuid("guide_id")
      .notNull()
      .references(() => shopGuide.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<import("@/lib/shop-guide").GuideSnapshot>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("shop_guide_version", t),
    primaryKey({ columns: [t.guideId, t.revision] }),
    index("shop_guide_version_seller_idx").on(t.sellerId),
    check("shop_guide_version_positive", sql`${t.revision} > 0`),
  ],
);

/** Learning review records in the D1 dialect. */
export const learningReview = sqliteTable(
  "learning_review",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => sellerQuestion.id, { onDelete: "cascade" }),
    sourceHash: text("source_hash").notNull(),
    source: text("source", { mode: "json" })
      .$type<import("@/lib/learning-review").LearningSource>()
      .notNull(),
    analysis: text("analysis", { mode: "json" })
      .$type<import("@/lib/learning-review").LearningAnalysis>()
      .notNull(),
    editedDrafts: text("edited_drafts", { mode: "json" })
      .$type<import("@/lib/learning-draft").LearningDraft[]>()
      .default([])
      .notNull(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["draft", "deferred", "rejected"] })
      .default("draft")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("learning_review", t),
    uniqueIndex("learning_review_source_unique").on(
      t.sellerId,
      t.questionId,
      t.sourceHash,
    ),
    index("learning_review_seller_state_idx").on(t.sellerId, t.state),
    check(
      "learning_review_state_valid",
      inList("state", ["draft", "deferred", "rejected"]),
    ),
    check("learning_review_revision_positive", sql`${t.revision} > 0`),
    check(
      "learning_review_source_hash_length",
      sql`length(${t.sourceHash}) = 64`,
    ),
  ],
);
