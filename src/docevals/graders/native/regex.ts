/**
 * Native regex check over whatever `target` selects.
 *
 * The cheap rung the grader hierarchy was missing. An assertion like "the page
 * names the current package" is a verifiable fact, and putting it to an LLM
 * judge three times is both slower and less trustworthy than matching it —
 * "use an ai grader only when a deterministic one cannot express it" is only
 * advice you can follow if a deterministic one exists.
 *
 * `match` covers the three shapes worth having: `contains` (the default),
 * `not-contains`, and `count:N` for "exactly N times", which is what catches a
 * heading duplicated by a bad merge.
 */
import type { Finding } from "../../types.js";
import type { Grader } from "./../types.js";
import {
  firstError,
  knownKeys,
  optionalString,
  requiredString,
  type OptionCheck,
  type Options,
} from "../options.js";
import { readTarget } from "../../core/target.js";

interface RegexOptions {
  pattern?: string;
  flags?: string;
  match?: string;
}

const MATCH_RE = /^(contains|not-contains|count:\d+)$/;
const FLAGS_RE = /^[dgimsuvy]*$/;

/** 1-based line of `index` within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

export const regexGrader: Grader = {
  kind: "tool:regex",
  // It calls `readTarget` directly, so it serves the whole vocabulary — the
  // one deterministic grader that does. Declaring it here is what exempts it
  // from the engine's body-only guard (ADR 01033).
  targets: ["body", "raw", "frontmatter", "file"] as const,
  validateOptions(options: Options): OptionCheck {
    const match = options.match;
    return firstError(
      knownKeys(options, ["pattern", "flags", "match"]),
      requiredString(options, "pattern"),
      optionalString(options, "flags"),
      typeof options.flags === "string" && !FLAGS_RE.test(options.flags)
        ? "options.flags must be JS RegExp flags (d g i m s u v y)"
        : undefined,
      match !== undefined && (typeof match !== "string" || !MATCH_RE.test(match))
        ? "options.match must be contains, not-contains, or count:N"
        : undefined,
      // A pattern that will not compile is a typo, not a finding: reporting it
      // as a failed assertion would blame the page for the eval's own bug.
      (() => {
        if (typeof options.pattern !== "string") return undefined;
        try {
          new RegExp(options.pattern, (options.flags as string | undefined) ?? "");
          return undefined;
        } catch (err) {
          return `options.pattern is not a valid regular expression (${
            err instanceof Error ? err.message : String(err)
          })`;
        }
      })(),
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const opts = ev.options as RegexOptions;
      const pattern = opts.pattern ?? "";
      const flags = opts.flags ?? "";
      const match = opts.match ?? "contains";

      const selected = readTarget(ev.target, plan);
      if (!selected.ok) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "regex/unreadable-target",
          message: selected.reason,
          severity: ev.severity,
          line: 1,
        });
        continue;
      }

      const text = selected.text;
      // Always count with /g so `count:N` is a count and not a boolean, then
      // read the first match's offset for the line number.
      const all = [...text.matchAll(new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`))];
      const first = all[0];

      if (match === "contains" && all.length === 0) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "regex/not-found",
          message: `Pattern /${pattern}/${flags} not found in ${selected.label}`,
          severity: ev.severity,
          line: 1,
        });
      } else if (match === "not-contains" && all.length > 0) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "regex/found",
          message: `Pattern /${pattern}/${flags} found in ${selected.label}, expected absent`,
          severity: ev.severity,
          line: lineAt(text, first?.index ?? 0),
        });
      } else if (match.startsWith("count:")) {
        const want = Number(match.slice("count:".length));
        if (all.length !== want) {
          findings.push({
            evalName: ev.name,
            file: plan.page.file,
            ruleId: "regex/count",
            message: `Pattern /${pattern}/${flags} matched ${String(all.length)} time(s) in ${selected.label}, expected ${String(want)}`,
            severity: ev.severity,
            line: all.length > 0 ? lineAt(text, first?.index ?? 0) : 1,
          });
        }
      }
    }
    return findings;
  },
};
