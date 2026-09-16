/**
 * The kg program. Named `kg` because that is where it is mounted
 * (`manni kg …`); `src/cli.ts` adds it to the umbrella and runs it.
 *
 * Grammar per proposals 0034 and 0051 §2: the domain owns verbs and has no
 * default subcommand, `-f` means the output format everywhere and is checked
 * against the verb's list, and a list reaches a flag by exactly one
 * separator. The plumbing is the family's: `fail()` from `src/shared/run.ts`,
 * `warn()` from `src/shared/warn.ts`, and `--no-color` from
 * `src/shared/color.ts`.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { collect, splitList } from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { warn } from "../shared/warn.js";
import { KgError } from "./types.js";
import { PROVIDER_NAMES } from "./core/config.js";
import { KG_FORMATS, KG_FORMAT_LIST, type KgFormat } from "./reporters/index.js";
import { runBuild } from "./commands/build.js";
import { renderCheck, runCheck } from "./commands/check.js";
import {
  EXPORT_TARGETS,
  runExport,
  type ExportFormat,
} from "./commands/export.js";
import { renderQuery, runQuery } from "./commands/query.js";
import { renderValidate, runValidate } from "./commands/validate.js";
import { renderFill, runFill } from "./commands/fill.js";
import { runInit } from "./commands/init.js";
import { renderEmbed, runEmbed } from "./commands/embed.js";
import {
  renderSearch,
  runSearch,
  SEARCH_MODES,
  type SearchMode,
} from "./commands/search.js";
import { renderStats, runStats } from "./commands/stats.js";
import { renderTraverse, runTraverse } from "./commands/traverse.js";

/**
 * Whether `command`'s output gets colour: this domain's `--no-color` and
 * `NO_COLOR` turn it off, and otherwise only a TTY turns it on
 * (`shouldColor`). `isTTY` is passed uncoerced: Node leaves it undefined off
 * a terminal, never false, and `shouldColor` reads a missing one as "not a
 * terminal".
 *
 * Exported because this is where the decision is testable — a spawned bin is
 * never a TTY. kg's reporters print no colour yet; when one does, it takes
 * the boolean from here rather than consulting the environment itself.
 */
export function colorFor(
  command: Command,
  isTTY: boolean | undefined,
  env?: NodeJS.ProcessEnv,
): boolean {
  // commander maps --no-color to opts.color === false, on the command that
  // declares it.
  const noColor = colorOwner(command).opts().color === false;
  return shouldColor({ noColor, isTTY, env });
}

/**
 * The nearest command, this one or an ancestor, that declares `--no-color`:
 * the `kg` program, wherever it is mounted. Not the root: under the umbrella
 * that is `manni`, which has no `--no-color` of its own.
 */
function colorOwner(command: Command): Command {
  for (let c: Command | null = command; c !== null; c = c.parent) {
    if (c.options.some((o) => o.long === "--no-color")) return c;
  }
  return command;
}

export function buildProgram(): Command {
const program = new Command();

program
  .name("kg")
  .description(
    "Deterministic knowledge graphs derived from documentation frontmatter and formatting.",
  )
  .version(pkg.version)
  .option("--no-color", "disable colored output")
  // A pointer, not the whole help screen: the message that precedes it
  // already names the offending flag.
  .showHelpAfterError("(add --help for usage)")
  // MUST come before the `.command()` calls below. `copyInheritedSettings`
  // copies `_exitCallback` by value at subcommand-creation time, so an
  // `exitOverride()` installed afterwards leaves every subcommand still
  // calling `process.exit(1)` — which reports a usage error as a finding.
  .exitOverride();

/**
 * Parse a numeric CLI option, refusing what the config schema refuses.
 *
 * `Number.parseFloat`/`parseInt` return NaN for `abc` and silently accept
 * out-of-range values, and NaN then disables whatever gate it feeds — a cost
 * cap that never fires, a confidence gate that writes everything, a `--top`
 * that asks for a negative number of rows. The documented precedence is
 * config → Ajv → CLI override, so the override has to be held to the same range.
 */
function numericOption(
  flag: string,
  { min, max, integer }: { min: number; max?: number; integer?: boolean },
) {
  return (raw: string): number => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new KgError(`${flag} expects a number, got "${raw}".`);
    }
    if (integer && !Number.isInteger(value)) {
      throw new KgError(`${flag} expects a whole number, got ${value}.`);
    }
    if (value < min || (max !== undefined && value > max)) {
      const range = max === undefined ? `>= ${min}` : `${min}..${max}`;
      throw new KgError(`${flag} must be ${range}, got ${value}.`);
    }
    return value;
  };
}

