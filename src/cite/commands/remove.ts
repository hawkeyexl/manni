/**
 * `manni cite remove`: take a citation off a page.
 *
 * The inverse of `add`, and it undoes all of what `add` did. The entry goes
 * out of the page's frontmatter, or out of the manifest that owns the page's
 * citations, whichever `add` would have written to. Every marker naming it
 * goes out of the body: the id goes out of the marker list, and the whole
 * line goes when that id was the last one (proposal 0056). The claims below
 * each removed marker line move up with the text they pin, which is the
 * inverse of the shift `add --marker` performs and the same rule
 * (`shiftedEntries`). A marker that only loses a word moves nothing.
 *
 * `--only` is required, one entry per occurrence, and nothing is written
 * until every one of them has been found: a run either removes what it was
 * told to or writes nothing. That is `add`'s contract, and the reason there
 * is no exit 1 here.
 *
 * An id with a marker and no entry removes the marker alone, which is how a
 * `marker-orphan` is cleared.
 */
import { resolve } from "node:path";
import { writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL } from "../../meta/internal.js";
import { ManifestSet } from "../core/manifest.js";
import { citationInputs, pickExtractor, readPage } from "../core/page.js";
import { shiftedEntries, withClaimLines } from "../core/shift.js";
import { isMarkerLine, respellStatement } from "../core/statements.js";
import { splitLines } from "../core/hash.js";
import { removeFrontmatterCitations, removeLine, spliceEntryField, unifiedDiff } from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  CitationInput,
  InlineStatement,
  ManifestChange,
  Removal,
  RemoveOptions,
  RemovePage,
  RemoveRun,
} from "../types.js";
import { assertNoOrphanJoins, assertNoOrphans, joinHits, prepareRun, readTarget } from "./check.js";

/** How an entry with no id is named: its place in the page's list. */
const POINTER = /^\/citations\/(0|[1-9][0-9]*)$/;

/** `4 entries`, `1 entry`. */
function entryCount(n: number): string {
  return `${String(n)} ${n === 1 ? "entry" : "entries"}`;
}

