/**
 * `manni cite update`: repair what moved; with `--accept`, re-pin what changed.
 *
 * A moved end gets its `lines` spliced where it stands, so comments and
 * quoting are untouched: `claim.lines` for a claim found verbatim elsewhere on
 * the page, `source.lines` for a source found elsewhere in its file. A marker
 * never moves, because it travels with its own text.
 *
 * `--accept` re-pins a changed end. A claim is re-pinned over the paragraph or
 * fenced block now at its first line, and the report prints that text, so the
 * log shows exactly what was accepted; a claim whose line is blank, or now a
 * different kind of block, is skipped, and a sentence that was reworded *and*
 * moved is an `add` again. A source is re-minted at HEAD, with a new
 * `commit-sha` where the entry records one.
 *
 * Every finding the run did not resolve is reported as skipped, and an
 * error-severity one is work left undone: exit 1, as `fill` has it. Writes by
 * default (0025).
 */
import { resolve } from "node:path";
import { writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL } from "../../meta/internal.js";
import { checkCitations } from "../core/check-page.js";
import {
  claimLine,
  markerUnit,
  normalizeWhitespace,
  pinOfLines,
  toBodyLines,
  unitAt,
  type ClaimUnit,
} from "../core/claims.js";
import { GIT_UNAVAILABLE_COMMIT } from "../core/git.js";
import { splitLines } from "../core/hash.js";
import { mintCitation } from "../core/mint.js";
import { ManifestSet } from "../core/manifest.js";
import { readPage } from "../core/page.js";
import { lineSpec, parseLines } from "../core/range.js";
import { spliceEntryField, unifiedDiff } from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationResult,
  LineSpec,
  ManifestChange,
  PageCitation,
  PageCitationReport,
  PageCitations,
  UpdateOptions,
  UpdatePage,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";
import {
  assertNoOrphanJoins,
  assertNoOrphans,
  joinHits,
  prepareRun,
  readTarget,
  sayNotices,
} from "./check.js";

type Plan =
  | { kind: "claim-moved"; result: CitationResult; lines: LineSpec; from: string; to: string }
  | { kind: "source-moved"; result: CitationResult; lines: LineSpec; to: string }
  | { kind: "claim-accepted"; result: CitationResult; unit: ClaimUnit; pin: string; lines?: LineSpec }
  | { kind: "source-accepted"; result: CitationResult; minted: Citation };

/** The rule a plan settles, so its finding is not also reported as skipped. */
function settles(plan: Plan): string {
  switch (plan.kind) {
    case "claim-moved":
      return "claim-moved";
    case "source-moved":
      return "source-moved";
    case "claim-accepted":
      return "claim-changed";
    case "source-accepted":
      return plan.result.source.status === "never-true" ? "source-never-true" : "source-changed";
  }
}