/** A count: a whole number, at least `min` (1 unless the flag allows zero). */
function countOption(flag: string, min = 1) {
  return numericOption(flag, { min, integer: true });
}

/**
 * Hold a CLI override to the same list its config key is held to.
 *
 * `fill.provider` is Ajv-validated against the schema enum; the `--provider`
 * override was an arbitrary string cast straight to `ProviderName`, so the
 * documented config → Ajv → CLI precedence had a hole at the last step.
 */
function enumOption<T extends string>(flag: string, allowed: readonly T[]) {
  return (raw: string): T => {
    if (!(allowed as readonly string[]).includes(raw)) {
      throw new KgError(
        `${flag} must be one of ${allowed.join(" | ")}, got "${raw}".`,
      );
    }
    return raw as T;
  };
}

/**
 * A flag whose value is one of a named set, refused in the family's words:
 * `Unknown --format "xml". Use pretty | json.` The check runs while the
 * options are parsed, so a typo costs a message rather than a graph load.
 */
function choiceOption<T extends string>(flag: string, allowed: readonly T[]) {
  return (raw: string): T => {
    if (!(allowed as readonly string[]).includes(raw)) {
      throw new KgError(`Unknown ${flag} "${raw}". Use ${allowed.join(" | ")}.`);
    }
    return raw as T;
  };
}

/** `-f, --format`: every verb's list is `pretty | json` (0051 §2). */
const formatOption = choiceOption("--format", KG_FORMATS);

