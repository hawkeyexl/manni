/**
 * A cite finding's guidance says what its rule means in the words the fix
 * page uses, and links that page's section for the rule. The page's "It
 * means" column is the source, and this holds the code's table equal to it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POINTER_RULE_DESCRIPTIONS, RULE_DESCRIPTIONS } from "../../src/cite/core/severity.js";
import { CITE_RULES } from "../../src/cite/types.js";

const PAGE = join(import.meta.dirname, "..", "..", "docs", "src", "content", "docs", "cite", "fix", "index.mdx");

/** A table cell as plain text: code spans unwrapped, links reduced to their text. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

/** The "Every rule at a glance" table: each rule to its "It means" cell. */
function itMeans(): Map<string, string> {
  const lines = readFileSync(PAGE, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\| Rule \| Severity \| It means \| Do this \|$/.test(line));
  const rows = new Map<string, string>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [, rule, , means] = line.split("|").map((cell) => cell.trim());
    if (rule !== undefined && means !== undefined) rows.set(plain(rule), plain(means));
  }
  return rows;
}

describe("cite rule descriptions", () => {
  it("say what the fix page's It means column says, for every rule", () => {
    const page = itMeans();
    expect([...page.keys()]).toEqual([...CITE_RULES]);
    // A claim rule's cell holds today's body-line wording, then the pointer
    // wording a metadata value's finding prints (proposal 0108).
    for (const rule of CITE_RULES) {
      const both = [RULE_DESCRIPTIONS[rule], POINTER_RULE_DESCRIPTIONS[rule]].filter((d) => d !== undefined);
      expect(both.join(" "), rule).toBe(page.get(rule));
    }
  });

  it("each have a section of the fix page to link to", () => {
    const text = readFileSync(PAGE, "utf8");
    for (const rule of CITE_RULES) expect(text, rule).toMatch(new RegExp(`^### ${rule}$`, "m"));
  });
});
