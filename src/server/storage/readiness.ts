import type { installation } from "@/server/db/schema";

/** Recorded local proof; configuration alone is never marked as executed evidence. */
export type ReadinessFacts = {
  installed: typeof installation.$inferSelect | undefined;
  published: number;
  paid: number;
  databaseLabel: string;
};
