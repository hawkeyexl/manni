/**
 * A term finding's guidance says when its rule fires in the words the rules
 * page uses. The page's "Fires when" column is the source, and this holds the
 * code's table equal to it, so the two cannot drift apart again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULE_DESCRIPTIONS } from "../../src/term/core/severity.js";
import { TERM_RULES } from "../../src/term/types.js";

const PAGE = join(import.meta.dirname, "..", "..", "docs", "src", "content", "docs", "term", "reference", "rules.mdx");

/** A table cell as plain text: code spans unwrapped, links reduced to their text. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

/** The rules table: each rule to its "Fires when" cell. */
function firesWhen(): Map<string, string> {
  const lines = readFileSync(PAGE, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\| Rule \| Default \| Fires when \|$/.test(line));
  const rows = new Map<string, string>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [, rule, , fires] = line.split("|").map((cell) => cell.trim());
    if (rule !== undefined && fires !== undefined) rows.set(plain(rule), plain(fires));
  }
  return rows;
}

describe("term rule descriptions", () => {
  it("say what the rules page's Fires when column says, for every rule", () => {
    const page = firesWhen();
    expect([...page.keys()].sort()).toEqual([...TERM_RULES].sort());
    for (const rule of TERM_RULES) expect(RULE_DESCRIPTIONS[rule], rule).toBe(page.get(rule));
  });

  it("each have a section of the rules page to link to", () => {
    const text = readFileSync(PAGE, "utf8");
    // A heading's anchor is its text, code span or not.
    for (const rule of TERM_RULES) expect(text, rule).toMatch(new RegExp(`^### \`?${rule}\`?$`, "m"));
  });
});
