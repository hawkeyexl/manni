/**
 * The findings baseline — a ratchet (ADR 01017).
 *
 * A baseline records today's findings so a run can fail on *new* ones only.
 * That is what lets a team turn an eval on this Monday instead of after a
 * 500-page cleanup: the standard tightens immediately, the backlog is recorded,
 * and nothing regresses past the recorded state.
 *
 * Ported from docmeta's `src/core/baseline.ts`, which solved this first.
 * `manni.config.yaml` is shared by the family (ADR 01008), so the two tools
 * spell the idea the same way. What differs is the fingerprint: docmeta has a
 * JSON Pointer into structured metadata, and we grade prose. See `fingerprint`.
 *
 * Scope: **findings**, which means deterministic graders. An ai-graded eval's
 * verdict carries no rule identity to fingerprint, and a judge verdict is not
 * the kind of thing a backlog file should freeze — the human-review queue is
 * the mechanism for those.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { DocevalsError, type EvalResult, type Finding } from "../types.js";

/** Where `--baseline` / `--write-baseline` / `baseline:` point when unspecified. */
export const DEFAULT_BASELINE_PATH = ".manni-docevals-baseline.json";

/** The only file format this version understands. */
export const BASELINE_VERSION = 1;

/** Exactly what `fingerprint` emits: 16 lowercase hex characters. */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

export interface Baseline {
  version: number;
  /** manni docevals version that produced the file, for diagnosis only. */
  generatedWith: string;
  /** File path (as reported in results) -> sorted finding fingerprints. */
  entries: Record<string, string[]>;
}

/** The parts of a finding a fingerprint is built from. */
export type Fingerprintable = Pick<Finding, "evalName" | "ruleId">;

/** What file labels are made relative to, so a baseline reads the same anywhere. */
export interface FingerprintContext {
  /** Directory canonical paths are expressed relative to: the config's. */
  base: string;
  /** Directory a result's `file` label is relative to. Defaults to `base`. */
  runBase?: string;
}

/**
 * The key a file's entry is stored under.
 *
 * Result labels are relative to whatever the run resolved against, so the same
 * page is `docs/legacy.md` from the repo root and `legacy.md` from inside
 * `docs/`. A baseline is committed and shared, so its keys have to name the
 * file the same way from anywhere — otherwise the lookup misses and every
 * baselined finding reads as new, without a fingerprint ever being compared.
 */
export function canonicalFilePath(file: string, ctx?: FingerprintContext): string {
  if (!ctx) return file;
  const from = ctx.runBase ?? ctx.base;
  return relative(ctx.base, resolve(from, file)).replace(/\\/g, "/");
}

/**
 * A finding's stable identity: 16 hex characters of
 * `sha256(evalName NUL ruleId)`.
 *
 * `ruleId` is the tool's own rule (`MD013`, `Vale.Spelling`, `freshness/stale`).
 * Unlike `ruleIdFor` in the SARIF reporter it is *not* defaulted to the eval
 * name when absent — `evalName` is already the first component, so an empty
 * second one is unambiguous, and `doc-detective` (the one adapter that leaves
 * `ruleId` undefined) would otherwise hash its eval name twice.
 *
 * Deliberately excludes:
 *
 * - **the line number** — adding one line shifts every finding below it, and a
 *   fingerprint that moved with it would present a pure reordering as a wall of
 *   new findings;
 * - **the message prose** — markdownlint and Vale generate it, so an upstream
 *   reword would invalidate every affected entry in every consuming repo at
 *   once, presenting as "manni docevals broke our build";
 * - **the file path** — it is already the entry key.
 *
 * The consequence, and it is a real one: identity is per rule per file, **not
 * per occurrence**. A file baselined for three `MD013` findings will not fail
 * when a fourth appears. Prose has no stable per-occurrence anchor — a text
 * snippet churns on every edit, an ordinal renumbers on every insertion, which
 * is the line-number problem again.
 *
 * The NUL separator is what keeps `("ab", undefined)` and `("a", "b")` apart.
 */
