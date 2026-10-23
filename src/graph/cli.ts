/**
 * The graph program. Named `graph` because that is where it is mounted
 * (`manni graph …`); `src/cli.ts` adds it to the umbrella and runs it.
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
import {
  collect,
  configOption,
  readStdin,
  splitList,
} from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { noticeOnce, warn } from "../shared/warn.js";
import { GraphError } from "./types.js";
import { LOCAL_FLAG_HELP } from "../shared/providers.js";
import { ALL_FILL_FIELDS, type FillField } from "./core/config.js";
import {
  assertInputFormat,
  DEFAULT_EXTENSIONS,
  STDIN,
} from "./core/discover.js";
import {
  CHECK_FORMATS,
  CHECK_FORMAT_LIST,
  GRAPH_FORMATS,
  GRAPH_FORMAT_LIST,
  SHAPES_SHOW_FORMATS,
  SHAPES_SHOW_FORMAT_LIST,
  type CheckFormat,
  type GraphFormat,
} from "./reporters/index.js";
import { runBuild } from "./commands/build.js";
import { renderCheck, runCheck } from "./commands/check.js";
import {
  renderShapes,
  renderShapesShow,
  runShapes,
  runShapesShow,
  type ShapesOptions,
} from "./commands/shapes.js";
import {
  EXPORT_TARGETS,
  runExport,
  type ExportFormat,
} from "./commands/export.js";
import { renderQuery, runQuery } from "./commands/query.js";
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
import {
  renderBundle,
  renderLookup,
  runLookup,
  runRetrieve,
  runTraverseContext,
} from "./commands/retrieve.js";
import { runServe } from "./commands/serve.js";
import { renderPublish, runPublish } from "./commands/publish.js";
import type { WithholdReason } from "./runtime/chunks.js";
import type { RetrieveMode, WhereCondition } from "./runtime/retrieve.js";

/**
 * Whether `command`'s output gets colour: this domain's `--no-color` and
 * `NO_COLOR` turn it off, and otherwise only a TTY turns it on
 * (`shouldColor`). `isTTY` is passed uncoerced: Node leaves it undefined off
 * a terminal, never false, and `shouldColor` reads a missing one as "not a
 * terminal".
 *
 * Exported because this is where the decision is testable — a spawned bin is
 * never a TTY. `check`'s pretty output dims the lines under each finding, and
 * takes the boolean from here rather than consulting the environment itself.
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
 * the `graph` program, wherever it is mounted. Not the root: under the umbrella
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
  .name("graph")
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
      throw new GraphError(`${flag} expects a number, got "${raw}".`);
    }
    if (integer && !Number.isInteger(value)) {
      throw new GraphError(`${flag} expects a whole number, got ${value}.`);
    }
    if (value < min || (max !== undefined && value > max)) {
      const range = max === undefined ? `>= ${min}` : `${min}..${max}`;
      throw new GraphError(`${flag} must be ${range}, got ${value}.`);
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
      throw new GraphError(
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
      throw new GraphError(`Unknown ${flag} "${raw}". Use ${allowed.join(" | ")}.`);
    }
    return raw as T;
  };
}

/** `-f, --format`: every verb's list is `pretty | json` (0051 §2). */
const formatOption = choiceOption("--format", GRAPH_FORMATS);

/** `check`'s own, which adds the two CI formats, `github` and `sarif`. */
const checkFormatOption = choiceOption("--format", CHECK_FORMATS);

/** `shapes show`'s own, which adds the frontmatter skeleton. */
const showFormatOption = choiceOption("--format", SHAPES_SHOW_FORMATS);

/**
 * `--fields <list>`: comma-separated and given once, never repeatable — one
 * separator per list (proposal 0034), and the spelling `meta fill --fields`
 * already uses. Each value is held to the same list `fill.fields` is.
 */
const fieldsOption = (raw: string): FillField[] =>
  splitList(raw).map((value) => enumOption("--fields", ALL_FILL_FIELDS)(value));

/**
 * `--withhold <list>`: comma-separated and given once, each value one of the
 * reasons `graph.retrieve.withhold` takes. It only ever tightens the floor.
 */
