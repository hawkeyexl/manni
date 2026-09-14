/**
 * Reporter for `relocate` (proposal 0047).
 *
 * `pretty` leads with what the config gains or loses (a created collection or
 * manifest, an appended path, a `keys:` change and the pages it reaches), then
 * each page with a value that moved or stayed, then one summary line. A page
 * reached only through a `keys:` change, outside the paths the run named, is
 * counted rather than listed unless a value on it stayed. `json` is the
 * scripting form: the run's shape minus what only the pretty lines need.
 */
import { DocmetaError } from "../types.js";
import type { RelocateResult } from "../core/relocation.js";
import { palette } from "../../shared/color.js";
import { formatList } from "./index.js";

export const RELOCATE_FORMATS = ["pretty", "json"] as const;

export type RelocateReportFormat = (typeof RELOCATE_FORMATS)[number];

/** `"pretty or json"`, for messages and help text. */
export const RELOCATE_FORMAT_LIST = formatList(RELOCATE_FORMATS);

export function isRelocateFormat(value: string): value is RelocateReportFormat {
  return (RELOCATE_FORMATS as readonly string[]).includes(value);
}

export interface RelocateReportOptions {
  color?: boolean;
}

export function renderRelocate(
  result: RelocateResult,
  format: RelocateReportFormat,
  opts: RelocateReportOptions = {},
): string {
  switch (format) {
    case "json":
      return JSON.stringify(relocateJson(result), null, 2);
    case "pretty":
      return renderRelocatePretty(result, opts);
    default: {
      const unreachable: never = format;
      throw new DocmetaError(
        `relocate --format must be pretty or json; got ${JSON.stringify(unreachable)}.`,
      );
    }
  }
}

