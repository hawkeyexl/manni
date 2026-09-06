/**
 * The kg program. Named `kg` because that is where it is mounted
 * (`manni kg …`); `src/cli.ts` adds it to the umbrella and runs it.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { programName } from "../shared/program-name.js";
import pc from "picocolors";
import { DockgError } from "./types.js";
import { PROVIDER_NAMES } from "./core/config.js";
import { runBuild } from "./commands/build.js";
import { renderCheck, runCheck } from "./commands/check.js";
import { runExport, type ExportFormat } from "./commands/export.js";
import { renderQuery, runQuery } from "./commands/query.js";
import { renderValidate, runValidate } from "./commands/validate.js";
import { renderFill, runFill } from "./commands/fill.js";
import { runInit } from "./commands/init.js";
import { renderEmbed, runEmbed } from "./commands/embed.js";
import { renderSearch, runSearch } from "./commands/search.js";
import { renderStats, runStats } from "./commands/stats.js";
import { renderTraverse, runTraverse } from "./commands/traverse.js";

export function buildProgram(): Command {
const program = new Command();

program
  .name("kg")
  .description(
    "Deterministic knowledge graphs derived from documentation frontmatter and formatting.",
  )
  .version(pkg.version);

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
      throw new DockgError(`${flag} expects a number, got "${raw}".`);
    }
    if (integer && !Number.isInteger(value)) {
      throw new DockgError(`${flag} expects a whole number, got ${value}.`);
    }
    if (value < min || (max !== undefined && value > max)) {
      const range = max === undefined ? `>= ${min}` : `${min}..${max}`;
      throw new DockgError(`${flag} must be ${range}, got ${value}.`);
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
      throw new DockgError(
        `${flag} must be one of ${allowed.join(" | ")}, got "${raw}".`,
      );
    }
    return raw as T;
  };
}

function fail(e: unknown): never {
  if (e instanceof DockgError) {
    console.error(pc.red(`${programName()}: ${e.message}`));
    process.exit(2);
  }
  throw e;
}

program
  .command("init")
  .description("Add a starter `kg:` section to manni.config.yaml in the current directory")
  .action(() => {
    try {
      console.log(`Created ${runInit()}`);
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
      for (const warning of result.warnings) {
        console.error(pc.yellow(`${programName()}: ${warning}`));
      }
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
  .option(
    "--shapes <paths...>",
    "Shapes .ttl files (default: config check.shapes, then bundled)",
  )
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      shapes?: string[];
      format: string;
    }) => {
      try {
        const report = await runCheck(opts);
        console.log(renderCheck(report, opts.format as "pretty" | "json"));
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
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    async (globs: string[], opts: { config?: string; format: string }) => {
      try {
        const result = await runValidate({ globs, config: opts.config });
        console.log(renderValidate(result, opts.format as "pretty" | "json"));
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
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
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
      for (const warning of report.warnings) {
        console.error(pc.yellow(`${programName()}: ${warning}`));
      }
      console.log(renderFill(report, opts.format as "pretty" | "json"));
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
  .option("-s, --s <term>", "Subject IRI or prefixed name")
  .option("-p, --p <term>", "Predicate IRI or prefixed name")
  .option("-o, --o <term>", "Object IRI, prefixed name, or literal value")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    (opts: {
      s?: string;
      p?: string;
      o?: string;
      config?: string;
      graph?: string;
      format: string;
    }) => {
      try {
        const result = runQuery(opts);
        console.log(renderQuery(result, opts.format as "pretty" | "json"));
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
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
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
      format: string;
      check?: boolean;
      top?: number;
      coverageThreshold?: number;
    }) => {
      try {
        const report = runStats(opts);
        console.log(renderStats(report, opts.format as "pretty" | "json"));
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("search")
  .description(
    "Rank graph nodes for a text query (needs `export --format search`)",
  )
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
    "Which legs to run: lexical | vector | hybrid (default: hybrid when vectors exist)",
  )
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
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
        mode?: "lexical" | "vector" | "hybrid";
        format: string;
      },
    ) => {
      try {
        const report = await runSearch({ ...opts, query });
        console.log(renderSearch(report, opts.format as "pretty" | "json"));
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
  .option("--predicates <curies...>", "Only follow these predicates")
  .option("--reverse", "Follow inbound edges (who points at this node)")
  .option("--impact", "Transitive inbound reach: what a change here affects")
  .option(
    "--variant <variant>",
    "Scope filter: product variant IRI, title, or slug",
  )
  .option("--subject <subject>", "Scope filter: software subject")
  .option("--lang <tag>", "Scope filter: BCP-47 language tag, matched exactly")
  .option("--limit <n>", "Stop after this many nodes", countOption("--limit"))
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    (
      node: string,
      opts: {
        config?: string;
        graph?: string;
        depth?: number;
        predicates?: string[];
        reverse?: boolean;
        impact?: boolean;
        variant?: string;
        subject?: string;
        lang?: string;
        limit?: number;
        format: string;
      },
    ) => {
      try {
        const report = runTraverse({ ...opts, node });
        console.log(renderTraverse(report, opts.format as "pretty" | "json"));
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
  .option("-f, --format <format>", "Output format: pretty | json", "pretty")
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      index?: string;
      out?: string;
      model?: string;
      dtype?: string;
      cache?: boolean;
      format: string;
    }) => {
      try {
        const report = await runEmbed({
          ...opts,
          noCache: opts.cache === false,
        });
        console.log(renderEmbed(report, opts.format as "pretty" | "json"));
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
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-f, --format <format>",
    "Export format: jsonld | iirds | search",
    "jsonld",
  )
  .option(
    "-o, --out <path>",
    "Output path (default: the graph path with the format's extension)",
  )
  .action(
    async (opts: {
      config?: string;
      graph?: string;
      format: string;
      out?: string;
    }) => {
      try {
        const result = await runExport({
          config: opts.config,
          graph: opts.graph,
          format: opts.format as ExportFormat,
          out: opts.out,
        });
        for (const warning of result.warnings) {
          console.error(pc.yellow(`${programName()}: ${warning}`));
        }
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