const withholdOption = (raw: string): WithholdReason[] =>
  splitList(raw).map((value) => {
    if (value !== "drifted" && value !== "failing") {
      throw new GraphError(`--withhold takes drifted or failing, and got ${value}.`);
    }
    return value;
  });

/**
 * `--where <field=value>`: one condition per occurrence, never split on
 * commas, since a value may hold one. Conditions combine with AND.
 */
const whereOption = (raw: string, prev: WhereCondition[]): WhereCondition[] => {
  const eq = raw.indexOf("=");
  const field = eq < 0 ? "" : raw.slice(0, eq);
  const value = eq < 0 ? "" : raw.slice(eq + 1);
  if (field === "" || value === "") {
    throw new GraphError(`--where takes field=value, and got ${raw}.`);
  }
  return [...prev, { field, value }];
};

/** The plumbing a served verb takes, and nothing else: where the artifact is. */
function artifactInputs(command: Command): Command {
  return command
    .option("-c, --config <path>", "Path to manni.config.yaml")
    .option("--no-config", "Ignore any discovered config file")
    .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
    .option(
      "-i, --index <dir>",
      "Directory holding chunks.json, its rows and the search index (default: beside the graph)",
    )
    .option(
      "-f, --format <format>",
      `Output: ${GRAPH_FORMAT_LIST}`,
      formatOption,
      "pretty",
    );
}

/**
 * The document-set surface the verbs that read documents share (proposals
 * 0041 and 0051 §1): positional `[paths...]` with `-` for stdin,
 * `--collection` and `--exclude` (each one value per occurrence), `--as`,
 * `--ext` (comma-separated, given once), `--allow-empty`, and
 * `-c`/`--no-config`. Declared once so the verbs cannot drift apart on a name
 * or a description, and worded as `meta` and `lint` word them.
 */
function documentInputs(command: Command, verb: string): Command {
  return command
    .argument(
      "[paths...]",
      `files, directories, or globs to ${verb} (use - for stdin)`,
    )
    .option(
      "--collection <name>",
      "Configured collection to read (repeatable)",
      collect,
      [],
    )
    .option("--exclude <glob>", "Glob to exclude (repeatable)", collect, [])
    .option(
      "--as <format>",
      "Parse every input as asciidoc, html, markdown, mdx, rst or xml, whatever its extension. Required with -.",
    )
    .option(
      "--ext <list>",
      "comma-separated extensions for directory walks",
      DEFAULT_EXTENSIONS.join(","),
    )
    .option("--allow-empty", "treat zero matched files as success")
    .option("-c, --config <path>", "Path to manni.config.yaml")
    .option("--no-config", "Ignore any discovered config file");
}

/** The input flags as commander hands them over. */
interface InputFlags {
  as?: string;
  ext: string;
  allowEmpty?: boolean;
}

/**
 * The input flags for a core, and stdin when `paths` holds `-`. `--as` is
 * checked first, so `-` without it is refused before anything waits on stdin.
 */
async function inputOptions(
  paths: string[],
  opts: InputFlags,
): Promise<{
  as?: string;
  ext: string[];
  allowEmpty?: boolean;
  stdinContent?: string;
}> {
  assertInputFormat(paths, opts.as);
  return {
    ...(opts.as === undefined ? {} : { as: opts.as }),
    ext: splitList(opts.ext),
    ...(opts.allowEmpty === true ? { allowEmpty: true } : {}),
    ...(paths.includes(STDIN) ? { stdinContent: await readStdin() } : {}),
  };
}

/**
 * `-c`/`--no-config` for a verb that reads a built graph rather than a
 * document set. They share one commander attribute, which `configOption`
 * splits.
 */
function configInputs(command: Command): Command {
  return command
    .option("-c, --config <path>", "Path to manni.config.yaml")
    .option("--no-config", "Ignore any discovered config file");
}

/**
 * `opts` minus the one attribute `-c` and `--no-config` share. `documentOptions`
 * restates it as the two fields a core reads, and spreading the raw value over
 * them would put commander's `false` back where a path belongs.
 */
