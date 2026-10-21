/**
 * Findings, their messages, and the bridge to meta's `ValidationResult`, so
 * the github/sarif/junit reporters and the baseline ratchet work unchanged.
 *
 * A claim or marker finding sits on the page line a reviewer reads. A finding
 * about the entry itself, `entry-invalid` or a bare pin whose source changed,
 * sits on the entry's own line, in the manifest when one owns it.
 *
 * FieldError: schema "manni:cite" (matches BUILTIN_ID, so canonicalSchemaRef
 * leaves it alone), keyword = rule, instancePath "/citations/N", subject =
 * id ?? source.integrity, never the claim's pin, so accepting a claim does
 * not reopen baselined findings. `ok` is true iff no error-severity finding.
 *
 * Every message spells the source as the entry spelled it. `resolvedPath`,
 * `commitsSince` and `diff` never enter a message: they are pretty-only
 * fields, shown under `--reveal` and `--show-diff`.
 */
import { isAbsolute } from "node:path";
import { isErrorSeverity, type FieldError, type ValidationResult } from "../../meta/index.js";
import type {
  CitationFinding,
  CitationResult,
  CiteRule,
  CiteSeverity,
  ClaimEnd,
  PageCitationReport,
  SourceEnd,
  SourceStatus,
} from "../types.js";
import { claimLine } from "./claims.js";
import { parseSrc } from "./range.js";
import { RULE_ID_PREFIX, ruleId } from "./severity.js";
import { listOf, shortSrc } from "./spell.js";