program
  .command("init")
  .description("Add a starter `kg:` section to manni.config.yaml in the current directory")
  .action(async () => {
    try {
      console.log(`Created ${await runInit()}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("build")
  .description("Derive the knowledge graph and write deterministic Turtle")
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-o, --out <path>", "Output .ttl path (default: config out)")
  .action(async (globs: string[], opts: { config?: string; out?: string }) => {
    try {
      const result = await runBuild({
        globs,
        config: opts.config,
        out: opts.out,
      });
      // Warnings go to stderr so stdout stays the machine-readable summary;
      // a degraded build is still a successful one, so the exit code is 0.
      for (const warning of result.warnings) warn(warning);
      console.log(
        `Wrote ${result.outPath} (${result.docs} docs, ${result.quads} triples)`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description(
    "Validate the built graph against the bundled SHACL shapes (violations exit 1)",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  // One path per occurrence, never split on commas: a path may hold one.
  .option(
    "--shapes <path>",
    "Shapes .ttl file; repeatable (default: config check.shapes, then bundled)",
    collect,
    [],
  )
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      shapes: string[];
      format: KgFormat;
    }) => {
      try {
        const report = await runCheck(opts);
        console.log(renderCheck(report, opts.format));
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("validate")
  .description("Check docs are KG-ready (frontmatter validated via manni meta)")
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (globs: string[], opts: { config?: string; format: KgFormat }) => {
      try {
        const result = await runValidate({ globs, config: opts.config });
        console.log(renderValidate(result, opts.format));
        process.exitCode = result.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("fill")
  .description(
    "Propose `kg:` frontmatter fields with an LLM, gated by confidence, and write them back",
  )
  .argument("[globs...]", "Input globs (default: config inputs)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .option("--dry-run", "Report proposals without writing files")
  .option("--force", "Overwrite human-set kg fields")
  .option("--no-cache", "Bypass the proposal cache")
  .option("--no-validate-graph", "Skip the SHACL graph guardrail on proposals")
  .option("--sections", "Also propose per-section metadata")
  .option(
    "--max-cost <usd>",
    "Stop proposing past this cost",
    numericOption("--max-cost", { min: 0 }),
  )
  .option(
    "--min-confidence <n>",
    "Minimum model confidence (0..1) to write a field (default: config, 0.7)",
    numericOption("--min-confidence", { min: 0, max: 1 }),
  )
  .option(
    "--provider <name>",
    `Provider: ${PROVIDER_NAMES.join(" | ")}`,
    enumOption("--provider", PROVIDER_NAMES),
  )
  .option("--model <model>", "Model override")
  .action(async (globs: string[], opts: Record<string, unknown>) => {
    try {
      const report = await runFill({
        globs,
        config: opts.config as string | undefined,
        dryRun: opts.dryRun as boolean | undefined,
        force: opts.force as boolean | undefined,
        noCache: opts.cache === false,
        noValidateGraph: opts.validateGraph === false,
        sections: opts.sections as boolean | undefined,
        maxCost: opts.maxCost as number | undefined,
        minConfidence: opts.minConfidence as number | undefined,
        provider: opts.provider as string | undefined,
        model: opts.model as string | undefined,
      });
      // Same channel discipline as build: warnings on stderr, so stdout stays
      // the report, and a warning never changes the exit code.
      for (const warning of report.warnings) warn(warning);
      console.log(renderFill(report, opts.format as KgFormat));
      process.exitCode = report.exitCode;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("query")
  .description(
    "Match triple patterns against the built graph (omit a term for wildcard)",
  )
  // Long-only. `-o` is `--out` on every other kg verb and `-s` is meta's
  // schema flag; a one-letter spelling that means two things in one family
  // costs more than three characters do.
  .option("--s <term>", "Subject IRI or prefixed name")
  .option("--p <term>", "Predicate IRI or prefixed name")
  .option("--o <term>", "Object IRI, prefixed name, or literal value")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    (opts: {
      s?: string;
      p?: string;
      o?: string;
      config?: string;
      graph?: string;
      format: KgFormat;
    }) => {
      try {
        const result = runQuery(opts);
        console.log(renderQuery(result, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("stats")
  .description(
    "Summarize the built graph: counts, orphans, broken links, hubs, metadata coverage",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .option(
    "--check",
    "Exit 1 when broken internal links exist or coverage is below threshold",
  )
  .option(
    "--top <n>",
    "How many most-connected docs to list",
    countOption("--top"),
  )
  .option(
    "--coverage-threshold <pct>",
    "Minimum metadata coverage % (all fields); overrides config for this run",
    // A percentage, so 0..100 rather than the 0..1 of a confidence. NaN here is
    // worse than a wrong number: `pct < NaN` is false for every field, so the
    // gate this flag exists to tighten would silently pass instead.
    numericOption("--coverage-threshold", { min: 0, max: 100 }),
  )
  .action(
    (opts: {
      config?: string;
      graph?: string;
      format: KgFormat;
      check?: boolean;
      top?: number;
      coverageThreshold?: number;
    }) => {
      try {
        const report = runStats(opts);
        console.log(renderStats(report, opts.format));
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("search")
  .description("Rank graph nodes for a text query (needs `export search`)")
  .argument("<query>", "Text query")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-i, --index <dir>",
    "Directory holding the indexes and manifest (default: beside the graph)",
  )
  .option(
    "--lang <tag>",
    "Which localization to search (required when the corpus has more than one)",
  )
  .option("--limit <n>", "Maximum results (default 10)", countOption("--limit"))
  .option(
    "--vectors <path>",
    "Vector sidecar path (default: from the manifest)",
  )
  .option(
    "--mode <mode>",
    `Which legs to run: ${SEARCH_MODES.join(" | ")} (default: hybrid when vectors exist)`,
    choiceOption("--mode", SEARCH_MODES),
  )
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (
      query: string,
      opts: {
        config?: string;
        graph?: string;
        index?: string;
        lang?: string;
        limit?: number;
        vectors?: string;
        mode?: SearchMode;
        format: KgFormat;
      },
    ) => {
      try {
        const report = await runSearch({ ...opts, query });
        console.log(renderSearch(report, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("traverse")
  .description(
    "Walk the graph from a node, honoring scope rules, with the full trace",
  )
  .argument("<node>", "Starting node: a full IRI or a prefix:local CURIE")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-d, --depth <n>",
    "Maximum hops from the node (default 1; 3 under --impact)",
    // Zero is allowed: it means the node itself, which is a real answer.
    countOption("--depth", 0),
  )
  // Comma-separated and given once: a CURIE holds no comma, so one separator
  // is enough, and a second spelling would be a second thing to document.
  .option(
    "--predicates <list>",
    "Only follow these predicates (comma-separated)",
  )
  .option("--reverse", "Follow inbound edges (who points at this node)")
  .option("--impact", "Transitive inbound reach: what a change here affects")
  .option(
    "--variant <variant>",
    "Scope filter: product variant IRI, title, or slug",
  )
  .option("--subject <subject>", "Scope filter: software subject")
  .option("--lang <tag>", "Scope filter: BCP-47 language tag, matched exactly")
  .option("--limit <n>", "Stop after this many nodes", countOption("--limit"))
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    (
      node: string,
      opts: {
        config?: string;
        graph?: string;
        depth?: number;
        predicates?: string;
        reverse?: boolean;
        impact?: boolean;
        variant?: string;
        subject?: string;
        lang?: string;
        limit?: number;
        format: KgFormat;
      },
    ) => {
      try {
        const report = runTraverse({
          ...opts,
          node,
          predicates:
            opts.predicates === undefined
              ? undefined
              : splitList(opts.predicates),
        });
        console.log(renderTraverse(report, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("embed")
  .description(
    "Compute local embeddings for the search index (needs @huggingface/transformers)",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-i, --index <dir>",
    "Directory holding the indexes and manifest (default: beside the graph)",
  )
  .option(
    "-o, --out <dir>",
    "Directory for the sidecars (default: the index directory)",
  )
  .option(
    "--model <id>",
    "Embedding model id (any id; `mock` for offline runs)",
  )
  .option("--dtype <dtype>", "Weight quantization (default q8)")
  .option("--no-cache", "Ignore the vector cache")
  .option(
    "-f, --format <format>",
    `Output: ${KG_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      index?: string;
      out?: string;
      model?: string;
      dtype?: string;
      cache?: boolean;
      format: KgFormat;
    }) => {
      try {
        const report = await runEmbed({
          ...opts,
          noCache: opts.cache === false,
        });
        console.log(renderEmbed(report, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("export")
  .description(
    "Reserialize the built graph into a consumer format (jsonld file, iirds package, or search index)",
  )
  // The target is a positional, not `-f`: `-f` is the output format in every
  // other verb of the family (0051 §2), and one flag cannot mean two things.
  .argument("<target>", `What to write: ${EXPORT_TARGETS.join(" | ")}`)
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-o, --out <path>",
    "Output path (default: the graph path with the target's extension)",
  )
  .action(
    async (
      target: string,
      opts: { config?: string; graph?: string; out?: string },
    ) => {
      try {
        if (!(EXPORT_TARGETS as readonly string[]).includes(target)) {
          throw new KgError(
            `Unknown export target "${target}". Use ${EXPORT_TARGETS.join(" | ")}.`,
          );
        }
        const result = await runExport({
          config: opts.config,
          graph: opts.graph,
          format: target as ExportFormat,
          out: opts.out,
        });
        for (const warning of result.warnings) warn(warning);
        console.log(
          `Wrote ${result.nodes} node${result.nodes === 1 ? "" : "s"} to ${result.outPath}`,
        );
      } catch (e) {
        fail(e);
      }
    },
  );

return program;
}
