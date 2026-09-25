/**
 * `tools` command core. One row per lint job: which tool performs it, whether
 * this checkout can run it, what it read its settings from, and the input
 * formats it understands.
 *
 * It replaces `formats`, which reported the parser registry alone. Proposal
 * 0050 records the rename. The registry is here as one column of the job that
 * reads it, because the formats belong to the tool performing that job.
 *
 * The column lists exactly the formats the tool reads, so a row carries no
 * state: a listed format is one that is read, and `--as` accepts every name in
 * it.
 *
 * Returns data; `src/lint/reporters/index.ts` renders it.
 */
import type { ContentKind } from "../types.js";
import { BLOCK_KIND_NODE } from "../core/template.js";
import { resolveStructureTool } from "../tools/index.js";
import {
  LINT_JOBS,
  resolveLintRun,
  type LintConfig,
  type LintJob,
  type LintTool,
} from "../core/config.js";

/**
 * The content kinds a template rule can actually name - `BLOCK_KIND_NODE`'s
 * values, the nine block-rule keys map onto. `manni lint tools` lists this
 * column to answer "can my rule run against this format", and a rule can
 * never ask about `listItem`, `tableRow`, `tableCell`, or `definitionItem`:
 * those are structural kinds a parser reports so the content model can
 * describe a list's items or a table's cells, not kinds a `sections:` rule
 * counts on its own. What a parser *declares* (`DocumentParser.kinds`, read by
 * the pruner in `validator.ts`) is untouched - this is a display decision, so
 * it belongs here rather than trimming the declaration itself.
 */
const REPORTABLE_KINDS = new Set<ContentKind>(Object.values(BLOCK_KIND_NODE));

export interface FormatInfo {
  /** Parser name, also what `--as` accepts. */
  name: string;
  label: string;
  extensions: string[];
  /** The content kinds this format's parser actually emits today. */
  kinds: ContentKind[];
}

/** One job, and the tool that would perform it on this run. */
export interface ToolInfo {
  job: LintJob;
  tool: LintTool;
  /** Whether the config declares this job, or anything the job's tool reads. */
  configured: boolean;
  /** Whether the tool can run here, as its own probe reported it. */
  available: boolean;
  /**
   * The version the probe reported, or null when it reported none.
   *
   * Null rather than a placeholder string, because this is the shape
   * `-f json` emits: a consumer can test for an absent version, where a dash
   * would be a value it has to know to recognize. The pretty reporter renders
   * the dash.
   */
  version: string | null;
  /** Where the tool read its settings: the config file, or the defaults. */
  config: string;
  /** The input formats the tool reads. */
  formats: FormatInfo[];
}

export interface ToolsOptions {
  cwd?: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: ignore any discovered config file. */
  noConfig?: boolean;
}

/** What a run with no config file to read reports in the `config` column. */
export const BUILT_IN_DEFAULTS = "built-in defaults";

/**
 * Whether the config says anything about this job.
 *
 * The job's own mapping counts, and so does every key its tool reads: a repo
 * that has written `templates:` and `overrides:` has configured the structure
 * job whether or not it also spelled `structure:` out. Saying otherwise would
 * report "not configured" beside a run those keys visibly govern.
 */
function isConfigured(job: LintJob, config: LintConfig): boolean {
  if (config[job] !== undefined) return true;
  return (
    config.templates !== undefined ||
    config.template !== undefined ||
    config.types !== undefined ||
    config.overrides !== undefined
  );
}

export async function runTools(opts: ToolsOptions = {}): Promise<ToolInfo[]> {
  // The same resolution every other command does, so a config this command
  // cannot read is the same exit 2 with the same message, rather than a row
  // saying "built-in defaults" over a file that is really there and broken.
  const cwd = opts.cwd ?? process.cwd();
  const run = await resolveLintRun({
    cwd,
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: [],
  });

  return await Promise.all(
    LINT_JOBS.map(async (job) => {
      const tool: LintTool = run.config[job]?.tool ?? "manni";
      // The row is the tool's own answer about itself. It used to be two
      // literals that happened to be right while manni was the only tool:
      // "available" was hard-coded true, and the version was this package's
      // whatever performed the job.
      const descriptor = resolveStructureTool(tool);
      // The family's `tools:` travels with the probe: a tool outside the
      // package is found where its own `tools.<tool>` says it is, so probing
      // without it would report "not available" over the very installation the
      // run would go on to use.
      const probed = await descriptor.probe({
        cwd,
        tools: run.tools,
        ...(run.configDir === undefined ? {} : { configDir: run.configDir }),
      });
      return {
        job,
        tool,
        configured: isConfigured(job, run.config),
        available: probed.available,
        version: probed.version,
        config: run.configSource ?? BUILT_IN_DEFAULTS,
        formats: descriptor.formats().map((format) => ({
          ...format,
          kinds: format.kinds.filter((kind) => REPORTABLE_KINDS.has(kind)),
        })),
      };
    }),
  );
}
