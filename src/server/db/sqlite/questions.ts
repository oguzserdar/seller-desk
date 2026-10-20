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
import { SELLER_QUESTION_STATES } from "../constants";
import { buyerSession, conversation } from "./buyer";
import {
  createdAt,
  inList,
  nowMilliseconds,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { orders } from "./payments";
import { seller } from "./shop";

/** Seller question records in the D1 dialect. */
export const sellerQuestion = sqliteTable(
  "seller_question",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    customerGoal: text("customer_goal").notNull(),
    knownFacts: text("known_facts", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    state: text("state", { enum: SELLER_QUESTION_STATES })
      .default("open")
      .notNull(),
    answer: text("answer"),
    answeredAt: ts("answered_at"),
    resumedAt: ts("resumed_at"),
    resumeClaimId: uuid("resume_claim_id"),
    resumeAfter: ts("resume_after").default(nowMilliseconds).notNull(),
    resumeAttempts: integer("resume_attempts").default(0).notNull(),
    resumeError: text("resume_error"),
    reviewClaimId: uuid("review_claim_id"),
    reviewClaimExpiresAt: ts("review_claim_expires_at"),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("seller_question", t),
    uniqueIndex("seller_question_one_waiting_per_conversation")
      .on(t.conversationId)
      .where(sql`${t.state} in ('open', 'answered')`),
    index("seller_question_seller_state_idx").on(t.sellerId, t.state),
    check(
      "seller_question_state_valid",
      inList("state", SELLER_QUESTION_STATES),
    ),
    check(
      "seller_question_lengths",
      sql`length(${t.question}) between 1 and 500 and length(${t.customerGoal}) between 1 and 500 and (${t.answer} is null or length(${t.answer}) between 1 and 1000)`,
    ),
  ],
);

/** Order followup records in the D1 dialect. */
export const orderFollowup = sqliteTable(
  "order_followup",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    actor: text("actor", { enum: ["buyer", "owner"] }).notNull(),
    state: text("state", {
      enum: ["needs_help", "awaiting_customer", "confirmed"],
    }).notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("order_followup", t),
    primaryKey({ columns: [t.orderId, t.revision] }),
    check("order_followup_revision_positive", sql`${t.revision} > 0`),
    check(
      "order_followup_actor_state",
      sql`(${t.actor} = 'buyer' and ${t.state} in ('needs_help', 'confirmed')) or (${t.actor} = 'owner' and ${t.state} = 'awaiting_customer')`,
    ),
    check(
      "order_followup_message_length",
      sql`(${t.state} = 'confirmed' and ${t.message} = '') or (${t.state} <> 'confirmed' and length(trim(${t.message})) between 3 and 1000)`,
    ),
  ],
);
