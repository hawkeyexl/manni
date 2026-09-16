/** `manni tracevals list` — enumerate discoverable traces. */
import pc from "picocolors";
import {
  discoverTraces,
  type DiscoverOptions,
  type TraceListing,
} from "../trace/discover.js";

export type ListOptions = DiscoverOptions;

export interface ListRun {
  traces: TraceListing[];
}

export async function runList(options: ListOptions = {}): Promise<ListRun> {
  return { traces: await discoverTraces(options) };
}

export function renderList(
  run: ListRun,
  opts: { color?: boolean } = {},
): string {
  const color = opts.color ?? true;
  const dim = (s: string) => (color ? pc.dim(s) : s);
  const bold = (s: string) => (color ? pc.bold(s) : s);

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
