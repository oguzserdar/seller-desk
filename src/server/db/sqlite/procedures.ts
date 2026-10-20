import type { ProcedureContent } from "@/lib/assistant-procedure";
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
import {
  boolean,
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
} from "./columns";
import { seller } from "./shop";

/** Assistant procedure records in the D1 dialect. */
export const assistantProcedure = sqliteTable(
  "assistant_procedure",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
    content: text("content", { mode: "json" })
      .$type<ProcedureContent>()
      .notNull(),
    publishedRevision: integer("published_revision"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("assistant_procedure", t),
    index("assistant_procedure_seller_idx").on(t.sellerId),
    check("assistant_procedure_revision_positive", sql`${t.revision} > 0`),
    check(
      "assistant_procedure_publication_valid",
      sql`${t.publishedRevision} is null or (${t.publishedRevision} > 0 and ${t.publishedRevision} <= ${t.revision} and not ${t.archived})`,
    ),
  ],
);

/** Assistant procedure version records in the D1 dialect. */
export const assistantProcedureVersion = sqliteTable(
  "assistant_procedure_version",
  {
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => assistantProcedure.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    content: text("content", { mode: "json" })
      .$type<ProcedureContent>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("assistant_procedure_version", t),
    primaryKey({ columns: [t.procedureId, t.revision] }),
    check("assistant_procedure_version_positive", sql`${t.revision} > 0`),
  ],
);

/** Procedure preview records in the D1 dialect. */
export const procedurePreview = sqliteTable(
  "procedure_preview",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => assistantProcedure.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    publishedRevision: integer("published_revision"),
    question: text("question").notNull(),
    wording: text("wording", { mode: "json" })
      .$type<ProcedureContent>()
      .notNull(),
    facts: text("facts", { mode: "json" })
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    currentInstructions: text("current_instructions", { mode: "json" })
      .$type<ProcedureContent[]>()
      .notNull(),
    proposedInstructions: text("proposed_instructions", { mode: "json" })
      .$type<ProcedureContent[]>()
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
    ...scalarChecks("procedure_preview", t),
    index("procedure_preview_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("procedure_preview_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "procedure_preview_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check("procedure_preview_revision_positive", sql`${t.revision} > 0`),
    check(
      "procedure_preview_question_length",
      sql`length(trim(${t.question})) between 5 and 1000`,
    ),
    check(
      "procedure_preview_completed_answers",
      sql`${t.state} <> 'completed' or (${t.currentAnswer} is not null and ${t.proposedAnswer} is not null)`,
    ),
  ],
);
