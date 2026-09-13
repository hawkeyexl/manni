/**
 * `provenance`, derived (proposal 0046 § The derivation contract): which body
 * lines a machine wrote, read from `git blame --line-porcelain` and the
 * commits it names, compared with the pins a page already carries.
 *
 * Pure functions over parsed inputs. Running blame, reading commit messages
 * and reading blobs at a commit is the git source's job (`git.ts`); nothing
 * here spawns a process or touches the filesystem.
 *
 * The reference implementation is `docs/proposals/0046/ladders/blame-examples.cjs`.
 * Every rule its `RESOLVED` notes decide is carried here, and the test suite
 * runs the ladder beside this module so the two cannot drift apart.
 *
 * Two numberings meet here. Entries store BODY lines, counted from the first
 * line after the frontmatter, so writing the stamp never moves its own pins.
 * Everything a person reads — a range on the command line, a report, a
 * finding — is FILE lines, and the conversion happens at that edge.
 */
import picomatch from "picomatch";
import { extractFrontmatter, locateFrontmatter } from "../../extractors/frontmatter.js";
import { DocmetaError, type FieldError } from "../../types.js";
import {
  LineRangeError,
  findWindows,
  lineSpec,
  parseLines,
  pinOfLines,
  spellLines,
  splitLines,
  splitPageArgument,
  toBodyLines,
  toFileLines,
  type LineSpec,
  type PageLines,
} from "../../../shared/pin.js";
import { DERIVED_KEYWORD, DERIVED_STALE_SCHEMA } from "./types.js";

/** The sha blame reports for a line that is not committed yet. */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

/** `derive.machines` when the config does not set it: 0040's `[bot]` suffix. */
export const DEFAULT_MACHINES: readonly string[] = ["*[bot]"];

/** The instance path every provenance finding carries. */
const PROVENANCE_POINTER = "/provenance";

// ---------------------------------------------------------------------------
// Entries and pages
// ---------------------------------------------------------------------------

/** One `provenance` entry as stored: body lines, and the pin over them. */
export interface ProvenanceEntry {
  "generated-by": string;
  lines: LineSpec;
  integrity: string;
}

const ENTRY_KEYS = new Set(["generated-by", "lines", "integrity"]);
const PLAIN_PIN = /^sha256-[0-9a-f]{64}$/;

/**
 * The well-formed entries of a `provenance` value, in order. An entry the
 * schema would reject — no machine, unreadable lines, a pin that is not
 * `sha256-`, a key the closed entry does not allow — is neither evidence nor
 * compared: the schema finding speaks for it.
 */
export function provenanceEntries(value: unknown): ProvenanceEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ProvenanceEntry[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((k) => !ENTRY_KEYS.has(k))) continue;
    const machine = record["generated-by"];
    const lines = record.lines;
    const integrity = record.integrity;
    if (typeof machine !== "string" || machine === "") continue;
    if (typeof lines !== "string" && typeof lines !== "number") continue;
    if (parseLines(lines) === undefined) continue;
    if (typeof integrity !== "string" || !PLAIN_PIN.test(integrity)) continue;
    out.push({ "generated-by": machine, lines, integrity });
  }
  return out;
}

/** A page read for provenance. */
export interface ProvenancePage {
  /** Every normalized line of the file. */
  lines: string[];
  /** The file line body line 1 sits on. */
  bodyLine: number;
  /** The body's lines: `lines` from `bodyLine` on. */
  body: string[];
  /** The well-formed `provenance` entries the frontmatter carries. */
  stamp: ProvenanceEntry[];
}

export interface ReadPageOptions {
  /**
   * Whether the page's metadata is a leading fenced block. Default true. A
   * page whose metadata is part of the body (html, xml, dita) has body line 1
   * at file line 1 and carries no stamp of its own; its record lives in a
   * manifest.
   */
  fenced?: boolean;
}

/**
 * Split a page into its body and its stamp. The frontmatter is the block
 * `validate` reads; one that does not parse carries no stamp, and its body
 * still starts after it.
 */