export function fingerprint(f: Fingerprintable): string {
  const parts = [f.evalName, f.ruleId ?? ""];
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

/** Sorted keys and sorted fingerprints, so the file diffs and merges legibly. */
export function serializeBaseline(baseline: Baseline): string {
  // Null-prototype for the same reason `parseBaseline` uses one: a file key of
  // `__proto__` assigned into a plain object literal would set the prototype
  // and drop the entry, so a parse/serialize round-trip would lose it silently.
  const entries = Object.create(null) as Record<string, string[]>;
  for (const file of Object.keys(baseline.entries).sort()) {
    entries[file] = [...(baseline.entries[file] ?? [])].sort();
  }
  return `${JSON.stringify(
    { version: baseline.version, generatedWith: baseline.generatedWith, entries },
    null,
    2,
  )}\n`;
}

function bad(source: string, detail: string): never {
  throw new DocevalsError(`Baseline "${source}": ${detail}`);
}

/** Parse baseline JSON. `source` is the path as the user would type it. */
export function parseBaseline(text: string, source: string): Baseline {
  let raw: unknown;
  try {
    // A committed file an editor may have re-saved. Nothing hashes it, so this
    // is purely a parsing concession.
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    bad(source, `invalid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad(source, "top level must be an object.");
  }
  const obj = raw as Record<string, unknown>;

  if (obj.version !== BASELINE_VERSION) {
    bad(
      source,
      `unsupported version ${JSON.stringify(obj.version)} (this manni docevals writes version ${BASELINE_VERSION}). Re-record it with \`manni docevals run --write-baseline\`.`,
    );
  }

  const rawEntries = obj.entries;
  if (
    typeof rawEntries !== "object" ||
    rawEntries === null ||
    Array.isArray(rawEntries)
  ) {
    bad(source, '"entries" must be an object mapping file paths to fingerprints.');
  }

  // Null-prototype, so a file key of `__proto__` is stored as an ordinary entry
  // rather than triggering the inherited setter — which would replace this
  // object's prototype and silently drop the entry. Every other malformation
  // here is rejected loudly; that one would not even be visible.
  const entries = Object.create(null) as Record<string, string[]>;
  for (const [file, value] of Object.entries(rawEntries as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      bad(source, `entries["${file}"] must be a list of fingerprint strings.`);
    }
    // A fingerprint that is not the shape this code writes can never match a
    // real finding, so a typo in a hand-edited baseline would otherwise present
    // as "that finding came back" with nothing to explain it. Reject it where
    // the user can still see which entry is wrong.
    const malformed = (value as string[]).find((v) => !FINGERPRINT_RE.test(v));
    if (malformed !== undefined) {
      bad(
        source,
        `entries["${file}"] contains ${JSON.stringify(malformed)}, which is not a fingerprint (16 lowercase hex characters).`,
      );
    }
    entries[file] = value as string[];
  }

  return {
    version: BASELINE_VERSION,
    generatedWith: typeof obj.generatedWith === "string" ? obj.generatedWith : "",
    entries,
  };
}

/** Read a baseline from disk. Returns null when the file does not exist. */
export function readBaseline(absPath: string, source: string): Baseline | null {
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DocevalsError(
      `Baseline "${source}" could not be read: ${(err as Error).message}`,
    );
  }
  return parseBaseline(text, source);
}

/**
 * Write the baseline atomically.
 *
 * It is a committed artifact the whole team's gate reads, and a truncated write
 * is not merely lost work: the next run cannot parse it and exits 2 until
 * someone re-records.
 */
