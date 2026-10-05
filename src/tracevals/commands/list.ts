/** `manni tracevals list` — enumerate discoverable traces. */
import {
  discoverTraces,
  type DiscoverOptions,
  type TraceListing,
} from "../trace/discover.js";
import { palette } from "../../shared/color.js";
import { keepNewerThan, parseNewerThan } from "./batch.js";

export interface ListOptions extends DiscoverOptions {
  /** `--newer-than`: keep only traces modified within this duration, e.g. `7d`. */
  newerThan?: string;
}

export interface ListRun {
  traces: TraceListing[];
}

export async function runList(options: ListOptions = {}): Promise<ListRun> {
  // Parsed before the store is read, so a bad duration costs no scan.
  if (options.newerThan !== undefined) parseNewerThan(options.newerThan);
  const { newerThan, ...discover } = options;
  return { traces: keepNewerThan(await discoverTraces(discover), newerThan) };
}

export function renderList(
  run: ListRun,
  opts: { color?: boolean } = {},
): string {
  const pc = palette(opts.color === true);
  const dim = pc.dim;
  const bold = pc.bold;

  if (run.traces.length === 0) {
    return "No traces found. Pass --all-projects to scan every project, or --project <dir> to scope to one.";
  }

  const lines: string[] = [];
  run.traces.forEach((t, i) => {
    const when = new Date(t.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
    const size = `${Math.max(1, Math.round(t.sizeBytes / 1024))}KB`;
    lines.push(
      `${bold(String(i + 1).padStart(3))}. ${dim(when)}  ${t.firstPrompt ?? dim("(no prompt)")}`,
    );
    lines.push(
      `      ${dim(`${t.project ?? "unknown project"} · ${t.sessionId ?? "?"} · ${size}`)}`,
    );
    lines.push(`      ${dim(t.file)}`);
  });
  return lines.join("\n");
}
