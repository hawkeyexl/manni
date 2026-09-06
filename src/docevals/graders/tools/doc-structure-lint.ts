/**
 * Tool adapter: doc-structure-lint. Validates page structure against a named
 * YAML template. Options:
 *   template (required): template name to apply
 *   templatePath: path to templates.yaml
 *   command: override for the executable
 * JSON output shape: [{ file, success, errors: [{ type, heading, message,
 * position: { start: { line }, ... } }] }]
 */
import type { Finding } from "../../types.js";
import { exited } from "../exec.js";

/**
 * Trailing slice of the output, for a message that must name what it read.
 *
 * stdout first — it is the stream that failed to parse — but falling back to
 * stderr, because a tool that dies loading its template writes nothing to
 * stdout and the message would otherwise end at a bare colon.
 */
function tail(
  result: { stdout: string; stderr: string },
  prefer: "stdout" | "stderr" = "stdout",
  maxChars = 400,
): string {
  const [first, second] =
    prefer === "stdout"
      ? [result.stdout, result.stderr]
      : [result.stderr, result.stdout];
  const t = (first.trim() || second.trim()).trim();
  return t.length <= maxChars ? t : `…${t.slice(-maxChars)}`;
}
import type { Grader } from "../types.js";
import {
  firstError,
  knownKeys,
  optionalString,
  optionalStringArray,
  type OptionCheck,
  type Options,
} from "../options.js";

interface DslError {
  type?: string;
  heading?: string;
  message?: string;
  position?: { start?: { line?: number; column?: number } };
}

interface DslResult {
  file?: string;
  success?: boolean;
  errors?: DslError[];
}

export const docStructureLintGrader: Grader = {
  kind: "tool:doc-structure-lint",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["template", "template-path", "command"]),
      optionalString(options, "template"),
      optionalString(options, "template-path"),
      optionalStringArray(options, "command"),
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const template = ev.options.template as string | undefined;
      if (!template) {
        // A diagnostic: with no template the tool is never invoked, so this
        // says nothing about the page. At `severity: warning` it used to
        // report and pass, which is a structure check that silently checks
        // nothing (ADR 01023).
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          message: 'tool:doc-structure-lint needs options.template (e.g. "how-to")',
          severity: ev.severity,
          diagnostic: true,
        });
        continue;
      }
      const commandOverride = ev.options.command as string[] | undefined;
      const templatePath = ev.options["template-path"] as string | undefined;
      const cmd = [
        ...(commandOverride ?? ["npx", "--no-install", "doc-structure-lint"]),
        "--file-path",
        plan.page.file,
        "--template",
        template,
        ...(templatePath ? ["--template-path", templatePath] : []),
        "--json",
      ];
      const unreadable = (detail: string): void => {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "doc-structure-lint/unreadable",
          message: detail,
          severity: ev.severity,
          diagnostic: true,
        });
      };

      const result = await ctx.exec(cmd, {
        cwd: ctx.root,
        timeoutMs: ev.timeoutMs ?? 120000,
      });
      if (result.spawnError) {
        unreadable(
          `Failed to run doc-structure-lint: ${result.spawnError} (is it installed?)`,
        );
        continue;
      }
      // Output this grader cannot read is a finding, never a pass.
      //
      // Both branches below used to end in a bare `continue`: unparseable
      // stdout with exit 0 produced no finding at all, and valid JSON of the
      // wrong shape reached the loop and threw `parsed is not iterable`. The
      // first is the green-with-nothing-checked failure the corpus gate exists
      // to prevent — the same hazard ci.yml added an explicit guard for on
      // doc-detective, where a page whose steps all fail to parse reports
      // success. An eval must not pass because its tool became unreadable.
      // Unreadable output is marked `diagnostic: true` and keeps the eval's
      // configured severity for display. ADR 01020 hard-coded `error` here
      // instead; ADR 01022 superseded that, because the property is not this
      // adapter's — it belongs to every grader, and five of the six had it
      // wrong while each one had to remember. `core/engine.ts` fails an eval
      // on `severity === "error" || diagnostic === true`, so a
      // `severity: warning` structure check renders this as a warning and
      // still fails, and severity keeps meaning what it means for a real page
      // problem.

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        // Both branches are diagnostics: neither reached a verdict about the
        // page. The non-zero branch is the likeliest of all — it is what an
        // uninstalled tool produces — and it used to pass at warning severity.
        unreadable(
          result.code === 0
            ? `doc-structure-lint exited 0 but its output could not be read as JSON: ${tail(result)}`
            : `doc-structure-lint ${exited(result.code)}: ${tail(result, "stderr")}`,
        );
        continue;
      }
      if (!Array.isArray(parsed)) {
        unreadable(
          `doc-structure-lint returned JSON of an unexpected shape (expected a list of results): ${tail(result)}`,
        );
        continue;
      }
      // Validating the container is not enough: `["ok"]` gave `r.errors ===
      // undefined`, so the eval passed on output nobody could read, and
      // `[null]` threw out of grade(), which the engine turns into an error on
      // every target of this kind rather than a finding on the one page.
      // `typeof [] === "object"`, so an array element would otherwise satisfy
      // this and fall through to a silent pass. Every entry is validated up
      // front so one payload yields at most one diagnostic, and so a payload
      // declared unreadable never also contributes parsed findings.
      const malformed = parsed.some(
        (r) =>
          typeof r !== "object" ||
          r === null ||
          Array.isArray(r) ||
          ((r as DslResult).errors !== undefined &&
            !Array.isArray((r as DslResult).errors)),
      );
      if (malformed) {
        unreadable(
          `doc-structure-lint returned a list whose entries are not result objects: ${tail(result)}`,
        );
        continue;
      }
      for (const r of parsed as DslResult[]) {
        for (const err of r.errors ?? []) {
          findings.push({
            evalName: ev.name,
            file: plan.page.file,
            ruleId: err.type,
            message: err.heading
              ? `${err.heading}: ${err.message ?? "structure error"}`
              : (err.message ?? "structure error"),
            severity: ev.severity,
            line: err.position?.start?.line,
            col: err.position?.start?.column,
          });
        }
      }
    }
    return findings;
  },
};
