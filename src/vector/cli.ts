/**
 * The vector program (proposal 0128). Named `vector` because that is where it
 * is mounted (`manni vector …`); `src/cli.ts` adds it to the umbrella and
 * runs it. `build` reads pages with exactly the input surface `graph build`
 * has, so the flags come from graph's CLI rather than being restated here.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import {
  authoringOption,
  countOption,
  documentInputs,
  documentOptions,
  formatOption,
  inputOptions,
  NO_AUTHORING_HELP,
  type InputFlags,
} from "../graph/cli.js";
import { GRAPH_FORMAT_LIST, type GraphFormat } from "../graph/reporters/index.js";
import { fail } from "../shared/run.js";
import { warn } from "../shared/warn.js";
import { renderBuild, runBuild } from "./commands/build.js";
import { renderSearch, runSearch } from "./commands/search.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("vector")
    .description("Build and search embeddings of a docset's pages, keyed by graph node IRIs")
    .version(pkg.version)
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls: see the same note in ../graph/cli.ts.
    .exitOverride();

  documentInputs(
    program
      .command("build")
      .description(
        "Read pages and write the search index and its vector sidecars, one per language (needs @huggingface/transformers)",
      ),
    "build",
  )
    .option("--no-authoring", NO_AUTHORING_HELP)
    .option("-o, --out <dir>", "Directory for every file (default: the directory of graph.out)")
    // Not `--model`: on `fill` that is the inference model, a different thing.
    .option("--embedding-model <id>", "Embedding model id (default: config model; `mock` for offline runs)")
    .option("--dtype <dtype>", "Weight quantization (default: config dtype)")
    .option("--no-cache", "Ignore the vector cache")
    .option("-f, --format <format>", `Output: ${GRAPH_FORMAT_LIST}`, formatOption, "pretty")
    .action(
      async (
        paths: string[],
        opts: InputFlags & {
          config?: string | boolean;
          collection?: string[];
          exclude?: string[];
          authoring?: boolean;
          out?: string;
          embeddingModel?: string;
          dtype?: string;
          cache?: boolean;
          format: GraphFormat;
        },
      ) => {
        try {
          const report = await runBuild({
            paths,
            ...documentOptions(opts),
            ...(await inputOptions(paths, opts)),
            ...authoringOption(opts.authoring),
            ...(opts.out === undefined ? {} : { out: opts.out }),
            ...(opts.embeddingModel === undefined ? {} : { model: opts.embeddingModel }),
            ...(opts.dtype === undefined ? {} : { dtype: opts.dtype }),
            ...(opts.cache === false ? { noCache: true } : {}),
          });
          for (const warning of report.warnings) warn(warning);
          console.log(renderBuild(report, opts.format));
        } catch (e) {
          fail(e);
        }
      },
    );

  program
    .command("search")
    .description("Rank one language's nodes by meaning alone (needs `vector build`)")
    .argument("<query>", "Text query")
    .option(
      "-i, --index <dir>",
      "Directory holding the indexes, the manifest and the sidecars (default: the directory of graph.out)",
    )
    .option("--lang <tag>", "Which localization to search (required when the corpus has more than one)")
    .option("--limit <n>", "Maximum results (default 10)", countOption("--limit"))
    .option("-c, --config <path>", "Path to manni.config.yaml")
    .option("--no-config", "Ignore any discovered config file")
    .option("-f, --format <format>", `Output: ${GRAPH_FORMAT_LIST}`, formatOption, "pretty")
    .action(
      async (
        query: string,
        opts: { config?: string | boolean; index?: string; lang?: string; limit?: number; format: GraphFormat },
      ) => {
        try {
          const report = await runSearch({
            ...documentOptions(opts),
            ...(opts.index === undefined ? {} : { index: opts.index }),
            ...(opts.lang === undefined ? {} : { lang: opts.lang }),
            ...(opts.limit === undefined ? {} : { limit: opts.limit }),
            query,
          });
          console.log(renderSearch(report, opts.format));
        } catch (e) {
          fail(e);
        }
      },
    );

  return program;
}