function rest<T extends { config?: string | boolean }>(
  opts: T,
): Omit<T, "config"> {
  const { config, ...others } = opts;
  return others;
}

/** The shared options as the command cores take them. */
function documentOptions(opts: {
  collection?: string[];
  exclude?: string[];
  config?: string | boolean;
}): {
  config?: string;
  noConfig?: boolean;
  collection?: string[];
  exclude?: string[];
} {
  const { configPath, noConfig } = configOption(opts.config);
  return {
    ...(configPath === undefined ? {} : { config: configPath }),
    ...(noConfig === true ? { noConfig } : {}),
    ...(opts.collection === undefined ? {} : { collection: opts.collection }),
    ...(opts.exclude === undefined ? {} : { exclude: opts.exclude }),
  };
}

program
  .command("init")
  .description("Add a starter `graph:` section to manni.config.yaml in the current directory")
  .action(async () => {
    try {
      console.log(`Created ${await runInit()}`);
    } catch (e) {
      fail(e);
    }
  });

documentInputs(
  program
    .command("build")
    .description("Derive the knowledge graph and write deterministic Turtle"),
  "build",
)
  .option("-o, --out <path>", "Output .ttl path (default: config out)")
  .action(async (paths: string[], opts: InputFlags & {
    config?: string | boolean;
    collection?: string[];
    exclude?: string[];
    out?: string;
  }) => {
    try {
      const result = await runBuild({
        paths,
        ...documentOptions(opts),
        ...(await inputOptions(paths, opts)),
        out: opts.out,
      });
      // Warnings go to stderr so stdout stays the machine-readable summary;
      // a degraded build is still a successful one, so the exit code is 0.
      for (const warning of result.warnings) warn(warning);
      const { total, fromTermbase } = result.concepts;
      const termbase = fromTermbase > 0 ? ` (${fromTermbase} from the termbase)` : "";
      console.log(
        `Wrote ${result.outPath} (${result.docs} docs, ${result.quads} triples, ${total} concepts${termbase})`,
      );
    } catch (e) {
      fail(e);
    }
  });

configInputs(
  program
    .command("check")
    .description(
      "Validate the built graph against the bundled SHACL shapes (errors exit 1)",
    ),
)
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
    `Output: ${CHECK_FORMAT_LIST}`,
    checkFormatOption,
    "pretty",
  )
  .action(
    async (
      opts: {
        config?: string | boolean;
        graph?: string;
        shapes: string[];
        format: CheckFormat;
      },
      command: Command,
    ) => {
      try {
        const report = await runCheck({ ...rest(opts), ...documentOptions(opts) });
        console.log(
          renderCheck(report, opts.format, {
            color: colorFor(command, process.stdout.isTTY),
          }),
        );
        process.exitCode = report.exitCode;
      } catch (e) {
        fail(e);
      }
    },
  );

/**
 * The value of a flag `shapes` and `shapes show` both declare. Commander keeps
 * parsing a parent's options past a subcommand name, so `shapes show X -f
 * markdown` sets `format` on `shapes`. The nearest command given the flag
 * wins, and the subcommand's own default is the fallback, as lint reads its
 * `templates` flags. So neither declaration checks its value as it parses,
 * and the action checks the one that applies.
 */
function optionValue(command: Command, key: string): unknown {
  for (let cmd: Command | null = command; cmd !== null; cmd = cmd.parent) {
    if (cmd.getOptionValueSource(key) === "cli") return cmd.getOptionValue(key);
  }
  return command.getOptionValue(key);
}

/** The options `shapes` and `shapes show` share, as the cores take them. */
function shapesOptions(command: Command): ShapesOptions {
  const { configPath, noConfig } = configOption(optionValue(command, "config"));
  const shapes = optionValue(command, "shapes");
  return {
    ...(configPath === undefined ? {} : { config: configPath }),
    ...(noConfig === true ? { noConfig } : {}),
    ...(Array.isArray(shapes) ? { shapes: shapes.map(String) } : {}),
  };
}

/** `--shapes`, worded as `check` words it. */
function shapesInput(command: Command): Command {
  return command.option(
    "--shapes <path>",
    "Shapes .ttl file; repeatable (default: config check.shapes, then bundled)",
    collect,
    [],
  );
}

