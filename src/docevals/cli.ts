/**
 * The docevals program. Named `docevals` because that is where it is mounted
 * (`manni docevals …`); `src/cli.ts` adds it to the umbrella and runs it.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { programName } from "../shared/program-name.js";
import pc from "picocolors";
import { DocevalsError } from "./types.js";
import { EXECUTION_GRANTS } from "./core/config.js";
import { runList, renderList } from "./commands/list.js";
import { runRun } from "./commands/run.js";
import { runGenerate } from "./commands/generate.js";
import { runFill, renderFill } from "./commands/fill.js";
import { runPromote } from "./commands/promote.js";
import { listReviews, renderReviews, runReview } from "./commands/review.js";
import {
  runCalibrate,
  renderCalibration,
  seedGoldenCases,
} from "./commands/calibrate.js";
import { runInit } from "./commands/init.js";
import {
  render,
  parseFormat,
  REPORT_FORMATS,
  SUMMARY_FORMATS,
  type ReportFormat,
  type SummaryFormat,
} from "./reporters/index.js";

export function buildProgram(): Command {
const program = new Command();

program
  .name("docevals")
  .description(
    "Deterministic and LLM-as-judge evals for documentation pages, driven by frontmatter.",
  )
  .version(pkg.version);

function fail(e: unknown): never {
  if (e instanceof DocevalsError) {
    console.error(pc.red(`${programName()}: ${e.message}`));
    process.exit(2);
  }
  throw e;
}

/**
 * Repeatable execution grant, validated on the way in.
 *
 * An unknown value is a usage error rather than a silent no-op (ADR 01007, the
 * same rule `--format` follows): a mistyped grant that quietly granted nothing
 * would skip every command eval and still exit 0, which reads as "the corpus
 * is clean" rather than "you misspelled a flag".
 */
function collectGrant(value: string, previous: string[]): string[] {
  if (!(EXECUTION_GRANTS as readonly string[]).includes(value)) {
    fail(
      new DocevalsError(
        `--allow-execution must be one of ${EXECUTION_GRANTS.join(" | ")}, got "${value}"`,
      ),
    );
  }
  return [...previous, value];
}

function parseIntArg(name: string) {
  return (value: string): number => {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n) || n < 1) {
      fail(new DocevalsError(`${name} must be a positive integer, got "${value}"`));
    }
    return n;
  };
}

/**
 * Repeatable single-value option, e.g. `--eval a --eval b`.
 *
 * NOT commander's variadic `<name...>`: a variadic consumes every following
 * non-option token, so `run --eval fresh-enough docs/guide.md` parsed the glob
 * as a second eval name and left `globs` empty — silently widening the run to
 * the whole configured corpus, which is the opposite of what selection is for.
 */
