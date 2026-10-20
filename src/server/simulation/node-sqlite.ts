/** Fresh in-memory SQLite for a Node-hosted trial. No shop files or remote databases are opened. */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createTrialBinding, decodeTrialValue, encodeTrialValue, type TrialExecutor } from "./sqlite-binding";

/** Allocates one empty database; the caller closes it after saving the observed result. */
export function newNodeTrialDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const execute: TrialExecutor = async (queries, atomic) => {
    if (atomic) db.exec("BEGIN");
    try {
      const results = queries.map(query => {
        const statement = db.prepare(query.sql);
        statement.setReturnArrays(true);
        const columns = statement.columns().map(column => column.name);
        const values = query.values.map(decodeTrialValue) as SQLInputValue[];
        const rows = statement.all(...values) as unknown as unknown[][];
        const meta = db.prepare("SELECT changes() AS changes, last_insert_rowid() AS id").get()!;
        return { columns, rows: rows.map(row => row.map(encodeTrialValue)), changes: /^\s*(?:select|pragma|explain)\b/i.test(query.sql) ? 0 : Number(meta.changes), lastRowId: Number(meta.id) };
      });
      if (atomic) db.exec("COMMIT");
      return results;
    } catch (error) {
      if (atomic) db.exec("ROLLBACK");
      throw error;
    }
  };
  return { binding: createTrialBinding(execute), close: () => db.close() };
}