/** The JSON shape: what a script reads, without the pretty reporter's own fields. */
export function relocateJson(result: RelocateResult): unknown {
  return {
    dryRun: result.dryRun,
    config: {
      file: result.config.file,
      created: result.config.created,
      collectionsCreated: result.config.collectionsCreated,
      pathsAdded: result.config.pathsAdded,
    },
    manifests: result.manifests.map((m) => ({
      file: m.file,
      collection: m.collection,
      created: m.created,
      keysAdded: m.keysAdded,
      keysRemoved: m.keysRemoved,
      undeclared: m.undeclared,
    })),
    files: result.files.map((f) => ({
      file: f.file,
      moved: f.moved,
      stayed: f.stayed.map((s) => ({ key: s.key, reason: s.reason })),
    })),
    summary: result.summary,
  };
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const list = (xs: readonly string[]): string => xs.join(", ");

export function renderRelocatePretty(result: RelocateResult, opts: RelocateReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const dry = result.dryRun;
  const lines: string[] = [];

  // ---- The config ------------------------------------------------------------
  if (result.config.created && result.config.file !== null) {
    lines.push(dry ? `Would create ${result.config.file}.` : `Created ${result.config.file}.`);
  }
  const pathsOf = (collection: string): string[] =>
    result.config.pathsAdded.filter((p) => p.collection === collection).map((p) => p.path);
  const said = new Set<string>();
  for (const created of result.config.collectionsCreated) {
    said.add(created.name);
    const made = result.manifests.filter((m) => m.collection === created.name && m.created);
    const head = `${dry ? "Would create" : "Created"} collection ${created.name} (paths: ${list(created.paths)})`;
    if (made.length === 0) {
      lines.push(`${head}.`);
      continue;
    }
    const owns = list(made.flatMap((m) => m.keys));
    lines.push(`${head} and ${list(made.map((m) => m.file))}; it ${dry ? "would own" : "owns"} ${owns}.`);
  }
  for (const m of result.manifests) {
    if (said.has(m.collection) && m.created) continue;
    const added = said.has(m.collection) ? [] : pathsOf(m.collection);
    if (added.length > 0) said.add(m.collection);
    const keys = list(m.keys);
    if (m.created) {
      if (added.length > 0) {
        lines.push(
          dry
            ? `Would add ${list(added)} to collection ${m.collection}'s paths and create ${m.file}; it would own ${keys}.`
            : `Added ${list(added)} to collection ${m.collection}'s paths and created ${m.file}; it owns ${keys}.`,
        );
      } else {
        lines.push(
          dry
            ? `Would create ${m.file}; collections[${m.collection}].externalMetadata[${m.index}] would own ${keys}.`
            : `Created ${m.file}; collections[${m.collection}].externalMetadata[${m.index}] owns ${keys}.`,
        );
      }
      continue;
    }
    const beyond = m.beyond > 0 ? `, ${m.beyond} beyond the paths you named` : "";
    const moves = (n: number): string => `${dry ? "would move" : "moves"} ${n === 1 ? "it" : "them"}`;
    if (m.keysRemoved.length > 0) {
      lines.push(
        `Removing ${list(m.keysRemoved)} from ${m.file}'s keys ${moves(m.keysRemoved.length)} into every page in collection ${m.collection}${beyond}.`,
      );
    }
    if (added.length > 0) {
      lines.push(
        dry
          ? `Would add ${list(added)} to collection ${m.collection}'s paths; ${m.file} would own ${keys}.`
          : `Added ${list(added)} to collection ${m.collection}'s paths; ${m.file} now owns ${keys}.`,
      );
    } else if (m.keysAdded.length > 0) {
      lines.push(
        `Adding ${list(m.keysAdded)} to ${m.file}'s keys ${moves(m.keysAdded.length)} out of every page in collection ${m.collection}${beyond}.`,
      );
    }
    if (m.undeclared) {
      lines.push(
        dry
          ? `${m.file} would no longer own any keys and would no longer be declared; delete it when you are ready.`
          : `${m.file} no longer owns any keys and is no longer declared; delete it when you are ready.`,
      );
    }
  }
  for (const p of result.config.pathsAdded) {
    if (said.has(p.collection)) continue;
    said.add(p.collection);
    lines.push(`${dry ? "Would add" : "Added"} ${list(pathsOf(p.collection))} to collection ${p.collection}'s paths.`);
  }

  // ---- The pages ---------------------------------------------------------------
  const width = Math.max(
    7,
    ...result.files.flatMap((f) => [...f.moved, ...f.stayed].map((v) => v.key.length)),
  );
  const shown = result.files.filter((f) => !f.beyond || f.stayed.length > 0);
  for (const f of shown) {
    lines.push(f.file);
    for (const mv of f.moved) {
      const name = c.cyan(mv.key.padEnd(width));
      if (mv.to === "page") {
        lines.push(`    ${name}  ← ${mv.from}`);
      } else {
        lines.push(`    ${name}  → ${mv.manifest}${mv.line !== undefined ? `:${mv.line}` : ""}`);
      }
    }
    for (const st of f.stayed) {
      lines.push(`    ${c.cyan(st.key.padEnd(width))}  ${c.yellow(`stays: ${st.detail ?? st.reason}`)}`);
    }
  }
  const hidden = result.files.length - shown.length;
  if (hidden > 0) lines.push(`… (${plural(hidden, "more file")})`);

  // ---- The summary ---------------------------------------------------------------
  const s = result.summary;
  if (s.files === 0) {
    lines.push("0 files, nothing to move");
    return lines.join("\n");
  }
  const moves = result.files.flatMap((f) => f.moved);
  const toPage = moves.filter((m) => m.to === "page").length;
  const toManifest = moves.flatMap((m) => (m.to === "manifest" ? [m.manifest] : []));
  const manifests = plural(new Set(toManifest).size, "manifest");
  let footer = `${plural(s.files, "file")}, ${plural(s.moved, "value")} ${dry ? "would move" : "moved"}`;
  if (toPage > 0 && toManifest.length > 0) {
    footer += `: ${toPage} into pages, ${toManifest.length} into ${manifests}`;
  } else if (toManifest.length > 0) {
    footer += ` to ${manifests}`;
  } else if (toPage > 0) {
    footer += " into pages";
  }
  if (s.stayed > 0) footer += `, ${s.stayed} stayed`;
  lines.push(s.stayed > 0 ? c.yellow(footer) : footer);
  return lines.join("\n");
}