export function readProvenancePage(content: string, opts?: ReadPageOptions): ProvenancePage {
  const lines = splitLines(content);
  const loc = opts?.fenced === false ? null : locateFrontmatter(content);
  if (loc === null) return { lines, bodyLine: 1, body: lines, stamp: [] };
  const head = content.slice(0, loc.closeEnd);
  const newlines = head.split("\n").length - 1;
  // The body starts on the line after the block, and one line further when
  // the file ends at the closing fence with no newline after it.
  const bodyLine = newlines + (head.endsWith("\n") ? 1 : 2);
  let stamp: ProvenanceEntry[] = [];
  try {
    stamp = provenanceEntries(extractFrontmatter(content, "markdown").data.provenance);
  } catch {
    stamp = [];
  }
  return { lines, bodyLine, body: lines.slice(bodyLine - 1), stamp };
}

// ---------------------------------------------------------------------------
// git blame --line-porcelain
// ---------------------------------------------------------------------------

/** One final line of `git blame --line-porcelain`. */
export interface BlameLine {
  sha: string;
  /** The line's number in the commit that last changed it. */
  origLine: number;
  /** The line's number in the working file. */
  finalLine: number;
  /** Lines in this group; blame writes it on a group's first line only. */
  groupCount?: number;
  author: string;
  /** `author-mail` without its angle brackets. */
  authorMail: string;
  filename: string;
  /** `previous <sha> <filename>`, when blame reports one. */
  previous?: { sha: string; filename: string };
  /** The commit is a boundary of the blamed history (a root, or a `--since` edge). */
  boundary: boolean;
  /** The zero sha: a line not committed yet. */
  uncommitted: boolean;
  /** The line as the working file holds it, a CR included. */
  content: string;
}

const HEADER = /^([0-9a-f]{40}) ([1-9][0-9]*) ([1-9][0-9]*)(?: ([1-9][0-9]*))?$/;

/**
 * Parse `git blame --line-porcelain`. Throws a plain `Error` on anything
 * else, plain `--porcelain` included: that form writes a group's header once,
 * and a line without its header cannot be attributed. Both are the caller's
 * bug, never the user's.
 */