/** The seven characters a person reads a commit by. */
function short(commit: string): string {
  return commit.slice(0, 7);
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** Whether the entry spelled this source encrypted. */
function citesEncrypted(src: string): boolean {
  try {
    return parseSrc(src).encrypted;
  } catch {
    return false;
  }
}

/**
 * The file half of a source as the entry spelled it: a plain path in full, a
 * ciphertext abbreviated, so no message names an encrypted path.
 */
function sourceFile(src: string): string {
  try {
    const { path } = parseSrc(src);
    return shortSrc(path);
  } catch {
    return shortSrc(src);
  }
}

/**
 * Why an encrypted source is missing, in words that never name the path. A
 * plain path names its own file, so the bare status says the rest.
 */
function missingMessage(source: SourceEnd): string {
  if (!citesEncrypted(source.src)) return "missing";
  switch (source.missingReason) {
    case "no-key":
      return "missing (no encryption key is available to decrypt it)";
    case "undecryptable":
      return "missing (does not decrypt under the current key)";
    case "untracked":
      return "missing (no tracked file matches; wrong --root?)";
    case "unreadable":
    case undefined:
      return "missing";
  }
}

/** The one place a source end's message is composed, per status. */
export function messageFor(source: SourceEnd): string {
  switch (source.status) {
    case "current":
      return "current";
    case "skipped":
      return "skipped";
    case "moved":
      // An encrypted source's new path is a ciphertext, abbreviated as the
      // entry's own is: `--reveal` stays the only way to read either.
      return `moved -> ${shortSrc(source.newSrc ?? "?")}`;
    case "moved-ambiguous": {
      const candidates = source.candidates ?? [];
      return `moved, ${plural(candidates.length, "candidate")} (${candidates.map(shortSrc).join(", ")})`;
    }
    case "changed": {
      // Where the old first and last line sit now, when the in-range search
      // found each exactly once: the span `update --accept` re-mints at.
      const span = source.newLines === undefined ? "" : `; now at lines ${source.newLines}`;
      if (source.historyAvailable === false) return "changed (history unavailable; fetch-depth: 0)";
      // The derived baseline when history found one (0097). Without git
      // there is none, and the recorded commit is all the entry says.
      const since = source.baselineSha ?? source.commitSha;
      if (since === undefined) return `changed${span}`;
      const at = short(since);
      if (source.commitsSince === undefined) return `changed since ${at}${span}`;
      return `changed since ${at}, ${plural(source.commitsSince.length, "commit")}${span}`;
    }
    case "never-true":
      return `never true: the pin held at no commit in the history of ${sourceFile(source.src)}`;
    case "missing":
      return missingMessage(source);
  }
}

/** `<id>: <text>`, or the text alone for an entry with no id. */
function named(id: string | undefined, text: string): string {
  return id === undefined ? text : `${id}: ${text}`;
}

/** `line 9`, or `lines 9-10` when the claim covers several. */
function at(spec: string): string {
  return spec.includes("-") ? `lines ${spec}` : `line ${spec}`;
}

/** The one place a claim end's message is composed, per status. */
export function claimMessageFor(result: CitationResult): string {
  const claim = result.claim;
  const id = result.citation.id;
  if (claim === null) return "";
  // A marker-anchored claim has no lines of its own; it is judged where the
  // marker's text sits, and that is what the message names.
  const where =
    claim.fileLines ??
    (result.markerLine === undefined ? undefined : String(result.markerLine));
  switch (claim.status) {
    case "moved":
      return named(
        id,
        `the claim moved from ${at(where ?? "?")} to ${at(claim.newFileLines ?? "?")}.`,
      );
    case "moved-ambiguous":
      return named(
        id,
        `the claim at ${at(where ?? "?")} now appears at lines ${listOf(claim.candidateFileLines ?? [])}.`,
      );
    case "reanchored": {
      const since = claim.commitSha === undefined ? "" : ` since ${short(claim.commitSha)}`;
      // A claim-lines entry moved onto its new run; a marker-anchored one
      // never moves, because the marker travels with its own text.
      const to =
        claim.newFileLines === undefined ? "" : `, to ${at(claim.newFileLines)}`;
      return named(
        id,
        `the claim at ${at(where ?? "?")} was reanchored${since}${to}. Its words are unchanged.`,
      );
    }
    case "changed":
      if (where === undefined) {
        return named(
          id,
          "the claim has no lines and no marker names the entry, so its pin anchors nothing.",
        );
      }
      return named(id, `the claim at ${at(where)} has ${claimChange(claim)}`);
    case "current":
    case "skipped":
      return "";
  }
}

/** How a changed claim says since when, which is what its history could say. */
function claimChange(claim: ClaimEnd): string {
  if (claim.historyAvailable === false) {
    return "changed since it was pinned (history unavailable; fetch-depth: 0).";
  }
  if (claim.commitSha === undefined) return "changed since it was pinned.";
  const at = short(claim.commitSha);
  // Zero commits since would read as "just now". The working tree holding the
  // change is what it actually means, so it says that.
  const since = claim.commitsSince ?? [];
  const count = since.length === 0 ? "uncommitted" : plural(since.length, "commit");
  return `changed since ${at}, ${count}.`;
}

/**
 * The one place a `marker-misplaced` message is composed. A quote marker's
 * place is above the block it anchors; every other marker's is the first line
 * of the paragraph its run splits.
 */
export function misplacedMessageFor(
  id: string | undefined,
  marker: { line: number; unit: string; place: number; block: boolean },
): string {
  const place = marker.block
    ? `above the block at line ${String(marker.place)}`
    : `above line ${String(marker.place)}`;
  return named(
    id,
    `the marker at line ${String(marker.line)} splits the paragraph at ${at(marker.unit)}. Its place is ${place}.`,
  );
}

/** The rule a source status reports under, or undefined for one that is not a finding. */
function sourceRuleOf(status: SourceStatus): CiteRule | undefined {
  if (status === "skipped" || status === "current") return undefined;
  return `source-${status}`;
}

/** The rule a claim status reports under, or undefined. */
function claimRuleOf(claim: ClaimEnd): CiteRule | undefined {
  const status = claim.status;
  if (status === "skipped" || status === "current") return undefined;
  return `claim-${status}`;
}

/** Where a finding about a whole entry sits: its own line, in its own file. */
function entrySite(result: CitationResult): Pick<CitationFinding, "line" | "file"> {
  const site: Pick<CitationFinding, "line" | "file"> = {};
  if (result.origin.line !== undefined) site.line = result.origin.line;
  if (result.origin.kind === "manifest") site.file = result.origin.file;
  return site;
}

/** Where a finding about an anchored citation sits: the page line it anchors to. */
function anchorSite(result: CitationResult): Pick<CitationFinding, "line" | "file"> {
  if (result.anchorLine !== undefined) return { line: result.anchorLine };
  return entrySite(result);
}

/** Findings for classified citations under a severity table; `off` rules produce none. */
export function findingsFor(
  results: readonly CitationResult[],
  severity: Readonly<Record<CiteRule, CiteSeverity>>,
): CitationFinding[] {
  const out: CitationFinding[] = [];
  const push = (
    result: CitationResult,
    rule: CiteRule,
    message: string,
    site: Pick<CitationFinding, "line" | "file">,
    extra?: Pick<CitationFinding, "newSrc">,
  ): void => {
    const level = severity[rule];
    if (level === "off") return;
    const finding: CitationFinding = {
      rule,
      ruleId: ruleId(rule),
      severity: level,
      message,
      src: result.source.src,
      index: result.origin.index,
    };
    if (site.line !== undefined) finding.line = site.line;
    if (site.file !== undefined) finding.file = site.file;
    if (result.citation.id !== undefined) finding.id = result.citation.id;
    if (extra?.newSrc !== undefined) finding.newSrc = extra.newSrc;
    out.push(finding);
  };

  for (const result of results) {
    const claim = result.claim;
    if (claim !== null) {
      const rule = claimRuleOf(claim);
      // A claim pin that anchors nothing has no page line to sit on.
      if (rule !== undefined) {
        const site =
          claimLine(claim) === undefined && result.markerLine === undefined
            ? entrySite(result)
            : { line: claimLine(claim) ?? result.markerLine };
        push(result, rule, withRemedy(claimMessageFor(result), remedyFor(rule, result)), site);
      }
    }
    const rule = sourceRuleOf(result.source.status);
    if (rule === undefined) continue;
    const extra =
      result.source.newSrc === undefined ? undefined : { newSrc: result.source.newSrc };
    push(
      result,
      rule,
      withRemedy(messageFor(result.source), remedyFor(rule, result)),
      anchorSite(result),
      extra,
    );
  }
  return out;
}

/**
 * The pin of the citation a finding is about, for the fingerprint subject of
 * an entry with no id. Always the source's: accepting a changed claim must
 * not reopen a baselined finding.
 */
function integrityFor(
  finding: CitationFinding,
  results: readonly CitationResult[],
): string | undefined {
  if (finding.index === undefined) return undefined;
  return results.find((r) => r.origin.index === finding.index)?.citation.source.integrity;
}

/**
 * Where a finding is located once it becomes a `FieldError`: the page, or
 * the manifest the entry sits in.
 *
 * A manifest outside the repository has no location any reporter can use —
 * SARIF drops a uri that rebases to `../…`, and a GitHub annotation on one
 * lands nowhere — so the finding falls back to the page, and its line goes
 * with the file it belonged to. Inside the tree, both travel, and `file`
 * is what every reporter reads to annotate the manifest instead.
 */
export function errorSite(
  finding: CitationFinding,
): Pick<CitationFinding, "line" | "file"> {
  if (finding.file === undefined) {
    return finding.line === undefined ? {} : { line: finding.line };
  }
  if (finding.file.startsWith("../") || isAbsolute(finding.file)) return {};
  return {
    file: finding.file,
    ...(finding.line === undefined ? {} : { line: finding.line }),
  };
}

export function toValidationResult(report: PageCitationReport): ValidationResult {
  const errors: FieldError[] = report.findings.map((finding) => {
    const error: FieldError = {
      schema: RULE_ID_PREFIX,
      instancePath: finding.index === undefined ? "" : `/citations/${String(finding.index)}`,
      message: finding.message,
      keyword: finding.rule,
      severity: finding.severity,
    };
    const subject = finding.id ?? integrityFor(finding, report.citations);
    if (subject !== undefined) error.subject = subject;
    const site = errorSite(finding);
    if (site.file !== undefined) error.file = site.file;
    if (site.line !== undefined) error.line = site.line;
    return error;
  });
  return {
    file: report.file,
    format: report.format,
    ok: !errors.some(isErrorSeverity),
    schemas: [RULE_ID_PREFIX],
    errors,
  };
}

/**
 * A message, then what to do about it. A message that ends a sentence keeps
 * its stop; a status such as `changed` gains one.
 */
export function withRemedy(message: string, remedy: string | undefined): string {
  if (remedy === undefined) return message;
  return `${message}${/[.?!]$/.test(message) ? "" : "."} ${remedy}`;
}

/** What to do about a missing source: the cause in its message decides. */
function missingRemedy(result: CitationResult): string {
  if (citesEncrypted(result.source.src)) {
    switch (result.source.missingReason) {
      case "no-key":
        return "Set MANNI_ENCRYPTION_KEY, or encryptionKey: at the top of manni.config.yaml.";
      case "undecryptable":
        return "Use the key the source was encrypted with. After a key rotation, update the secret too.";
      case "untracked":
        return "Point --root at the code checkout, or re-add the citation against the new path.";
      case "unreadable":
      case undefined:
        break;
    }
  }
  const id = result.citation.id;
  return id === undefined
    ? "Remove the entry, then add it again against the file's new path."
    : `Run manni cite remove --only ${id}, then manni cite add against the file's new path.`;
}

/**
 * What to do about an end finding, in one sentence: the command that clears
 * it, with `--only <id>` when the entry has an id. Any other finding's
 * message says what to do where it is composed, so it has none here.
 *
 * The message carries it after the status, and pretty output prints it under
 * the row, since the status column has no room for it.
 */
export function remedyFor(rule: CiteRule, result: CitationResult | undefined): string | undefined {
  if (rule === "marker-misplaced") return "Run manni cite update to move it.";
  if (result === undefined) return undefined;
  const id = result.citation.id;
  const accept = `manni cite update --accept${id === undefined ? "" : ` --only ${id}`}`;
  switch (rule) {
    case "source-moved":
    case "claim-moved":
    case "claim-reanchored":
      return "Run manni cite update.";
    case "source-moved-ambiguous":
      return `Widen source.lines until the range occurs once, then run ${accept}.`;
    case "source-changed":
    case "source-never-true":
      return `Check the sentence against the source, then run ${accept}.`;
    case "source-missing":
      return missingRemedy(result);
    case "claim-moved-ambiguous":
      return "Pin a range that occurs once, or anchor the claim with a marker.";
    case "claim-changed":
      if (result.claim?.fileLines === undefined && result.markerLine === undefined) {
        return id === undefined ? "Add claim.lines." : `Add claim.lines, or a marker that names ${id}.`;
      }
      return `Check it still matches the source, then run ${accept}.`;
    default:
      return undefined;
  }
}