function apply(content: string, format: string, plan: Plan): string {
  const index = plan.result.origin.index;
  switch (plan.kind) {
    case "claim-moved":
      return spliceEntryField(content, format, index, ["claim", "lines"], plan.lines);
    case "source-moved":
      return spliceEntryField(content, format, index, ["source", "lines"], plan.lines);
    case "claim-accepted": {
      let out = spliceEntryField(content, format, index, ["claim", "integrity"], plan.pin);
      if (plan.lines !== undefined) {
        out = spliceEntryField(out, format, index, ["claim", "lines"], plan.lines);
      }
      return out;
    }
    case "source-accepted": {
      let out = spliceEntryField(
        content,
        format,
        index,
        ["source", "integrity"],
        plan.minted.source.integrity,
      );
      const commit = plan.minted.source["commit-sha"];
      // An entry with no `commit-sha:` line of its own keeps none: the splice
      // replaces a scalar, it does not add a key.
      if (commit !== undefined) {
        out = spliceEntryField(out, format, index, ["source", "commit-sha"], commit);
      }
      return out;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The same repair, against an entry that lives in a manifest. The page's
 * whole `citations` value is written back at the end of the run, so a repair
 * here is an edit to the parsed entry rather than a splice of one scalar.
 * An entry the writer cannot reach — a list item that is not a mapping —
 * leaves its finding reported.
 */
function applyToEntry(entry: unknown, plan: Plan): boolean {
  if (!isRecord(entry)) return false;
  const end = (name: "claim" | "source"): Record<string, unknown> | undefined =>
    isRecord(entry[name]) ? entry[name] : undefined;
  switch (plan.kind) {
    case "claim-moved": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.lines = plan.lines;
      return true;
    }
    case "source-moved": {
      const source = end("source");
      if (source === undefined) return false;
      source.lines = plan.lines;
      return true;
    }
    case "claim-accepted": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.integrity = plan.pin;
      if (plan.lines !== undefined) claim.lines = plan.lines;
      return true;
    }
    case "source-accepted": {
      const source = end("source");
      if (source === undefined) return false;
      source.integrity = plan.minted.source.integrity;
      const commit = plan.minted.source["commit-sha"];
      // As on a page: a re-mint records a commit only where the entry
      // already recorded one, so this never adds the key.
      if (commit !== undefined) source["commit-sha"] = commit;
      return true;
    }
  }
}

function rewriteOf(plan: Plan): UpdateRewrite {
  const { citation, origin, source } = plan.result;
  const base: Pick<UpdateRewrite, "id" | "index" | "line"> = { index: origin.index };
  if (citation.id !== undefined) base.id = citation.id;
  if (origin.line !== undefined) base.line = origin.line;

  switch (plan.kind) {
    case "claim-moved":
      return { ...base, end: "claim", reason: "moved", status: "moved", from: plan.from, to: plan.to };
    case "source-moved":
      return {
        ...base,
        end: "source",
        reason: "moved",
        status: "moved",
        from: source.src,
        to: plan.to,
      };
    case "claim-accepted": {
      const out: UpdateRewrite = {
        ...base,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: citation.claim?.integrity ?? "",
        to: plan.pin,
        at: plan.unit.lines.start,
        text: normalizeWhitespace(plan.unit.text.join("\n")),
      };
      return out;
    }
    case "source-accepted": {
      const out: UpdateRewrite = {
        ...base,
        end: "source",
        reason: "accepted",
        status: source.status === "never-true" ? "never-true" : "changed",
        from: citation.source.integrity,
        to: plan.minted.source.integrity,
        src: source.src,
      };
      const commit = plan.minted.source["commit-sha"];
      if (commit !== undefined) out.commitSha = commit;
      return out;
    }
  }
}

export async function runUpdate(opts: UpdateOptions): Promise<UpdateRun> {
  const prepared = await prepareRun(opts, "updated", "update", true);
  const { run, files, usingStdin, forced, pageOptions, git } = prepared;
  assertNoOrphans(prepared);
  const hits = joinHits();
  // Each manifest is read once and written once, however many of its pages
  // the run repairs.
  const manifests = new ManifestSet();
  const only = opts.only !== undefined && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const accept = opts.accept === true;

  /** What this citation needs, in the order the repairs are worth trying. */
  const plansFor = async (
    result: CitationResult,
    entry: PageCitation | undefined,
    page: PageCitations,
    lines: readonly string[],
  ): Promise<Plan[]> => {
    const out: Plan[] = [];
    const claim = result.claim;
    if (claim !== null && claim.status === "moved" && claim.newLines !== undefined) {
      const at = parseLines(claim.newLines);
      if (at !== undefined) {
        out.push({
          kind: "claim-moved",
          result,
          lines: lineSpec(at),
          from: claim.fileLines ?? "",
          to: claim.newFileLines ?? "",
        });
      }
    }
    if (result.source.status === "moved" && result.source.newLines !== undefined) {
      const at = parseLines(result.source.newLines);
      if (at !== undefined && result.source.newSrc !== undefined) {
        out.push({ kind: "source-moved", result, lines: lineSpec(at), to: result.source.newSrc });
      }
    }
    if (!accept) return out;

    if (claim !== null && claim.status === "changed" && entry !== undefined) {
      // The paragraph or block now at the claim's first line, or what the
      // marker anchors. Anything else is left for a fresh `cite add`.
      const unit =
        result.anchor === "marker"
          ? markerUnit(page, entry, lines)
          : ((): ClaimUnit | undefined => {
              const at = claimLine(claim);
              return at === undefined ? undefined : unitAt(page, at, lines);
            })();
      const wantsBlock = entry.citation.quote === true;
      const pin = unit === undefined ? undefined : pinOfLines(lines, unit.lines);
      if (unit !== undefined && pin !== undefined && (!wantsBlock || unit.kind === "block")) {
        const plan: Plan = { kind: "claim-accepted", result, unit, pin };
        // A paragraph that grew or shrank moves the claim's last line too.
        if (entry.citation.claim?.lines !== undefined) {
          const body = toBodyLines(unit.lines, page.bodyLine);
          const recorded = parseLines(entry.citation.claim.lines);
          if (recorded === undefined || recorded.start !== body.start || recorded.end !== body.end) {
            plan.lines = lineSpec(body);
          }
        }
        out.push(plan);
      }
    }
    if (result.source.status === "changed" || result.source.status === "never-true") {
      try {
        // The source as the entry spells it: an encrypted one stays encrypted,
        // under the key it decrypted with, and mint keys the pin accordingly.
        // HEAD is recorded only where the entry already records a commit.
        const minted = await mintCitation({
          root: run.root,
          src: result.source.src,
          ...(run.key === undefined ? {} : { key: run.key }),
          ...(result.citation.source["commit-sha"] === undefined
            ? { commitSha: false as const }
            : {}),
          gitClient: git,
          ...(pageOptions.sourceIndex === undefined
            ? {}
            : { sourceIndex: pageOptions.sourceIndex }),
        });
        out.push({ kind: "source-accepted", result, minted });
      } catch (error) {
        // A range the file no longer reaches cannot be re-minted; its finding stays reported.
        if (!(error instanceof CiteError)) throw error;
      }
    }
    return out;
  };

  const pages: UpdatePage[] = [];
  const updateOne = async (
    label: string,
    content: string,
    path?: string,
  ): Promise<PageCitationReport> => {
    const setup = prepared.setupFor(label, content);
    if (setup.sidecar !== undefined) hits.record(setup.sidecar, label);
    const report = await checkCitations({ file: label, content, format: forced?.name }, setup.options);
    const { format } = report;
    const page = readPage(label, content, {
      ...(forced === undefined ? {} : { format: forced.name }),
      ...(setup.options.citations === undefined ? {} : { citations: setup.options.citations }),
      ...(setup.options.owned === undefined ? {} : { owned: setup.options.owned }),
    });
    const lines = splitLines(content);
    const rewritten: UpdateRewrite[] = [];
    /** `<index>\0<rule>` of every finding a rewrite settled. */
    const settled = new Set<string>();
    let after = content;
    // The manifest's entries for this page, edited in memory and written
    // back as one value once the page is done.
    const owner = setup.sidecar?.owner;
    const entries: unknown[] | undefined =
      setup.sidecar?.citations === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(setup.sidecar.citations.map((c) => c.entry))) as unknown[]);
    let manifestDirty = false;
    for (const result of report.citations) {
      if (only !== undefined && (result.citation.id === undefined || !only.has(result.citation.id))) {
        continue;
      }
      const entry = page.citations.find((c) => c.origin.index === result.origin.index);
      for (const plan of await plansFor(result, entry, page, lines)) {
        if (result.origin.kind === "manifest") {
          if (entries === undefined || !applyToEntry(entries[result.origin.index], plan)) continue;
          manifestDirty = true;
        } else {
          after = apply(after, format, plan);
        }
        rewritten.push(rewriteOf(plan));
        settled.add(`${String(result.origin.index)}\0${settles(plan)}`);
      }
    }
    if (manifestDirty && owner !== undefined && entries !== undefined) {
      if (setup.sidecar?.entry === undefined) {
        throw new CiteError(
          `${label} carries no ${owner.join}: value, so its citations cannot be keyed in ${owner.file}.`,
        );
      }
      await manifests.write(owner, setup.sidecar.entry, entries, 0);
    }
    const skipped = report.findings.filter(
      (finding) =>
        (only === undefined || (finding.id !== undefined && only.has(finding.id))) &&
        !settled.has(`${String(finding.index ?? -1)}\0${finding.rule}`),
    );
    const diff = after === content ? "" : unifiedDiff(label, content, after);
    const written = after !== content && path !== undefined && opts.dryRun !== true;
    if (written) await writeFileAtomic(path, after);
    const out: UpdatePage = { file: label, rewritten, skipped, diff, written };
    // The stdin page has nowhere to be written; the caller prints it instead.
    if (path === undefined) out.content = after;
    pages.push(out);
    return report;
  };

  const reports: PageCitationReport[] = [];
  if (usingStdin) reports.push(await updateOne(STDIN_LABEL, opts.stdinContent ?? ""));
  for (const file of files) {
    reports.push(await updateOne(file, await readTarget(run, file), resolve(run.base, file)));
  }
  assertNoOrphanJoins(prepared, hits);

  // One write per manifest, after every page that touches it is settled.
  const changedManifests = manifests.changed();
  const rewrittenManifests: ManifestChange[] = [];
  for (const changed of changedManifests) {
    const write = opts.dryRun !== true;
    if (write) await writeFileAtomic(changed.path, changed.text);
    rewrittenManifests.push({ file: changed.file, diff: changed.diff, written: write });
  }
  // A re-mint records HEAD when git has one. Where git is not there the entry
  // is re-pinned without a commit, and the run says so once.
  const reminted = pages.some((page) =>
    page.rewritten.some((r) => r.reason === "accepted" && r.end === "source"),
  );
  sayNotices(reports, opts.onNotice, reminted && !(await git.available()) ? [GIT_UNAVAILABLE_COMMIT] : []);

  const rewritten = pages.reduce((n, page) => n + page.rewritten.length, 0);
  const skipped = pages.reduce((n, page) => n + page.skipped.length, 0);
  const undone = pages.some((page) => page.skipped.some((finding) => finding.severity === "error"));
  return {
    pages,
    rewritten,
    skipped,
    ...(rewrittenManifests.length > 0 ? { manifests: rewrittenManifests } : {}),
    exitCode: undone ? 1 : 0,
  };
}