export function writeBaselineFile(
  absPath: string,
  baseline: Baseline,
  source: string,
): void {
  try {
    mkdirSync(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    writeFileSync(tmp, serializeBaseline(baseline));
    renameSync(tmp, absPath);
  } catch (err) {
    throw new DocevalsError(
      `Baseline "${source}" could not be written: ${(err as Error).message}`,
    );
  }
}

/** Record every finding in `results` as a baseline. Clean files are omitted. */
export function buildBaseline(
  results: EvalResult[],
  generatedWith: string,
  ctx?: FingerprintContext,
): Baseline {
  // Null-prototype, and here it prevents a crash rather than a lost entry.
  // `__proto__` is the famous collision but not the reachable one; `toString`
  // is a legal filename. A *clean* file gets no entry, so `applyBaseline`'s
  // lookup would find the inherited method instead of `undefined`, pass the
  // `!known` guard because a function is truthy, and then die in `new Set(known)`.
  const entries = Object.create(null) as Record<string, string[]>;
  for (const r of results) {
    // Keyed by `r.file`, matching `applyBaseline`'s lookup. `groupFindings`
    // currently guarantees `f.file === r.file`, so keying by the finding was
    // not a live bug — but the asymmetry is a trap: a grader that resolved a
    // path differently would build entries the lookup could never match, and
    // every baselined finding would reappear as new with nothing to explain it.
    const key = canonicalFilePath(r.file, ctx);
    for (const f of r.findings ?? []) {
      // A diagnostic is never recorded. It is not a finding *about the page* —
      // it is the grader reporting that it could not reach a verdict, and ADR
      // 01022 says that fails the eval at any severity. Recording it lets the
      // next run suppress it, which empties `fresh` entirely and makes the
      // recompute below yield `pass`: "the grader could not run" becomes a
      // permanent green that no later run can dislodge. The severity-plus-
      // diagnostic predicate in `applyBaseline` only covers *partial*
      // suppression; this is what covers the whole-set case.
      if (f.diagnostic === true) continue;
      const list = entries[key] ?? [];
      const print = fingerprint(f);
      // Two identical findings in one file are one fingerprint; storing the
      // duplicate would only make the count meaningless.
      if (!list.includes(print)) list.push(print);
      entries[key] = list;
    }
  }
  return { version: BASELINE_VERSION, generatedWith, entries };
}

export interface AppliedBaseline {
  /** Results with baselined findings removed and outcomes recomputed. */
  results: EvalResult[];
  /** Fingerprints the baseline holds **for the files this run checked**. */
  recorded: number;
  /** Findings suppressed because the baseline already had them. */
  suppressed: number;
  /** Recorded fingerprints for checked files that no longer occur. */
  stale: number;
}

/**
 * Subtract a baseline from a run's results.
 *
 * `recorded` and `stale` count only the files this run actually checked. The
 * alternative — counting the whole file — would make a single-page run announce
 * that hundreds of entries "no longer occur", and the advice that follows
 * (re-record to prune) would then destroy them.
 */
export function applyBaseline(
  results: EvalResult[],
  baseline: Baseline,
  ctx?: FingerprintContext,
): AppliedBaseline {
  let suppressed = 0;
  const seenByFile = new Map<string, Set<string>>();
  const touched = new Set<string>();

  const applied = results.map((r) => {
    // "Touched" means this run actually graded the file, which is not the same
    // as having produced a result for it. A clean pass must count, because a
    // file whose findings were all fixed is exactly what `stale` exists to
    // surface. A `skipped` or `error` result must NOT: the eval never ran, so
    // its recorded findings are not gone, they are unmeasured — and reporting
    // them as "no longer occur" invites the re-record that deletes them.
    const key = canonicalFilePath(r.file, ctx);
    if (r.outcome === "pass" || r.outcome === "fail") touched.add(key);
    const findings = r.findings;
    if (!findings || findings.length === 0) return r;
    const known = baseline.entries[key];
    if (!known) return r; // no entry: a new or renamed file, everything is new

    const recordedHere = new Set(known);
    const seen = seenByFile.get(key) ?? new Set<string>();
    const fresh: Finding[] = [];
    for (const f of findings) {
      const print = fingerprint(f);
      if (recordedHere.has(print)) {
        seen.add(print);
        suppressed += 1;
      } else {
        fresh.push(f);
      }
    }
    seenByFile.set(key, seen);

    if (fresh.length === findings.length) return r;
    // Outcome is recomputed rather than preserved: a deterministic eval fails
    // only on an error-severity finding, so suppressing the last of them makes
    // the eval pass. Leaving `outcome` alone would baseline the finding and
    // still fail the run.
    // `diagnostic` is part of the failing condition, not just severity. A
    // diagnostic finding means the grader reached no verdict, and ADR 01022
    // says that fails the eval at any severity — the engine enforces exactly
    // that when it first computes the outcome. Recomputing on severity alone
    // let a baseline turn "the grader could not run" into `pass`, which is the
    // one thing a baseline must never forgive: it suppresses *known* findings,
    // never the absence of a verdict.
    const hasError = fresh.some(
      (f) => f.severity === "error" || f.diagnostic === true,
    );
    return {
      ...r,
      outcome: hasError ? ("fail" as const) : ("pass" as const),
      ...(fresh.length > 0 ? { findings: fresh } : { findings: undefined }),
      baselined: findings.length - fresh.length,
    };
  });

  let recorded = 0;
  let stale = 0;
  for (const key of touched) {
    const known = baseline.entries[key];
    if (!known) continue;
    const recordedHere = new Set(known);
    recorded += recordedHere.size;
    stale += recordedHere.size - (seenByFile.get(key)?.size ?? 0);
  }

  return { results: applied, recorded, suppressed, stale };
}

/**
 * Count fingerprints added and dropped between two baselines.
 *
 * The `removed` half is the load-bearing one: an accidental `--write-baseline`
 * on a narrowed glob or a mistyped exclude silently forgives everything it did
 * not see, and this number is the only thing that makes that visible in a CI log.
 */
export function diffBaselines(
  previous: Baseline | null,
  next: Baseline,
): { added: number; removed: number } {
  const flatten = (b: Baseline | null): Set<string> => {
    const out = new Set<string>();
    if (!b) return out;
    for (const [file, prints] of Object.entries(b.entries)) {
      for (const p of prints) out.add(`${file}\0${p}`);
    }
    return out;
  };
  const before = flatten(previous);
  const after = flatten(next);
  let added = 0;
  let removed = 0;
  for (const k of after) if (!before.has(k)) added += 1;
  for (const k of before) if (!after.has(k)) removed += 1;
  return { added, removed };
}

/** Total fingerprints held in a baseline, across every file. */
export function countFingerprints(baseline: Baseline): number {
  let n = 0;
  for (const prints of Object.values(baseline.entries)) n += prints.length;
  return n;
}
