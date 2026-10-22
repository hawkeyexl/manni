/**
 * A strategy finding's guidance says when its rule fires in the words the
 * rules page uses. The page's "Fires when" column is the source, and this
 * holds the code's table equal to it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY, RULE_DESCRIPTIONS } from "../../src/strategy/core/severity.js";
import { STRATEGY_RULES } from "../../src/strategy/types.js";

const PAGE = join(import.meta.dirname, "..", "..", "docs", "src", "content", "docs", "strategy", "reference", "rules.mdx");

/** A table cell as plain text: code spans unwrapped, links reduced to their text. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

/** The rules table: each rule to its default and its "Fires when" cell. */
function rulesTable(): Map<string, { level: string; fires: string }> {
  const lines = readFileSync(PAGE, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\| Rule \| Default \| Fires when \|$/.test(line));
  const rows = new Map<string, { level: string; fires: string }>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [, rule, level, fires] = line.split("|").map((cell) => cell.trim());
    if (rule !== undefined && level !== undefined && fires !== undefined) {
      rows.set(plain(rule), { level: plain(level), fires: plain(fires) });
    }
  }
  return rows;
}

describe("strategy rule descriptions", () => {
  it("say what the rules page's Fires when column says, at the default it lists, for every rule", () => {
    const page = rulesTable();
    expect([...page.keys()].sort()).toEqual([...STRATEGY_RULES].sort());
    for (const rule of STRATEGY_RULES) {
      expect(RULE_DESCRIPTIONS[rule], rule).toBe(page.get(rule)?.fires);
      expect(DEFAULT_SEVERITY[rule], rule).toBe(page.get(rule)?.level);
    }
  });

  it("each have a section of the rules page to link to", () => {
    const text = readFileSync(PAGE, "utf8");
    for (const rule of STRATEGY_RULES) expect(text, rule).toMatch(new RegExp(`^### \`?${rule}\`?$`, "m"));
  });
});