function collectArg(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseFloatArg(name: string) {
  return (value: string): number => {
    const n = Number.parseFloat(value);
    if (Number.isNaN(n) || n < 0) {
      fail(new DocevalsError(`${name} must be a non-negative number, got "${value}"`));
    }
    return n;
  };
}

/**
 * Commander argument parser for `-f/--format` (ADR 01007). Routes through
 * `fail()` for the same reason the numeric parsers do: commander only special-
 * cases InvalidArgumentError, so any other exception escapes `program.parse()`
 * uncaught — a stack trace and exit 1, when a bad flag owes exit 2.
 */
function parseFormatArg<T extends string>(name: string, allowed: readonly T[]) {
  return (value: string): T => {
    try {
      return parseFormat(value, allowed, name);
    } catch (e) {
      fail(e);
    }
  };
}

program
  .command("list")
  .description("Show the resolved eval plan per page without running anything")
  .argument("[globs...]", "File globs (default: config files.include)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option(
    "-f, --format <format>",
    "Output format: human | json",
    parseFormatArg("--format", SUMMARY_FORMATS),
    "human" as SummaryFormat,
  )
  .option("--eval <name>", "Show only this eval (repeatable)", collectArg, [])
  .option("--suite <name>", "Show only evals in this suite")
  .action(
    (
      globs: string[],
      opts: {
        config?: string;
        format: SummaryFormat;
        eval?: string[];
        suite?: string;
      },
    ) => {
    try {
      const run = runList(globs, {
        config: opts.config,
        format: opts.format,
        evalNames: opts.eval,
        suite: opts.suite,
      });
      console.log(renderList(run, opts.format));
      process.exitCode = run.exitCode;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("run")
  .description("Run evals against documentation pages")
  .argument("[globs...]", "File globs (default: config files.include)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option(
    "-f, --format <format>",
    "Output format: human | json | markdown | github",
    parseFormatArg("--format", REPORT_FORMATS),
    "human" as ReportFormat,
  )
  .option("--deterministic-only", "Run only command/tool graders, skip the AI judge")
  .option("--ai-only", "Run only AI-judged evals, skip deterministic graders")
  .option(
    // `<kind>`, not `<kind...>`: a variadic option greedily eats the
    // positional `[globs...]` that follow it, so `--allow-execution
    // frontmatter-commands docs/**` would silently swallow the glob and run
    // over the default file set instead. Repeat the flag to grant twice.
    "--allow-execution <kind>",
    "Grant content-authored execution: frontmatter-commands | page-embedded-steps (repeat to grant both)",
    collectGrant,
    [],
  )
  .option("--no-execution", "Clear every execution grant for this run")
  .option("--no-generate", "Do not generate scripts for command evals missing a command")
  .option("--no-cache", "Bypass the judge response cache")
  .option("--fail-on-review", "Exit 1 when any eval lands in the human-review zone")
  .option("--provider <name>", "Judge provider: anthropic | openai | claude-cli | llama-cpp")
  .option("--model <model>", "Judge model override")
  .option("--runs <n>", "Ensemble runs per eval", parseIntArg("--runs"))
  .option(
    "--chunk-chars <n>",
    "Characters of page per judge call; longer pages are read in parts",
    parseIntArg("--chunk-chars"),
  )
  .option(
    "--eval <name>",
    "Run only this eval (repeatable); suite targets are not evaluated on a filtered run",
    collectArg,
    [],
  )
  .option("--suite <name>", "Run only evals in this suite")
  .option(
    "--since <ref>",
    "Evaluate only pages that changed between this git ref and HEAD; corpus-wide graders still see every page",
  )
  .option(
    "--max-turns <n>",
    "Stop after this many ensemble runs (a cached ensemble costs none)",
    parseIntArg("--max-turns"),
  )
  .option(
    "--baseline [path]",
    "Fail only on findings a recorded baseline does not already hold",
  )
  .option("--no-baseline", "Ignore the configured baseline for this run")
  .option(
    "--write-baseline [path]",
    "Record this run's findings as the baseline; without a path, the configured one",
  )
  .action(async (globs: string[], opts: Record<string, unknown>) => {
    try {
      const report = await runRun(globs, {
        config: opts.config as string | undefined,
        // parseFormatArg validated this at parse time; the cast only re-narrows
        // from the `unknown` that the Record-typed options bag erases it to.
        format: opts.format as ReportFormat,
        deterministicOnly: opts.deterministicOnly as boolean | undefined,
        aiOnly: opts.aiOnly as boolean | undefined,
        allowExecution: opts.allowExecution as string[] | undefined,
        execution: opts.execution as boolean | undefined,
        generate: opts.generate as boolean | undefined,
        cache: opts.cache as boolean | undefined,
        failOnReview: opts.failOnReview as boolean | undefined,
        provider: opts.provider as string | undefined,
        model: opts.model as string | undefined,
        runs: opts.runs as number | undefined,
        chunkChars: opts.chunkChars as number | undefined,
        maxTurns: opts.maxTurns as number | undefined,
        evalNames: opts.eval as string[] | undefined,
        suite: opts.suite as string | undefined,
        since: opts.since as string | undefined,
        // commander collapses `--baseline` to true and `--no-baseline` to
        // false on the same key; a string is an explicit path.
        baseline: opts.baseline as string | boolean | undefined,
        writeBaseline: opts.writeBaseline as string | boolean | undefined,
        toolVersion: pkg.version,
      });
      console.log(render(report, opts.format as ReportFormat));
      process.exitCode = report.exitCode;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("generate")
  .description(
    "Generate check scripts for command evals with a plain-language assertion but no command",
  )
  .argument("[globs...]", "File globs (default: config files.include)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--provider <name>", "Provider: anthropic | openai | claude-cli | llama-cpp")
  .option("--model <model>", "Model override")
  .action(
    async (
      globs: string[],
      opts: { config?: string; provider?: string; model?: string },
    ) => {
      try {
        const result = await runGenerate(globs, opts);
        if (result.targets === 0) {
          console.log("Nothing to generate — every command eval has a command.");
          return;
        }
        console.log(
          `Generated ${result.generatedPaths.length}/${result.targets} check script(s):`,
        );
        for (const p of result.generatedPaths) console.log(`  ${p}`);
        if (result.generatedPaths.length < result.targets) {
          process.exitCode = 1;
        }
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("fill")
  .description(
    "Propose frontmatter evals for pages with an LLM; writes proposals at or above the confidence threshold",
  )
  .argument("[globs...]", "File globs (default: config files.include)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option(
    "-f, --format <format>",
    "Output format: human | json",
    parseFormatArg("--format", SUMMARY_FORMATS),
    "human" as SummaryFormat,
  )
  .option("--dry-run", "Report proposals without writing frontmatter")
  .option(
    "--confidence <n>",
    "Minimum confidence to write (0-1, default: config fill.confidenceThreshold)",
    parseFloatArg("--confidence"),
  )
  .option(
    "--max-turns <n>",
    "Stop after this many inference calls (a cached page costs none)",
    parseIntArg("--max-turns"),
  )
  .option("--no-cache", "Bypass the fill proposal cache")
  .option(
    "--chunk-chars <n>",
    "Characters of page per fill call; longer pages are proposed in parts",
    parseIntArg("--chunk-chars"),
  )
  .option("--provider <name>", "Provider: anthropic | openai | claude-cli | llama-cpp")
  .option("--model <model>", "Model override")
  .action(async (globs: string[], opts: Record<string, unknown>) => {
    try {
      const confidence = opts.confidence as number | undefined;
      if (confidence !== undefined && confidence > 1) {
        fail(new DocevalsError(`--confidence must be between 0 and 1, got ${confidence}`));
      }
      const report = await runFill(globs, {
        config: opts.config as string | undefined,
        dryRun: opts.dryRun as boolean | undefined,
        confidence,
        maxTurns: opts.maxTurns as number | undefined,
        noCache: opts.cache === false ? true : undefined,
        provider: opts.provider as string | undefined,
        model: opts.model as string | undefined,
      });
      // As in `run`: parseFormatArg validated this at parse time, and the cast
      // only re-narrows from the `unknown` the Record-typed options bag erases
      // it to. renderFill guards itself regardless.
      console.log(renderFill(report, opts.format as SummaryFormat));
      process.exitCode = report.exitCode;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("promote")
  .description(
    "Find ai-graded evals expressible as deterministic checks; --write converts them",
  )
  .argument("[globs...]", "File globs (default: config files.include)")
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--write", "Apply promotions (write scripts and rewrite evals)")
  .option("--provider <name>", "Provider: anthropic | openai | claude-cli | llama-cpp")
  .option("--model <model>", "Model override")
  .action(
    async (
      globs: string[],
      opts: { config?: string; write?: boolean; provider?: string; model?: string },
    ) => {
      try {
        const proposals = await runPromote(globs, opts);
        if (proposals.length === 0) {
          console.log("No ai-graded evals found.");
          return;
        }
        for (const p of proposals) {
          const tag = p.promotable
            ? p.applied
              ? pc.green("promoted")
              : pc.cyan("promotable")
            : pc.dim("keep-ai");
          const script = p.scriptPath ? pc.dim(` -> ${p.scriptPath}`) : "";
          console.log(`${tag} ${p.evalName} (${p.source}, ${p.file})${script}`);
          console.log(pc.dim(`  ${p.rationale}`));
        }
        if (!opts.write && proposals.some((p) => p.promotable)) {
          console.log(pc.cyan("\nRe-run with --write to apply promotions."));
        }
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("calibrate")
  .description(
    "Measure judge agreement against a human-verified golden set (.manni/docevals/golden/*.yaml)",
  )
  .option("-c, --config <path>", "Path to manni.config.yaml")
  .option("--golden <dir>", "Golden set directory", ".manni/docevals/golden")
  .option(
    "--seed",
    "Write golden candidates from recorded reviews and exit; judges nothing, needs no provider",
  )
  .option("--provider <name>", "Provider: anthropic | openai | claude-cli | llama-cpp")
  .option("--model <model>", "Model override")
  .option("--runs <n>", "Ensemble runs per case", parseIntArg("--runs"))
  .option(
    "--max-turns <n>",
    "Stop after this many ensemble runs (a cached ensemble costs none)",
    parseIntArg("--max-turns"),
  )
  .option("--no-cache", "Bypass the judge response cache")
  .action(
    async (opts: {
      config?: string;
      golden?: string;
      seed?: boolean;
      provider?: string;
      model?: string;
      runs?: number;
      maxTurns?: number;
      cache?: boolean;
    }) => {
      try {
        if (opts.seed) {
          // No `config`: reviews.yaml and the golden directory both resolve
          // against the working directory, not the config's, so passing it
          // would imply an influence it does not have.
          const seeded = seedGoldenCases({ golden: opts.golden });
          if (seeded.total === 0) {
            console.log(
              "No recorded reviews to seed from — run `manni docevals review <file> <eval> <pass|fail>` first.",
            );
            return;
          }
          // The lead number is what moved, not the file's size: `total`
          // counts cases already confirmed and left alone, so leading with it
          // read as "wrote 8 candidates" on a re-seed that wrote none.
          const changed = seeded.added + seeded.updated;
          console.log(
            changed === 0
              ? `No new reviews to seed — ${seeded.total} golden case(s) already in ${seeded.path}.`
              : `Wrote ${changed} golden candidate(s) to ${seeded.path} ` +
                `(${seeded.added} new, ${seeded.updated} updated; ${seeded.total} total).`,
          );
          if (seeded.unreviewed > 0) {
            console.log(
              pc.yellow(
                `${seeded.unreviewed} case(s) are \`reviewed: false\`. Read them and set ` +
                  "`reviewed: true` — a golden set assembled without a human is not one.",
              ),
            );
          }
          return;
        }
        const report = await runCalibrate({
          config: opts.config,
          golden: opts.golden,
          provider: opts.provider,
          model: opts.model,
          runs: opts.runs,
          maxTurns: opts.maxTurns,
          noCache: opts.cache === false,
        });
        console.log(renderCalibration(report));
        // Both conditions: the judge has to agree enough, AND the set has to
        // have been measured. A stale golden file whose pages were renamed
        // used to certify on whatever still resolved.
        process.exitCode =
          report.meetsThreshold &&
          report.unjudged === 0 &&
          report.balanced
            ? 0
            : 1;
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("init")
  .description("Create a starter manni.config.yaml in the current directory")
  .action(() => {
    try {
      console.log(`Created ${runInit()}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("review")
  .description(
    "Record a human verdict for an eval in the human-review zone (or list recorded reviews)",
  )
  .argument("[file]", "Page path")
  .argument("[eval]", "Eval name")
  .argument("[verdict]", "pass | fail")
  .option("--reviewer <name>", "Reviewer name recorded with the verdict")
  .option("--note <text>", "Optional note")
  .action(
    (
      file: string | undefined,
      evalName: string | undefined,
      verdict: string | undefined,
      opts: { reviewer?: string; note?: string },
    ) => {
      try {
        if (!file) {
          console.log(renderReviews(listReviews()));
          return;
        }
        if (!evalName || !verdict) {
          throw new DocevalsError(
            "Usage: manni docevals review <file> <eval> <pass|fail>",
          );
        }
        const entry = runReview(file, evalName, verdict, opts);
        console.log(
          `Recorded ${entry.verdict} for ${entry.evalName} on ${entry.file}`,
        );
      } catch (e) {
        fail(e);
      }
    },
  );

return program;
}
