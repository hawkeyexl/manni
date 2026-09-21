/**
 * `tables:` - table counts and the header cells every table must carry.
 *
 * `columns` is diagnostic, not a count filter: every table in the run counts
 * toward `min`/`max` whether or not its columns match, and a mismatch is
 * reported once per offending table (the same treatment `codeBlocks.language`
 * and `admonitions.variant` get, and unlike `codeBlocks.fenceInfo`, which has
 * no message form and narrows the count instead).
 */

import type { ContentNode, Finding, SectionNode, TableNode } from "../types.js";
import {
  checkCount,
  quoteList,
  sectionContext,
  tablesOf,
  type RuleContext,
  type TablesRule,
} from "./index.js";

/** Checks the tables a section holds directly. */
export function checkTables(
  section: SectionNode,
  rule: TablesRule | undefined,
): Finding[] {
  return checkTablesIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the tables in any ordered content list. */
export function checkTablesIn(
  content: ContentNode[],
  rule: TablesRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const tables = tablesOf(content);
  const findings = checkCount(tables.length, rule, "table", "tables_count_error", ctx);

  if (rule.columns) {
    for (const table of tables) {
      const actual = headerCells(table);
      if (!sameColumns(actual, rule.columns)) {
        findings.push({
          type: "tables_columns_error",
          heading: ctx.heading,
          message: `Expected table columns ${quoteList(rule.columns)}, but found ${quoteList(actual)}`,
          position: table.position,
          severity: "error",
        });
      }
    }
  }

  return findings;
}

function headerCells(table: TableNode): string[] {
  const header = table.children.find((row) => row.header);
  return header ? header.children.map((cell) => cell.text) : [];
}

function sameColumns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((cell, index) => cell === expected[index]);
}
