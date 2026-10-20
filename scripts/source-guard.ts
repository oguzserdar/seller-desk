/**
 * Fails `pnpm check` when a file that would ship carries something that must
 * never ship: names from private projects, secret-looking strings, personal
 * paths, or em dashes in text people read. It scans exactly the release file
 * list (scripts/lib/release-files.ts), so a new folder cannot slip past it.
 */
import { existsSync, readFileSync } from "node:fs";
import { releaseFiles } from "./lib/release-files";

// Names of private projects live outside the repository, in an untracked file
// (one term per line), so the public source never spells them out.
const PRIVATE_TERMS_FILE = ".seller-desk/private-terms.txt";
const privateTerms = existsSync(PRIVATE_TERMS_FILE)
  ? readFileSync(PRIVATE_TERMS_FILE, "utf8")
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean)
  : [];
if (privateTerms.length === 0) console.warn(`Source guard: ${PRIVATE_TERMS_FILE} is missing or empty, so private names are not checked.`);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Copied third-party text keeps its own punctuation; every other rule still applies to it.
// AGENTS.md is the notice Next.js generates for coding agents.
const THIRD_PARTY = /^(?:third-party\/|src\/components\/arc\/|THIRD_PARTY_NOTICES\.md$|pnpm-lock\.yaml$|AGENTS\.md$)/;

const RULES: { name: string; pattern: RegExp; ownTextOnly?: boolean }[] = [
  ...(privateTerms.length > 0 ? [{ name: "private project name", pattern: new RegExp(privateTerms.map(escapeRegExp).join("|"), "i") }] : []),
  { name: "secret-looking key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|\bsk_live_[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{35}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
  { name: "signed token (JWT)", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  // Local hosts and reserved example domains (RFC 2606) appear in tests that reject such URLs.
  { name: "password in a non-local URL", pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@(?!127\.0\.0\.1|localhost|\[::1\]|[^\s/'"]*\bexample\b)/i },
  { name: "personal home path", pattern: /\/Users\/[A-Za-z]|\/home\/[a-z][a-z0-9_-]*\// },
  { name: "em dash (use a comma, colon or full stop)", pattern: new RegExp(String.fromCharCode(0x2014)), ownTextOnly: true },
];

const problems: string[] = [];
for (const file of releaseFiles()) {
  const bytes = readFileSync(file);
  // Images, fonts and archives have no lines to read; a NUL byte marks binary content.
  if (bytes.includes(0)) continue;
  bytes
    .toString("utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.ownTextOnly && THIRD_PARTY.test(file)) continue;
        if (rule.pattern.test(line)) problems.push(`${file}:${index + 1}  ${rule.name}`);
      }
    });
}
if (problems.length > 0) {
  console.error(`Source guard found ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Source guard: clean.");
