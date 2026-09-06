/**
 * Native freshness check: the page's review date (default frontmatter field
 * `last-reviewed`) must be within `maxAgeDays`. No external tool covers this
 * frontmatter-driven staleness contract, so it's built in.
 */
import type { Finding } from "../../types.js";
import type { Grader } from "./../types.js";
import {
  firstError,
  knownKeys,
  optionalNumber,
  optionalString,
  type OptionCheck,
  type Options,
} from "../options.js";

interface FreshnessOptions {
  field?: string;
  "max-age-days"?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A frontmatter value, as a string a reader can act on.
 *
 * The value comes from YAML, so it can be a mapping or a list. `String(...)`
 * renders those as "[object Object]", which names neither the mistake nor the
 * value — in a message whose whole job is to show what was written.
 */
function describe(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  // Objects, arrays and null. Anything JSON cannot render (a function, a
  // symbol) cannot come out of a YAML parser.
  return JSON.stringify(raw);
}

export const freshnessGrader: Grader = {
  kind: "tool:freshness",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["field", "max-age-days"]),
      optionalString(options, "field"),
      optionalNumber(options, "max-age-days", { min: 0 }),
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const opts = ev.options as FreshnessOptions;
      const field = opts.field ?? "last-reviewed";
      const maxAgeDays = opts["max-age-days"] ?? 365;
      const raw = plan.page.frontmatter.data[field];

      if (raw == null) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "freshness/missing",
          message: `Missing "${field}" frontmatter field`,
          severity: ev.severity,
          line: 1,
        });
        continue;
      }
      const date = raw instanceof Date ? raw : new Date(describe(raw));
      if (Number.isNaN(date.getTime())) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "freshness/invalid",
          message: `Unparseable "${field}" date: ${describe(raw)}`,
          severity: ev.severity,
          line: plan.page.frontmatter.lineFor(`/${field}`),
        });
        continue;
      }
      const ageDays = Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
      if (ageDays > maxAgeDays) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "freshness/stale",
          message: `Page last reviewed ${ageDays} days ago (max ${maxAgeDays})`,
          severity: ev.severity,
          line: plan.page.frontmatter.lineFor(`/${field}`),
        });
      }
    }
    return findings;
  },
};
