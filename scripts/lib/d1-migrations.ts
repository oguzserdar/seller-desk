import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Immutable migration bytes checked before a runner receives them. */
export type D1Migration = Readonly<{ name: string; sql: string; sha256: string }>;

// Quoted content is a single token, so a semicolon or keyword in it cannot change the statement boundary.
function statements(source: string): string[][] {
  if (source.includes("\0")) throw new Error("NUL is not permitted in a D1 migration.");
  const result: string[][] = [];
  let current: string[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) { i++; continue; }
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated SQL comment.");
      i = end + 2;
      continue;
    }
    if (["'", '"', "`", "["].includes(char)) {
      const end = char === "[" ? "]" : char;
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i++] !== end) continue;
        if (char !== "[" && source[i] === end) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) throw new Error("Unterminated SQL string or identifier.");
      current.push(char === "'" ? "#literal" : "@identifier");
      continue;
    }
    if (char === ";") {
      if (current.length) result.push(current);
      current = [];
      i++;
      continue;
    }
    const word = /^[a-z_][a-z_0-9$]*/i.exec(source.slice(i))?.[0];
    if (word) { current.push(word.toUpperCase()); i += word.length; }
    else { current.push(char); i++; }
  }
  if (current.length) result.push(current);
  return result;
}

/**
 * Allows additive schema statements only. Table rebuilds, pragmas and data rewrites
 * need a migration-specific preservation strategy; there is no unchecked bypass.
 * This policy is intentionally narrower than the SQL grammar, not a SQL validator.
 */
export function assertAdditiveD1Migration(source: string, name = "migration.sql"): void {
  const queries = statements(source);
  if (!queries.length) throw new Error(`${name}: no SQL statements.`);
  queries.forEach((tokens, index) => {
    const [first, second, third, fourth] = tokens;
    const create = first === "CREATE" && (second === "TABLE" || second === "INDEX" || (second === "UNIQUE" && third === "INDEX"));
    const identifier = third === "@identifier" || /^[A-Z_][A-Z_0-9$]*$/.test(third ?? "");
    const add = first === "ALTER" && second === "TABLE" && identifier && fourth === "ADD";
    if (!create && !add) {
      throw new Error(`${name}: statement ${index + 1} (${tokens.slice(0, 4).join(" ")}) is not permitted. D1 rebuilds and data rewrites require a tested preservation strategy.`);
    }
  });
}

/** Reads flat, uniquely numbered SQL migrations and validates every file before execution. */
export function readD1Migrations(directory: string): D1Migration[] {
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql"));
  if (!names.length) throw new Error("No SQL migrations found. A D1 application baseline has not been prepared.");
  const numbers = new Set<string>();
  const files = names.map((name) => {
    const match = /^(\d{4,})_[a-zA-Z0-9_-]+\.sql$/.exec(name);
    if (!match) throw new Error(`${name}: use a numbered migration filename.`);
    const number = BigInt(match[1]!).toString();
    if (numbers.has(number)) throw new Error(`${name}: duplicate migration number.`);
    numbers.add(number);
    const file = path.join(directory, name);
    if (!lstatSync(file).isFile()) throw new Error(`${name}: migration must be a regular file.`);
    const sql = readFileSync(file, "utf8");
    assertAdditiveD1Migration(sql, name);
    return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
  return files.sort((a, b) => {
    const first = BigInt(a.name.split("_")[0]!);
    const second = BigInt(b.name.split("_")[0]!);
    return first < second ? -1 : first > second ? 1 : 0;
  });
}
