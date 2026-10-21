/**
 * `manni graph publish` (proposal 0090): everything serving needs, in one
 * directory, by running each step's own core in-process. Nothing here builds,
 * embeds or exports on its own.
 *
 * The steps run in the order each one's input exists: `build`, the search
 * index, `embed` (which reads the index), `graph.jsonld`, the chunks (which
 * read the vectors), then `llms.txt` and the iiRDS package. `embed`, `llms`
 * and `iirds` run only when their config section exists, and are otherwise
 * reported as skipped. The first step that fails stops the run with its own
 * message. It does not gate: `graph check` gates.
 */
import { basename, dirname, join, relative, resolve } from "node:path";
import { errorMessage } from "../../shared/errors.js";
import { loadRunConfig } from "../core/config.js";
import { GraphError } from "../types.js";
import { runBuild } from "./build.js";
import { runEmbed } from "./embed.js";
import { runExport, type ExportFormat, type ExportResult } from "./export.js";
import { LLMS_FILENAME } from "./llms.js";

export interface PublishOptions {
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** `--out`: the directory for every artifact (default: the directory of config `out`). */
  out?: string;
  /** `--evals`: overrides `graph.export.chunks.evals`. */
  evals?: string;
  cwd?: string;
  /** Each step's warnings and notices, as they are said. */
  say?: (kind: "warning" | "notice", message: string) => void;
}

export type PublishStepName = "build" | "embed" | `export:${ExportFormat}`;

export interface PublishStep {
  step: PublishStepName;
  status: "ran" | "skipped";
  detail: string;
  /** What the step wrote, relative to `out`. */
  files: string[];
}

export interface PublishReport {
  /** The directory, as the run names it from its working directory. */
  out: string;
  steps: PublishStep[];
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export async function runPublish(opts: PublishOptions = {}): Promise<PublishReport> {
  const cwd = opts.cwd ?? process.cwd();
  const source = {
    ...(opts.config === undefined ? {} : { config: opts.config }),
    ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    cwd,
  };
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
  );
  const configured = resolve(cwd, config.out);
  const outDir = opts.out === undefined ? dirname(configured) : resolve(cwd, opts.out);
  const graph = join(outDir, basename(configured));
  const shown = (path: string): string => relative(outDir, path).split("\\").join("/");
  const say = opts.say ?? (() => undefined);
  const steps: PublishStep[] = [];

  const run = async (
    step: PublishStepName,
    work: () => Promise<{ detail: string; files: string[]; warnings: string[]; notices?: string[] }>,
  ): Promise<void> => {
    let done: Awaited<ReturnType<typeof work>>;
    try {
      done = await work();
    } catch (e) {
      throw new GraphError(`graph publish stopped at ${step}: ${errorMessage(e)}`);
    }
    for (const w of done.warnings) say("warning", w);
    for (const n of done.notices ?? []) say("notice", n);
    steps.push({ step, status: "ran", detail: done.detail, files: done.files.map(shown) });
  };
  const skip = (step: PublishStepName, section: string): void => {
    steps.push({ step, status: "skipped", detail: `no ${section} section`, files: [] });
  };
  const exported = (format: ExportFormat, detail: (r: ExportResult) => string, out?: string) =>
    run(`export:${format}`, async () => {
      const r = await runExport({ ...source, graph, format, ...(out === undefined ? {} : { out }), ...(format === "chunks" && opts.evals !== undefined ? { evals: opts.evals } : {}) });
      return { detail: detail(r), files: r.files, warnings: r.warnings, ...(r.notices === undefined ? {} : { notices: r.notices }) };
    });
  const names = (r: ExportResult): string => r.files.map(shown).join(", ");

  await run("build", async () => {
    const r = await runBuild({ ...source, out: graph });
    return { detail: `${shown(r.outPath)}: ${plural(r.docs, "page")}, ${plural(r.quads, "triple")}`, files: [r.outPath], warnings: r.warnings };
  });
  await exported("search", (r) => `${names(r)}: ${String(r.nodes)} ${r.nodes === 1 ? "entry" : "entries"}`, outDir);
  if (config.declared.embed) {
    await run("embed", async () => {
      const r = await runEmbed({ ...source, graph, index: outDir, out: outDir });
      const models = [...new Set(r.languages.map((l) => l.model))].join(", ");
      const files = r.languages.map((l) => l.outPath);
      return { detail: `${files.map(shown).join(", ")}: ${plural(r.total, "vector")}, ${models}`, files, warnings: [] };
    });
  } else {
    skip("embed", "graph.embed");
  }
  await exported("jsonld", (r) => `${names(r)}: ${plural(r.nodes, "node")}`);
  await exported("chunks", (r) => `${names(r)}: ${plural(r.nodes, "chunk")}, ${String(r.withheld ?? 0)} withheld`, outDir);
  if (config.export.llms !== null) {
    await exported("llms", (r) => `${names(r)}: ${plural(r.nodes, "page")}`, join(outDir, LLMS_FILENAME));
  } else {
    skip("export:llms", "graph.export.llms");
  }
  if (config.declared.iirds) {
    await exported("iirds", (r) => `${names(r)}: ${plural(r.nodes, "node")}`);
  } else {
    skip("export:iirds", "graph.export.iirds");
  }

  const label = relative(cwd, outDir).split("\\").join("/");
  return { out: label === "" ? "." : label, steps };
}

/** The step lines and the file count, or the report as JSON. */
export function renderPublish(report: PublishReport, format: "pretty" | "json"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = report.steps.map((s) => {
    if (s.status === "skipped") return `skipped   ${s.step.replace(/^export:/, "")}: ${s.detail}`;
    return `${s.step.replace(/:.*$/, "").padEnd(9)} ${s.detail}`;
  });
  const files = new Set(report.steps.flatMap((s) => s.files)).size;
  lines.push(`Published ${plural(files, "file")} to ${report.out}/.`);
  return lines.join("\n");
}