const shapesCommand = shapesInput(
  configInputs(
    program
      .command("shapes")
      .description("List the SHACL node shapes `graph check` runs, and what each one targets"),
  ),
)
  .option("-f, --format <format>", `Output: ${GRAPH_FORMAT_LIST}`, "pretty")
  .action((_opts: unknown, command: Command) => {
    try {
      const format = formatOption(String(optionValue(command, "format")));
      console.log(renderShapes(runShapes(shapesOptions(command)), format));
    } catch (e) {
      fail(e);
    }
  });

shapesInput(
  configInputs(
    shapesCommand
      .command("show")
      .description(
        "Print every property a shape checks and the frontmatter key that feeds it",
      )
      .argument("<shape>", "Node shape to show, by local name, such as DocumentShape"),
  ),
)
  .option("-f, --format <format>", `Output: ${SHAPES_SHOW_FORMAT_LIST}`, "pretty")
  .action((shape: string, _opts: unknown, command: Command) => {
    try {
      const format = showFormatOption(String(optionValue(command, "format")));
      console.log(renderShapesShow(runShapesShow(shape, shapesOptions(command)), format));
    } catch (e) {
      fail(e);
    }
  });

documentInputs(
  program
    .command("fill")
    .description(
      "Propose `graph:` fields and sample questions with an LLM, gated by confidence, and write them back",
    ),
  "fill",
)
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .option("--dry-run", "Report proposals without writing files")
  .option("--force", "Overwrite human-set graph fields")
  .option("--no-cache", "Bypass the proposal cache")
  .option("--no-validate-graph", "Skip the SHACL graph guardrail on proposals")
  .option("--sections", "Also propose per-section metadata")
  .option(
    "--max-turns <n>",
    "Stop after this many inference calls (a cached page costs none)",
    countOption("--max-turns"),
  )
  .option(
    "--confidence <n>",
    "Minimum model confidence (0..1) to write a field (default: config, 0.7)",
    numericOption("--confidence", { min: 0, max: 1 }),
  )
  .option(
    // Comma-separated and given once: one separator per list (proposal 0034).
    "--fields <list>",
    `Fields to propose (comma-separated; default: config, then every field)`,
    fieldsOption,
  )
  // The nameable providers, and `auto`. `mock` is the library's test double:
  // accepted when asked for by name, never offered.
  .option(
    "--provider <name>",
    "Provider: auto (default) | anthropic | openai | claude-cli | llama-cpp",
  )
  .option("--model <model>", "Model override; needs a named provider, from here or config")
  .option("--local", LOCAL_FLAG_HELP)
  .option(
    "--offline",
    "no network egress: only a model already downloaded, never a remote provider",
  )
  .option(
    "--chunk-chars <n>",
    "characters of page per question request (default: config, then 12000)",
    countOption("--chunk-chars"),
  )
  // Typed inline, as every other action in this file is. The option parsers
  // above (`numericOption`, `choiceOption`, `fieldsOption`) have already thrown
  // on anything malformed by the time this runs, so a cast per field would be
  // safe — but it would also be the one command with the most options and the
  // least help from the compiler.
  .action(async (paths: string[], opts: InputFlags & {
    config?: string | boolean;
    collection?: string[];
    exclude?: string[];
    dryRun?: boolean;
    force?: boolean;
    cache?: boolean;
    validateGraph?: boolean;
    sections?: boolean;
    maxTurns?: number;
    confidence?: number;
    fields?: FillField[];
    provider?: string;
    model?: string;
    local?: boolean;
    offline?: boolean;
    chunkChars?: number;
    format: GraphFormat;
  }) => {
    try {
      const report = await runFill({
        paths,
        ...documentOptions(opts),
        ...(await inputOptions(paths, opts)),
        dryRun: opts.dryRun,
        force: opts.force,
        noCache: opts.cache === false,
        noValidateGraph: opts.validateGraph === false,
        sections: opts.sections,
        maxTurns: opts.maxTurns,
        confidence: opts.confidence,
        fields: opts.fields,
        provider: opts.provider,
        model: opts.model,
        local: opts.local,
        offline: opts.offline,
        chunkChars: opts.chunkChars,
      });
      // Same channel discipline as build: warnings on stderr, so stdout stays
      // the report, and a warning never changes the exit code.
      for (const warning of report.warnings) warn(warning);
      const rendered = renderFill(report, opts.format);
      if (paths.includes(STDIN)) {
        // With `-` the filled document owns stdout, as under `meta fill -`,
        // and the report in either format is a diagnostic on stderr.
        if (report.stdinDocument !== undefined) {
          process.stdout.write(report.stdinDocument);
        }
        if (rendered.length > 0) process.stderr.write(`${rendered}\n`);
      } else {
        console.log(rendered);
      }
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
  // Long-only, and named for the triple position each one fills. `-o` is
  // `--out` on every other graph verb and `-s` is meta's schema flag; a
  // one-letter spelling that means two things in one family costs more than
  // the letters it saves.
  .option("--subject <term>", "Subject IRI or prefixed name")
  .option("--predicate <term>", "Predicate IRI or prefixed name")
  .option("--object <term>", "Object IRI, prefixed name, or literal value")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--no-config", "Ignore any discovered config file")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    (opts: {
      subject?: string;
      predicate?: string;
      object?: string;
      config?: string | boolean;
      graph?: string;
      format: GraphFormat;
    }) => {
      try {
        const { subject, predicate, object, ...others } = rest(opts);
        const result = runQuery({
          ...others,
          ...documentOptions(opts),
          ...(subject === undefined ? {} : { s: subject }),
          ...(predicate === undefined ? {} : { p: predicate }),
          ...(object === undefined ? {} : { o: object }),
        });
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
  .option("--no-config", "Ignore any discovered config file")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
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
      config?: string | boolean;
      graph?: string;
      format: GraphFormat;
      check?: boolean;
      top?: number;
      coverageThreshold?: number;
    }) => {
      try {
        const report = runStats({ ...rest(opts), ...documentOptions(opts) });
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
  .option("--no-config", "Ignore any discovered config file")
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
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (
      query: string,
      opts: {
        config?: string | boolean;
        graph?: string;
        index?: string;
        lang?: string;
        limit?: number;
        vectors?: string;
        mode?: SearchMode;
        format: GraphFormat;
      },
    ) => {
      try {
        const report = await runSearch({
          ...rest(opts),
          ...documentOptions(opts),
          query,
        });
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
  .option("--no-config", "Ignore any discovered config file")
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
  // Not `--subject`: on `query` that is a triple's subject, and one flag name
  // means one thing across the domain.
  .option("--software-subject <subject>", "Scope filter: software subject")
  .option("--lang <tag>", "Scope filter: BCP-47 language tag, matched in any case")
  .option("--limit <n>", "Stop after this many nodes", countOption("--limit"))
  .option(
    "--context",
    "Return the passages the walk reaches, with their text and proof, from the chunk artifact beside the graph",
  )
  .option(
    "--max-chars <n>",
    "Character budget for the passages (with --context; default: config retrieve.maxChars)",
    countOption("--max-chars"),
  )
  .option(
    "--withhold <list>",
    "Also leave out passages that are drifted or failing, comma-separated (with --context)",
    withholdOption,
  )
  .option(
    "--where <field=value>",
    "Only passages whose metadata field holds the value, or a list field containing it (repeatable; all must hold; with --context)",
    whereOption,
    [],
  )
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (
      node: string,
      opts: {
        config?: string | boolean;
        graph?: string;
        depth?: number;
        predicates?: string;
        reverse?: boolean;
        impact?: boolean;
        variant?: string;
        softwareSubject?: string;
        lang?: string;
        limit?: number;
        context?: boolean;
        maxChars?: number;
        withhold?: WithholdReason[];
        where: WhereCondition[];
        format: GraphFormat;
      },
    ) => {
      try {
        const { softwareSubject, context, maxChars, withhold, where, ...others } = rest(opts);
        const inputs = {
          ...others,
          ...documentOptions(opts),
          ...(softwareSubject === undefined ? {} : { subject: softwareSubject }),
          node,
          predicates:
            opts.predicates === undefined
              ? undefined
              : splitList(opts.predicates),
        };
        if (context !== true) {
          if (maxChars !== undefined) throw new GraphError("--max-chars needs --context.");
          if (withhold !== undefined) throw new GraphError("--withhold needs --context.");
          if (where.length > 0) throw new GraphError("--where needs --context.");
          console.log(renderTraverse(runTraverse(inputs), opts.format));
          return;
        }
        const bundle = await runTraverseContext({
          ...inputs,
          ...(maxChars === undefined ? {} : { maxChars }),
          ...(withhold === undefined ? {} : { withhold }),
          ...(where.length === 0 ? {} : { where }),
        });
        console.log(renderBundle(bundle, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

artifactInputs(
  program
    .command("lookup")
    .description(
      "Answer a question from the chunk artifact: every ranked match, everything reached outward, and everything that depends on them",
    )
    .argument("<question>", "The question, in quotes"),
).action(
  async (
    question: string,
    opts: { config?: string | boolean; graph?: string; index?: string; format: GraphFormat },
  ) => {
    try {
      const { format, ...others } = rest(opts);
      const { result, settings } = await runLookup({ ...others, ...documentOptions(opts), question });
      console.log(renderLookup(result, format, settings));
    } catch (e) {
      fail(e);
    }
  },
);

artifactInputs(
  program
    .command("retrieve")
    .description("Retrieve passages for a question, with control over language, scope, depth and budget")
    .argument("<question>", "The question, in quotes"),
)
  .option("--lang <tag>", "The localization (required when the corpus has more than one)")
  .option("--variant <variant>", "Scope filter: product variant IRI, title, or slug")
  .option("--software-subject <subject>", "Scope filter: software subject")
  .option(
    "--mode <mode>",
    `Which legs to run: ${SEARCH_MODES.join(" | ")} (default: hybrid when the rows carry vectors)`,
    choiceOption("--mode", SEARCH_MODES),
  )
  .option("--seeds <n>", "Ranked matches the walk starts from (default: config retrieve.seeds)", countOption("--seeds"))
  .option(
    "-d, --depth <n>",
    "Hops out from each match (default: config retrieve.depth)",
    countOption("--depth", 0),
  )
  .option(
    "--max-chars <n>",
    "Character budget for the passages (default: config retrieve.maxChars)",
    countOption("--max-chars"),
  )
  .option(
    "--withhold <list>",
    "Also leave out passages that are drifted or failing, comma-separated",
    withholdOption,
  )
  .option(
    "--where <field=value>",
    "Only passages whose metadata field holds the value, or a list field containing it (repeatable; all must hold)",
    whereOption,
    [],
  )
  .action(
    async (
      question: string,
      opts: {
        config?: string | boolean;
        graph?: string;
        index?: string;
        lang?: string;
        variant?: string;
        softwareSubject?: string;
        mode?: RetrieveMode;
        seeds?: number;
        depth?: number;
        maxChars?: number;
        withhold?: WithholdReason[];
        where: WhereCondition[];
        format: GraphFormat;
      },
    ) => {
      try {
        const { softwareSubject, format, where, ...others } = rest(opts);
        const bundle = await runRetrieve({
          ...others,
          ...documentOptions(opts),
          ...(softwareSubject === undefined ? {} : { subject: softwareSubject }),
          ...(where.length === 0 ? {} : { where }),
          question,
        });
        console.log(renderBundle(bundle, format));
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("serve")
  .description(
    "Serve lookup, retrieve, traverse and impact to an agent over MCP on stdio, from the chunk artifact, until stdin closes",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--no-config", "Ignore any discovered config file")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-i, --index <dir>",
    "Directory holding chunks.json, its rows and the search index (default: beside the graph)",
  )
  .option(
    "--withhold <list>",
    "Also leave out passages that are drifted or failing, comma-separated, on every call",
    withholdOption,
  )
  .option(
    "--publish",
    "Publish the graph first when its artifact is missing or older than the checkout, and again after the checkout changes",
  )
  .action(
    async (opts: {
      config?: string | boolean;
      graph?: string;
      index?: string;
      withhold?: WithholdReason[];
      publish?: boolean;
    }) => {
      try {
        process.exitCode = await runServe({ ...rest(opts), ...documentOptions(opts) });
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
  .option("--no-config", "Ignore any discovered config file")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-i, --index <dir>",
    "Directory holding the indexes and manifest (default: beside the graph)",
  )
  .option(
    "-o, --out <dir>",
    "Directory for the sidecars (default: the index directory)",
  )
  // Not `--model`: on `fill` that is the inference model, a different thing.
  .option(
    "--embedding-model <id>",
    "Embedding model id (any id; `mock` for offline runs)",
  )
  .option("--dtype <dtype>", "Weight quantization (default q8)")
  .option("--no-cache", "Ignore the vector cache")
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (opts: {
      config?: string | boolean;
      graph?: string;
      index?: string;
      out?: string;
      embeddingModel?: string;
      dtype?: string;
      cache?: boolean;
      format: GraphFormat;
    }) => {
      try {
        const { embeddingModel, ...others } = rest(opts);
        const report = await runEmbed({
          ...others,
          ...documentOptions(opts),
          ...(embeddingModel === undefined ? {} : { model: embeddingModel }),
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
    "Reserialize the built graph into a consumer format (jsonld file, iirds package, search index, question set, chunks with their provenance, or llms.txt)",
  )
  // The target is a positional, not `-f`: `-f` is the output format in every
  // other verb of the family (0051 §2), and one flag cannot mean two things.
  .argument("<target>", `What to write: ${EXPORT_TARGETS.join(" | ")}`)
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--no-config", "Ignore any discovered config file")
  .option("-g, --graph <path>", "Graph .ttl path (default: config out)")
  .option(
    "-o, --out <path>",
    "Output path (default: the graph path with the target's extension); a directory for search and chunks",
  )
  .option("--evals <path>", "A docevals JSON report for chunks (default: config export.chunks.evals)")
  .action(
    async (
      target: string,
      opts: { config?: string | boolean; graph?: string; out?: string; evals?: string },
    ) => {
      try {
        if (!(EXPORT_TARGETS as readonly string[]).includes(target)) {
          throw new GraphError(
            `Unknown export target "${target}". Use ${EXPORT_TARGETS.join(" | ")}.`,
          );
        }
        const result = await runExport({
          ...documentOptions(opts),
          graph: opts.graph,
          format: target as ExportFormat,
          out: opts.out,
          ...(opts.evals === undefined ? {} : { evals: opts.evals }),
        });
        for (const warning of result.warnings) warn(warning);
        for (const said of result.notices ?? []) noticeOnce(said);
        const noun =
          result.format === "questions"
            ? "question"
            : result.format === "chunks"
              ? "chunk"
              : result.format === "llms"
                ? "page"
                : "node";
        console.log(
          `Wrote ${result.nodes} ${noun}${result.nodes === 1 ? "" : "s"} to ${result.outPath}`,
        );
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("publish")
  .description(
    "Build, embed when configured, and export everything serving needs into one directory",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--no-config", "Ignore any discovered config file")
  .option("-o, --out <dir>", "Directory for every artifact (default: the directory of config out)")
  .option("--evals <path>", "A docevals JSON report for the chunks (default: config export.chunks.evals)")
  .option(
    "-f, --format <format>",
    `Output: ${GRAPH_FORMAT_LIST}`,
    formatOption,
    "pretty",
  )
  .action(
    async (opts: { config?: string | boolean; out?: string; evals?: string; format: GraphFormat }) => {
      try {
        const report = await runPublish({
          ...documentOptions(opts),
          ...(opts.out === undefined ? {} : { out: opts.out }),
          ...(opts.evals === undefined ? {} : { evals: opts.evals }),
          say: (kind, message) => {
            if (kind === "notice") noticeOnce(message);
            else warn(message);
          },
        });
        console.log(renderPublish(report, opts.format));
      } catch (e) {
        fail(e);
      }
    },
  );

return program;
}
