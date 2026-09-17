/**
 * `term lint`: the definitions against the house voice (proposal 0052 § 6).
 *
 * Each entry's `definition`, `abstract` and `scope-note` is written to a
 * temporary `<id>.<field>.md`, and Vale runs once over the directory holding
 * them. The file name is the voice switch: a `[*.definition.md]` section in the
 * user's own `.vale.ini` applies to definitions alone. One file per field keeps
 * a document-wide rule from reaching across unrelated entries.
 *
 * Vale is given the directory rather than the file list so a large set does not
 * run into the platform's command-line length limit; the directory holds only
 * the files written here.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Term, TermField, TermFinding, TermSet } from "../types.js";
import { foldValeSeverity, proseRuleId } from "./severity.js";
import { runValeJson } from "./vale.js";

export interface LintTermSetOptions {
  /** Absolute; from `valeConfigPath(run.tools, run.configDir)`. */
  valeConfig?: string;
  /** Where Vale runs, and so where it looks for its own config. */
  cwd?: string;
  runVale?: typeof runValeJson;
}

/** The prose fields `lint` reads, in the order it writes them. */
export const PROSE_FIELDS = ["definition", "abstract", "scope-note"] as const satisfies readonly TermField[];
type ProseField = (typeof PROSE_FIELDS)[number];

interface Written {
  term: Term;
  field: ProseField;
  value: string;
}

/** A term id made safe as a file name component. */
function fileStem(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe === "" ? "_" : safe;
}

/** The last component of a path printed by Vale, whichever separator it used. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** The source line a line of a field's prose sits on. */
function sourceLine(written: Written, proseLine: number): number {
  const { term, field, value } = written;
  const fieldLine = term.location.fieldLines[field] ?? term.location.line;
  if (!value.includes("\n")) return fieldLine;
  const { construct } = term.location;
  return construct === "page" || construct === "manifest" ? fieldLine + proseLine : fieldLine + proseLine - 1;
}

function compareFindings(a: TermFinding, b: TermFinding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const lineA = a.line ?? 0;
  const lineB = b.line ?? 0;
  if (lineA !== lineB) return lineA - lineB;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export async function lintTermSet(set: TermSet, opts: LintTermSetOptions = {}): Promise<TermFinding[]> {
  // Keyed by lowercased file name: Vale may print the path in another case, and
  // a case-insensitive file system would fold `API` and `api` onto one file.
  const byName = new Map<string, Written>();
  const files: { name: string; content: string }[] = [];
  const stemCount = new Map<string, number>();

  for (const term of set.terms) {
    const fields = PROSE_FIELDS.filter((field) => term.record[field] !== undefined);
    if (fields.length === 0) continue;
    const stem = fileStem(term.id);
    const seen = (stemCount.get(stem.toLowerCase()) ?? 0) + 1;
    stemCount.set(stem.toLowerCase(), seen);
    // A repeated id is suffixed before the field, so `*.definition.md` still matches it.
    const prefix = seen === 1 ? stem : `${stem}.${String(seen)}`;
    for (const field of fields) {
      const value = term.record[field];
      if (value === undefined) continue;
      const name = `${prefix}.${field}.md`;
      byName.set(name.toLowerCase(), { term, field, value });
      files.push({ name, content: `${value}\n` });
    }
  }

  if (files.length === 0) return [];

  const runVale = opts.runVale ?? runValeJson;
  const dir = await mkdtemp(join(tmpdir(), "manni-term-lint-"));
  try {
    for (const file of files) await writeFile(join(dir, file.name), file.content, "utf8");
    const alerts = await runVale([dir], { config: opts.valeConfig, cwd: opts.cwd });

    const findings: TermFinding[] = [];
    for (const [path, list] of Object.entries(alerts)) {
      const written = byName.get(baseName(path).toLowerCase());
      if (written === undefined) continue;
      for (const alert of list) {
        findings.push({
          ruleId: proseRuleId(alert.Check),
          severity: foldValeSeverity(alert.Severity),
          message: alert.Message,
          file: written.term.location.file,
          line: sourceLine(written, alert.Line),
          id: written.term.id,
          tool: "vale",
          check: alert.Check,
          toolSeverity: alert.Severity,
          field: written.field,
        });
      }
    }
    return findings.sort(compareFindings);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