/** The `id` of a raw entry, whether or not the schema would accept the rest of it. */
function idOf(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
  const id: unknown = (entry as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

/** What one page's run found, before anything is written. */
interface Planned {
  page: RemovePage;
  /** The page as it will be written, when it changed. */
  content?: string;
  /** Absolute path to write it to; absent for the stdin page. */
  path?: string;
}

export async function runRemove(opts: RemoveOptions): Promise<RemoveRun> {
  // Repeats collapse, as they do on `--collection`: naming one entry twice
  // asks for one removal, and would otherwise be counted twice.
  const only = [...new Set(opts.only)];
  // Asked before the config is read: it is a usage error, and the answer does
  // not depend on anything on disk.
  if (only.length === 0) {
    throw new CiteError("remove needs --only <id>; it never removes every citation on a page.");
  }
  // Nothing here resolves a source: the run builds no index, and says
  // nothing about where `src:` paths would have come from.
  const prepared = await prepareRun({ ...opts, checkSources: false }, "removed", "remove", {
    resolve: false,
  });
  const { run, files, usingStdin, forced } = prepared;
  assertNoOrphans(prepared);
  const hits = joinHits();
  const manifests = new ManifestSet();
  /** Every `--only` value that named something, anywhere in the run. */
  const matched = new Set<string>();
  const pageCount = files.length + (usingStdin ? 1 : 0);

  const planned: Planned[] = [];
  const removeOne = async (label: string, content: string, path?: string): Promise<void> => {
    const setup = prepared.setupFor(label, content);
    if (setup.sidecar !== undefined) hits.record(setup.sidecar, label);
    const owner = setup.sidecar?.owner;
    const page = readPage(label, content, {
      ...(forced === undefined ? {} : { format: forced.name }),
      ...(setup.options.citations === undefined ? {} : { citations: setup.options.citations }),
      ...(owner === undefined ? {} : { owned: { file: owner.file, collection: owner.collection } }),
    });
    const { format } = page;
    const extractor = pickExtractor(label, forced?.name);
    const inputs: CitationInput[] = citationInputs(
      label,
      extractor.extract(content, label),
      setup.sidecar?.citations,
    );
    const lines = splitLines(content);

    /** The entries one `--only` value names on this page. */
    const entriesFor = (value: string): number[] => {
      // The digits of a pointer, or nothing for a value that is an id. Read
      // as a capture rather than through `exec(...) !== null`, so the index
      // is a string the compiler has seen narrowed.
      const [, digits] = POINTER.exec(value) ?? [];
      if (digits === undefined) {
        return inputs.flatMap((input, index) => (idOf(input.entry) === value ? [index] : []));
      }
      const index = Number(digits);
      if (index < inputs.length) return [index];
      // A pointer is a position, so over several pages it means the entry at
      // that position wherever there is one. Against one page there is no
      // other page it could have meant.
      if (pageCount === 1) {
        throw new CiteError(
          `"${value}" is past the last entry of ${label} (${entryCount(inputs.length)}).`,
        );
      }
      return [];
    };
    /** The markers naming an id. */
    const markersFor = (id: string | undefined): InlineStatement[] =>
      id === undefined
        ? []
        : page.statements.filter(
            (s) => s.payload.kind === "ref" && s.payload.ids.includes(id),
          );
    /** Per marker line, the ids this run takes out of its list. */
    const dropped = new Map<number, { statement: InlineStatement; ids: Set<string> }>();
    const drop = (statement: InlineStatement, id: string): void => {
      const held = dropped.get(statement.line) ?? { statement, ids: new Set<string>() };
      held.ids.add(id);
      dropped.set(statement.line, held);
    };

    const removed: Removal[] = [];
    const indices = new Set<number>();
    const markerLines: number[] = [];
    for (const value of only) {
      const found = entriesFor(value);
      for (const index of found) {
        const input = inputs[index];
        const id = idOf(input?.entry);
        const markers = markersFor(id);
        indices.add(index);
        markerLines.push(...markers.map((s) => s.line));
        if (id !== undefined) for (const statement of markers) drop(statement, id);
        removed.push({
          ...(id === undefined ? {} : { id }),
          index,
          ...(input === undefined ? {} : { origin: input.origin }),
          markerLines: markers.map((s) => s.line),
        });
        matched.add(value);
      }
      if (found.length > 0) continue;
      // An id no entry carries, but a marker names: the marker alone.
      const markers = markersFor(value);
      if (markers.length === 0) continue;
      markerLines.push(...markers.map((s) => s.line));
      for (const statement of markers) drop(statement, value);
      removed.push({ id: value, markerLines: markers.map((s) => s.line) });
      matched.add(value);
    }
    const nothing: RemovePage = { file: label, removed: [], diff: "", written: false };
    if (removed.length === 0) {
      // The stdin page is printed whatever the run did to it.
      if (path === undefined) nothing.content = content;
      planned.push({ page: nothing, ...(path === undefined ? {} : { path }) });
      return;
    }

    // A marker sharing its line with text anchors that text, so the line is
    // not the tool's to delete. The refusal is a property of the line rather
    // than of the payload, so it holds however many ids the marker names.
    const touched = [...new Set(markerLines)].sort((a, b) => a - b);
    for (const line of touched) {
      if (!isMarkerLine(lines[line - 1] ?? "", format)) {
        const id = page.statements.find((s) => s.line === line)?.payload;
        const named = id?.kind === "ref" ? ` ${id.ids.join(" ")}` : "";
        throw new CiteError(
          `the marker${named} at ${label}:${String(line)} shares its line with text; remove it by hand.`,
        );
      }
    }
    // A marker that keeps an id keeps its line: the word goes out of the list
    // and nothing below it moves. Only a marker that loses its last id is a
    // line to delete (proposal 0056).
    const kept = new Map<number, [string, ...string[]]>();
    const ordered: number[] = [];
    for (const line of touched) {
      const held = dropped.get(line);
      // Destructured rather than cast: a marker that keeps nothing is a line
      // to delete, and the head is what tells the two apart.
      const [head, ...rest] =
        held === undefined || held.statement.payload.kind !== "ref"
          ? []
          : held.statement.payload.ids.filter((id) => !held.ids.has(id));
      if (head === undefined) ordered.push(line);
      else kept.set(line, [head, ...rest]);
    }

    // What stays, moved up by the marker lines going out above it.
    const survivors = page.citations.filter((c) => !indices.has(c.origin.index));
    const shifted = shiftedEntries({
      citations: survivors,
      at: ordered,
      delta: -1,
      bodyLine: page.bodyLine,
      label,
    });

    let after = content;
    // The respells first, and the order is load-bearing. A statement carries
    // byte offsets into the page as it was read, while splicing a claim line
    // can change the byte count above it: `lines: 10` becomes `lines: 9`.
    // Enough of those and the offsets no longer find the payload, and the
    // respell silently leaves the id in the marker. A respell changes no line
    // count and no byte above the frontmatter, so running it first is safe in
    // the direction the splice is not.
    for (const [line, ids] of kept) {
      const held = dropped.get(line);
      if (held !== undefined) after = respellStatement(after, held.statement, ids);
    }
    // Then the claim lines, while the entries still stand where the page's
    // own pointers say. Splicing a scalar never changes the line count, and
    // the markers are in the body, so neither edit moves the other.
    for (const { index, lines: moved } of shifted.frontmatter) {
      after = spliceEntryField(after, format, index, ["claim", "lines"], moved);
    }
    // Bottom up, so every line above each one keeps its number.
    for (const line of [...ordered].sort((a, b) => b - a)) after = removeLine(after, line);
    if (owner === undefined) {
      after = removeFrontmatterCitations(after, format, indices, label);
    } else {
      if (setup.sidecar?.entry === undefined) {
        throw new CiteError(
          `${label} carries no ${owner.join}: value, so its citations cannot be keyed in ${owner.file}.`,
        );
      }
      const kept = inputs
        .map((input, index) => {
          const moved = shifted.manifest.get(index);
          return moved === undefined ? input.entry : withClaimLines(input.entry, moved);
        })
        .filter((_entry, index) => !indices.has(index));
      if (kept.length === 0) await manifests.remove(owner, setup.sidecar.entry);
      // The line a written entry sits on is what `add` reports; a removal
      // reports the line the entry sat on before, from its origin. So the
      // answer is dropped here, and the index it is measured from is any
      // index at all.
      else void (await manifests.write(owner, setup.sidecar.entry, kept, 0));
    }

    const out: RemovePage = {
      file: label,
      removed,
      diff: after === content ? "" : unifiedDiff(label, content, after),
      written: false,
    };
    // The stdin page has nowhere to be written; the caller prints it instead.
    if (path === undefined) out.content = after;
    planned.push({ page: out, ...(after === content ? {} : { content: after }), ...(path === undefined ? {} : { path }) });
  };

  if (usingStdin) await removeOne(STDIN_LABEL, opts.stdinContent ?? "");
  for (const file of files) {
    await removeOne(file, await readTarget(run, file), resolve(run.base, file));
  }
  assertNoOrphanJoins(prepared, hits);

  // Every name has to have been found somewhere before a byte is written.
  const missing = only.find((value) => !matched.has(value));
  if (missing !== undefined) {
    const where =
      pageCount === 1
        ? `${planned[0]?.page.file ?? "the page"} has no`
        : `none of ${String(pageCount)} pages has an`;
    const what = POINTER.test(missing) ? `entry ${missing}` : `entry or marker ${missing}`;
    throw new CiteError(`${where} ${what}.`);
  }

  const write = opts.dryRun !== true;
  for (const item of planned) {
    if (item.content === undefined || item.path === undefined) continue;
    if (write) await writeFileAtomic(item.path, item.content);
    item.page.written = write;
  }
  const rewritten: ManifestChange[] = [];
  const record = (changed: { file: string; diff: string }): void => {
    rewritten.push({ file: changed.file, diff: changed.diff, written: write });
  };
  if (write) await manifests.commit({ after: record });
  else for (const changed of manifests.changed()) record(changed);

  const pages = planned.map((item) => item.page);
  return {
    pages,
    removed: pages.reduce((n, page) => n + page.removed.length, 0),
    ...(rewritten.length > 0 ? { manifests: rewritten } : {}),
  };
}