export function parseLinePorcelain(text: string): BlameLine[] {
  const rows = text.split("\n");
  if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  const out: BlameLine[] = [];
  let i = 0;
  while (i < rows.length) {
    const headerRow = rows[i] ?? "";
    const m = HEADER.exec(headerRow);
    const sha = m?.[1];
    const orig = m?.[2];
    const final = m?.[3];
    if (sha === undefined || orig === undefined || final === undefined) {
      throw new Error(`porcelain: expected a header at row ${i + 1}, got ${JSON.stringify(headerRow)}`);
    }
    const finalLine = Number(final);
    const count = m?.[4];
    const fields = new Map<string, string | true>();
    i++;
    for (let row = rows[i]; row !== undefined && !row.startsWith("\t"); row = rows[i]) {
      const space = row.indexOf(" ");
      if (space === -1) fields.set(row, true);
      else fields.set(row.slice(0, space), row.slice(space + 1));
      i++;
    }
    const contentRow = rows[i];
    if (contentRow === undefined) throw new Error(`porcelain: line ${finalLine} has no content row`);
    const author = fields.get("author");
    const filename = fields.get("filename");
    if (typeof author !== "string" || typeof filename !== "string") {
      throw new Error(`porcelain: line ${finalLine} has no full header; run blame with --line-porcelain`);
    }
    const mail = fields.get("author-mail");
    const previous = fields.get("previous");
    const space = typeof previous === "string" ? previous.indexOf(" ") : -1;
    out.push({
      sha,
      origLine: Number(orig),
      finalLine,
      ...(count !== undefined ? { groupCount: Number(count) } : {}),
      author,
      authorMail: typeof mail === "string" ? mail.replace(/^<(.*)>$/, "$1") : "",
      filename,
      ...(typeof previous === "string" && space !== -1
        ? { previous: { sha: previous.slice(0, space), filename: previous.slice(space + 1) } }
        : {}),
      boundary: fields.get("boundary") === true,
      uncommitted: sha === ZERO_SHA,
      content: contentRow.slice(1),
    });
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence, per body line
// ---------------------------------------------------------------------------

/** What one commit offers as evidence. */
export interface CommitEvidence {
  sha: string;
  /** Trailer values by kind, in message order. `collectTrailers` builds it from key/value pairs. */
  trailers: { generatedBy: string[]; coAuthoredBy: string[] };
  /** The page's full text at this commit; rule 2 is skipped without it. */
  blob?: string;
  /**
   * The `provenance` entries recorded at this commit, when the record lives
   * in a manifest (read from the manifest's blob at this commit, under the
   * page's path). Absent means the page's own frontmatter in `blob`.
   */
  stamp?: readonly ProvenanceEntry[];
}

/**
 * Trailer pairs sorted into the two kinds evidence reads. Keys compare
 * without case, as git's own trailer parsing does; values are trimmed and
 * keep message order.
 */
export function collectTrailers(pairs: readonly (readonly [string, string])[]): CommitEvidence["trailers"] {
  const trailers: CommitEvidence["trailers"] = { generatedBy: [], coAuthoredBy: [] };
  for (const [key, value] of pairs) {
    const k = key.toLowerCase();
    if (k === "generated-by") trailers.generatedBy.push(value.trim());
    else if (k === "co-authored-by") trailers.coAuthoredBy.push(value.trim());
  }
  return trailers;
}

/** Which of 0046's five evidence rules answered for a line. */
export type EvidenceRule = 1 | 2 | 3 | 4 | 5;

/** A line's evidence: the machine, or none under rule 5, and the blamed sha. */
export interface LineEvidence {
  machine?: string;
  rule: EvidenceRule;
  sha: string;
}

/**
 * The machine a `Name <email>` trailer value names, when its name or its
 * email matches a `derive.machines` glob; undefined for a person. Globs are
 * picomatch's, case-sensitive, with literal brackets, so `*[bot]` is a name
 * ending in `[bot]` and not "anything ending in b, o or t" (stress test 16).
 * The machine is the name as written, and the email only when the name is
 * empty.
 */
export function machineIdentity(value: string, machines: readonly string[]): string | undefined {
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(value);
  const name = m === null ? value.trim() : (m[1] ?? "");
  const email = m === null ? "" : (m[2] ?? "");
  const match = (s: string): boolean =>
    s !== "" && machines.some((glob) => picomatch.isMatch(s, glob, { literalBrackets: true }));
  if (!match(name) && !match(email)) return undefined;
  return name !== "" ? name : email;
}

/** What evidence resolution holds constant across a page. */
export interface EvidenceContext {
  commits: ReadonlyMap<string, CommitEvidence>;
  machines: readonly string[];
  /** `--generated-by`, or `MANNI_GENERATED_BY`; empty counts as unset. */
  generatedBy?: string;
  /** Whether the page's metadata is fenced, for reading commit blobs. Default true. */
  fenced?: boolean;
}

/**
 * Rule 2: the machine a verified stamp at the commit names for the line's
 * number there. The orig line is converted to that blob's own body
 * numbering, since the commit's frontmatter need not be today's. A stamp is
 * checked only at its recorded lines, so the same text elsewhere in the blob
 * does not count, and the first covering entry that verifies wins.
 */
function stampEvidence(commit: CommitEvidence, origLine: number, fenced: boolean | undefined): string | undefined {
  if (commit.blob === undefined) return undefined;
  const page = readProvenancePage(commit.blob, fenced === undefined ? undefined : { fenced });
  const body = origLine - page.bodyLine + 1;
  if (body < 1) return undefined;
  for (const entry of commit.stamp === undefined ? page.stamp : provenanceEntries(commit.stamp)) {
    const span = parseLines(entry.lines);
    if (span === undefined || body < span.start || body > span.end) continue;
    if (pinOfLines(page.body, span) === entry.integrity) return entry["generated-by"];
  }
  return undefined;
}

/**
 * Rules 2 to 4 for one line. An uncommitted line has no commit, so none of
 * them applies to it; in particular the working tree's own stamp is never
 * evidence for itself. A stamp outranks its own commit's trailers, because
 * the stamp names lines and a trailer names a commit.
 */
function recordedEvidence(line: BlameLine, ctx: EvidenceContext): LineEvidence {
  if (line.uncommitted) return { rule: 5, sha: line.sha };
  const commit = ctx.commits.get(line.sha);
  if (commit === undefined) throw new Error(`no commit ${line.sha}`);
  const stamped = stampEvidence(commit, line.origLine, ctx.fenced);
  if (stamped !== undefined) return { machine: stamped, rule: 2, sha: line.sha };
  const generated = commit.trailers.generatedBy.map((v) => v.trim()).find((v) => v !== "");
  if (generated !== undefined) return { machine: generated, rule: 3, sha: line.sha };
  for (const value of commit.trailers.coAuthoredBy) {
    const machine = machineIdentity(value.trim(), ctx.machines);
    if (machine !== undefined) return { machine, rule: 4, sha: line.sha };
  }
  return { rule: 5, sha: line.sha };
}

/** All five evidence rules for one blamed line, first match wins. */
export function resolveLineEvidence(line: BlameLine, ctx: EvidenceContext): LineEvidence {
  if (line.uncommitted && ctx.generatedBy !== undefined && ctx.generatedBy !== "") {
    return { machine: ctx.generatedBy, rule: 1, sha: line.sha };
  }
  return recordedEvidence(line, ctx);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** One derived range: its entry, its body lines, and its first line's evidence. */
export interface DerivedRange {
  entry: ProvenanceEntry;
  span: PageLines;
  evidence: LineEvidence;
}

/** A page's derivation: the page, each body line's evidence, and the ranges. */
export interface ProvenanceDerivation {
  page: ProvenancePage;
  evidenceByLine: ReadonlyMap<number, LineEvidence>;
  derived: DerivedRange[];
}

export interface DeriveProvenanceInput {
  /** The page's working text. */
  content: string;
  blame: readonly BlameLine[];
  commits: ReadonlyMap<string, CommitEvidence>;
  /** `derive.machines`; `DEFAULT_MACHINES` when absent. */
  machines?: readonly string[];
  generatedBy?: string;
  fenced?: boolean;
}

/** The pin of a span known to lie inside `lines`. */
function pinOf(lines: readonly string[], span: PageLines): string {
  const pin = pinOfLines(lines, span);
  if (pin === undefined) throw new Error(`provenance: lines ${spellLines(span)} fall outside the body`);
  return pin;
}

function contextOf(input: Omit<DeriveProvenanceInput, "content" | "blame">): EvidenceContext {
  return {
    commits: input.commits,
    machines: input.machines ?? DEFAULT_MACHINES,
    ...(input.generatedBy !== undefined ? { generatedBy: input.generatedBy } : {}),
    ...(input.fenced !== undefined ? { fenced: input.fenced } : {}),
  };
}

function readOptions(fenced: boolean | undefined): ReadPageOptions | undefined {
  return fenced === undefined ? undefined : { fenced };
}

/**
 * Derive a page's `provenance`: resolve every body line, then group
 * contiguous lines resolved to one machine into one entry, pinned over the
 * current body.
 */
export function deriveProvenance(input: DeriveProvenanceInput): ProvenanceDerivation {
  const page = readProvenancePage(input.content, readOptions(input.fenced));
  const ctx = contextOf(input);
  const evidenceByLine = new Map<number, LineEvidence>();
  for (const line of input.blame) {
    const body = line.finalLine - page.bodyLine + 1;
    if (body < 1) continue; // a frontmatter line
    evidenceByLine.set(body, resolveLineEvidence(line, ctx));
  }
  const groups: { machine: string; start: number; end: number; first: LineEvidence }[] = [];
  let open: (typeof groups)[number] | undefined;
  for (let n = 1; n <= page.body.length; n++) {
    const evidence = evidenceByLine.get(n);
    const machine = evidence?.machine;
    if (open !== undefined && machine === open.machine && n === open.end + 1) {
      open.end = n;
      continue;
    }
    if (open !== undefined) groups.push(open);
    open = machine === undefined || evidence === undefined ? undefined : { machine, start: n, end: n, first: evidence };
  }
  if (open !== undefined) groups.push(open);
  return {
    page,
    evidenceByLine,
    derived: groups.map((g) => {
      const span = { start: g.start, end: g.end };
      return {
        entry: { "generated-by": g.machine, lines: lineSpec(span), integrity: pinOf(page.body, span) },
        span,
        evidence: g.first,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** 0046's comparison verdicts. */
export type ProvenanceStatus = "current" | "moved" | "changed" | "stale" | "unset";

/**
 * One range's verdict. `entry` is the stamped entry, or the derived one for
 * `unset`. `span` is where its text is now in body lines, and the recorded
 * lines for `changed`. `evidence` is the contradicting line's for `stale` and
 * the range's first line's for `unset`. `noEvidence` marks a current or moved
 * range no line of which names a machine.
 */
export interface ProvenanceComparison {
  status: ProvenanceStatus;
  entry: ProvenanceEntry;
  span: PageLines;
  evidence?: LineEvidence;
  noEvidence?: true;
}

/**
 * The candidate nearest the recorded lines (stress test 12): distance is
 * between start lines, and an equal distance goes to the earlier candidate.
 */
function nearest<T extends { span: PageLines }>(candidates: readonly T[], recorded: PageLines): T | undefined {
  let best: { c: T; d: number } | undefined;
  for (const c of candidates) {
    const d = Math.abs(c.span.start - recorded.start);
    if (best === undefined || d < best.d || (d === best.d && c.span.start < best.c.span.start)) best = { c, d };
  }
  return best?.c;
}

const sameSpan = (a: PageLines, b: PageLines): boolean => a.start === b.start && a.end === b.end;

/**
 * Compare a page's stamped entries with a fresh derivation: one result per
 * well-formed stamped entry, in order, then one `unset` per derived range
 * nothing covers.
 *
 * By integrity first: an unclaimed derived range with the stamp's pin,
 * nearest by lines. The same machine is current at the recorded lines and
 * moved elsewhere; another machine is stale. Each derived range is taken once.
 *
 * Otherwise the pin is searched for across the whole body, nearest window
 * first. Found nowhere, it is changed. Found, it is stale when a line of the
 * window names a different machine, and current or moved otherwise: lines
 * that name the stamp's machine or no machine are not a contradiction.
 *
 * A derived range is unset when some line of it lies outside every span a
 * result above holds, which for a changed entry is its recorded lines. A
 * person's edit inside an agent's range is therefore one changed finding,
 * not a changed finding and two unset ones.
 */
export function compareProvenance(
  stamped: readonly ProvenanceEntry[],
  derivation: ProvenanceDerivation,
): ProvenanceComparison[] {
  const { page, evidenceByLine, derived } = derivation;
  const claimed = new Set<DerivedRange>();
  const results: ProvenanceComparison[] = [];
  for (const entry of provenanceEntries(stamped)) {
    const recorded = parseLines(entry.lines);
    if (recorded === undefined) continue; // unreachable: provenanceEntries checked it
    const machine = entry["generated-by"];
    const pool = derived.filter((d) => !claimed.has(d) && d.entry.integrity === entry.integrity);
    const hit = nearest(pool, recorded);
    if (hit !== undefined) {
      claimed.add(hit);
      if (hit.entry["generated-by"] !== machine) {
        results.push({ status: "stale", entry, span: hit.span, evidence: hit.evidence });
      } else {
        results.push({ status: sameSpan(hit.span, recorded) ? "current" : "moved", entry, span: hit.span });
      }
      continue;
    }

    const width = recorded.end - recorded.start + 1;
    const claimedSpans = [...claimed].map((d) => d.span);
    const windows = findWindows(page.body, width, entry.integrity, undefined, { around: recorded.start })
      .starts.map((start) => ({ span: { start, end: start + width - 1 } }))
      .filter((w) => !claimedSpans.some((s) => sameSpan(s, w.span)));
    const found = nearest(windows, recorded);
    if (found === undefined) {
      results.push({ status: "changed", entry, span: recorded });
      continue;
    }
    let contradiction: LineEvidence | undefined;
    let anyMachine = false;
    for (let n = found.span.start; n <= found.span.end; n++) {
      const evidence = evidenceByLine.get(n);
      if (evidence?.machine === undefined) continue;
      anyMachine = true;
      if (evidence.machine !== machine) {
        contradiction = evidence;
        break;
      }
    }
    if (contradiction !== undefined) {
      results.push({ status: "stale", entry, span: found.span, evidence: contradiction });
      continue;
    }
    results.push({
      status: sameSpan(found.span, recorded) ? "current" : "moved",
      entry,
      span: found.span,
      ...(anyMachine ? {} : { noEvidence: true as const }),
    });
  }

  const covering = results.map((r) => r.span);
  for (const d of derived) {
    if (claimed.has(d)) continue;
    let uncovered = false;
    for (let n = d.span.start; n <= d.span.end && !uncovered; n++) {
      uncovered = !covering.some((s) => n >= s.start && n <= s.end);
    }
    if (uncovered) results.push({ status: "unset", entry: d.entry, span: d.span, evidence: d.evidence });
  }
  return results;
}

/**
 * The `provenance` value `derive` writes. Current entries stay as they are,
 * moved entries stay with `lines` rewritten, and every derived range not
 * already kept is added, which re-derives changed and stale entries and adds
 * unset ones. A changed entry no machine now answers for is dropped (stress
 * test 11: the bytes are gone); an entry nothing contradicts never is. Ordered
 * by start line, stably.
 */
export function planProvenanceWrite(
  comparisons: readonly ProvenanceComparison[],
  derivation: ProvenanceDerivation,
): ProvenanceEntry[] {
  const kept: { entry: ProvenanceEntry; start: number }[] = [];
  for (const r of comparisons) {
    if (r.status === "current") kept.push({ entry: r.entry, start: r.span.start });
    else if (r.status === "moved") {
      kept.push({
        entry: { "generated-by": r.entry["generated-by"], lines: lineSpec(r.span), integrity: r.entry.integrity },
        start: r.span.start,
      });
    }
  }
  const same = (a: ProvenanceEntry, b: ProvenanceEntry): boolean =>
    a["generated-by"] === b["generated-by"] && String(a.lines) === String(b.lines) && a.integrity === b.integrity;
  const out = [...kept];
  for (const d of derivation.derived) {
    if (!kept.some((k) => same(k.entry, d.entry))) out.push({ entry: d.entry, start: d.span.start });
  }
  return out.sort((a, b) => a.start - b.start).map((k) => k.entry);
}

// ---------------------------------------------------------------------------
// Output: the JSON ranges, findings, and get's value
// ---------------------------------------------------------------------------

/** One range of `DerivedField.ranges`, in file lines. */
export interface RangeResult {
  lines: string;
  "generated-by": string;
  integrity: string;
  status: ProvenanceStatus;
  /** `uncommitted`, `blame <sha7>`, or `pin` when only the pin speaks for the range. */
  evidence: string;
  /** What the record said before: on `moved` and `stale` only. */
  from?: { lines: string; "generated-by": string };
  /** Whether `derive` wrote this range; always false until it does. */
  written: boolean;
}

const short = (sha: string): string => sha.slice(0, 7);

/** File lines as a report spells them. */
function fileSpelling(span: PageLines, bodyLine: number): string {
  return spellLines(toFileLines(span, bodyLine));
}

function evidenceText(evidence: LineEvidence | undefined): string {
  if (evidence?.machine === undefined) return "pin";
  return evidence.rule === 1 ? "uncommitted" : `blame ${short(evidence.sha)}`;
}

/** Where a finding says the evidence came from: the short sha, or `uncommitted`. */
function evidenceRef(evidence: LineEvidence | undefined): string {
  if (evidence === undefined) return "no evidence";
  return evidence.rule === 1 ? "uncommitted" : short(evidence.sha);
}

/** The comparisons as `DerivedField.ranges` reports them. `bodyLine` is the page's. */
export function rangeResults(comparisons: readonly ProvenanceComparison[], bodyLine: number): RangeResult[] {
  return comparisons.map((r) => {
    const lines = fileSpelling(r.span, bodyLine);
    const recorded = parseLines(r.entry.lines);
    const from = recorded === undefined ? undefined : fileSpelling(recorded, bodyLine);
    const machine = r.entry["generated-by"];
    switch (r.status) {
      case "stale":
        return {
          lines,
          "generated-by": r.evidence?.machine ?? machine,
          integrity: r.entry.integrity,
          status: r.status,
          evidence: evidenceText(r.evidence),
          ...(from !== undefined ? { from: { lines: from, "generated-by": machine } } : {}),
          written: false,
        };
      case "moved":
        return {
          lines,
          "generated-by": machine,
          integrity: r.entry.integrity,
          status: r.status,
          evidence: "pin",
          ...(from !== undefined ? { from: { lines: from, "generated-by": machine } } : {}),
          written: false,
        };
      case "unset":
        return { lines, "generated-by": machine, integrity: r.entry.integrity, status: r.status, evidence: evidenceText(r.evidence), written: false };
      case "current":
      case "changed":
        return { lines, "generated-by": machine, integrity: r.entry.integrity, status: r.status, evidence: "pin", written: false };
    }
  });
}

/**
 * The findings `validate` and `derive --check` file for a page's provenance:
 * one per changed, stale or unset range, in 0046's words. `line` is the
 * range's file line on the page, and `subject` carries the pin (the recorded
 * one for changed and stale, the derived one for unset), so a baseline that
 * forgives one range does not forgive the rest.
 */
export function provenanceFindings(comparisons: readonly ProvenanceComparison[], bodyLine: number): FieldError[] {
  const findings: FieldError[] = [];
  for (const r of comparisons) {
    const machine = r.entry["generated-by"];
    const lines = fileSpelling(r.span, bodyLine);
    let message: string;
    switch (r.status) {
      case "changed":
        message = `provenance lines ${lines} changed since ${machine} wrote them`;
        break;
      case "stale":
        message = `provenance lines ${lines} say ${machine}; blame says ${r.evidence?.machine ?? "another machine"} (${evidenceRef(r.evidence)})`;
        break;
      case "unset":
        message = `provenance is unset for lines ${lines}; blame says ${machine} (${evidenceRef(r.evidence)})`;
        break;
      case "current":
      case "moved":
        continue;
    }
    findings.push({
      schema: DERIVED_STALE_SCHEMA,
      keyword: DERIVED_KEYWORD,
      subject: `provenance ${r.entry.integrity}`,
      instancePath: PROVENANCE_POINTER,
      message: `${message} — run manni meta derive`,
      line: toFileLines(r.span, bodyLine).start,
    });
  }
  return findings;
}

/** `get`'s value: `lines 12-31 claude-fable-5; lines 44 claude-sonnet-5`, in file lines. */
export function renderProvenanceValue(entries: readonly ProvenanceEntry[], bodyLine: number): string {
  return entries
    .map((e) => {
      const span = parseLines(e.lines);
      const lines = span === undefined ? String(e.lines) : fileSpelling(span, bodyLine);
      return `lines ${lines} ${e["generated-by"]}`;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// Ranged attribution: `manni meta derive <path>:L1-L2 --generated-by <name>`
// ---------------------------------------------------------------------------

/**
 * Split `<path>:L` or `<path>:L1-L2` as `cite add` splits a page argument:
 * the last `:L` suffix, so a drive letter is not a range. A range that ends
 * before it starts is refused in 0046's words.
 */
export function parseProvenanceTarget(arg: string): { page: string; lines?: PageLines } {
  try {
    return splitPageArgument(arg);
  } catch (err) {
    if (err instanceof LineRangeError) throw new DocmetaError(`${arg} ends before it starts.`);
    throw err;
  }
}

export interface AttributeRangeInput {
  /** The positional as typed, `<path>:L` or `<path>:L1-L2`, in file lines. */
  target: string;
  content: string;
  blame: readonly BlameLine[];
  commits: ReadonlyMap<string, CommitEvidence>;
  machines?: readonly string[];
  generatedBy: string;
  fenced?: boolean;
}

/**
 * The entry a named range writes. Committed or not, its lines go to
 * `generatedBy`, unless rules 2 to 4 name a different machine for any of
 * them: the first such line in file order is named in the refusal. Evidence
 * that names the same machine, or none, lets the range through. Every
 * refusal is a `DocmetaError` (exit 2) in 0046's words.
 */
export function attributeRange(input: AttributeRangeInput): ProvenanceEntry {
  const { target } = input;
  const { page: path, lines: range } = parseProvenanceTarget(target);
  if (range === undefined) throw new Error(`provenance: ${target} names no lines`);
  const page = readProvenancePage(input.content, readOptions(input.fenced));
  if (range.end > page.lines.length) {
    throw new DocmetaError(
      `${path} has no lines ${spellLines(range)}: the file ends at line ${page.lines.length}.`,
    );
  }
  if (range.start < page.bodyLine) {
    throw new DocmetaError(
      `${target} reaches into the frontmatter; provenance pins body lines, which start at line ${page.bodyLine}.`,
    );
  }
  const ctx = contextOf(input);
  for (const line of input.blame) {
    if (line.finalLine < range.start || line.finalLine > range.end) continue;
    const evidence = recordedEvidence(line, ctx);
    if (evidence.machine !== undefined && evidence.machine !== input.generatedBy) {
      throw new DocmetaError(
        `${target}: blame attributes these lines to ${evidence.machine} (${short(evidence.sha)}); --generated-by cannot overrule a recorded machine.`,
      );
    }
  }
  const span = toBodyLines(range, page.bodyLine);
  return { "generated-by": input.generatedBy, lines: lineSpec(span), integrity: pinOf(page.body, span) };
}
