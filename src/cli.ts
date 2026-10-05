/**
 * The `manni` CLI: one bin, one subcommand per tool in the family.
 *
 * Each tool builds its own commander program and is mounted here under its
 * name, so `manni meta validate …` is the metadata tool's `validate` with
 * nothing in between. The umbrella owns only what is common to all of them:
 * the name, the version, and the exit-code contract in `runProgram`.
 *
 * Tools land here one at a time, on their own branches; until one merges its
 * subcommand does not exist.
 *
 * Every domain is imported on demand. A domain's module graph is its whole
 * dependency tree (Playwright, axe, Asciidoctor, the RDF stack, ajv), and a
 * hook runs `manni check` after every edit, so the bin mounts only the domain
 * argv names. `--version` mounts none. Anything else (`--help`, a bare
 * `manni`, a typo) mounts them all, so help and "unknown command" read as
 * they always did.
 */
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { runIfMain } from "./shared/run.js";

interface Domain {
  /** The command names the loader mounts, known before it is loaded. */
  names: readonly string[];
  load: () => Promise<Command[]>;
}

// In the order `manni --help` lists them.
const DOMAINS: readonly Domain[] = [
  {
    names: ["meta"],
    load: async () => [
      (await import("./meta/cli.js"))
        .buildProgram()
        .name("meta")
        .description(
          "Validate, read, query and fill document metadata against JSON Schema",
        ),
    ],
  },
  {
    names: ["a11y"],
    load: async () => [
      (await import("./a11y/cli.js"))
        .buildProgram()
        .name("a11y")
        .description(
          "Crawl a site and check every page for accessibility violations with axe-core",
        ),
    ],
  },
  {
    names: ["cite"],
    load: async () => [
      (await import("./cite/cli.js"))
        .buildProgram()
        .name("cite")
        .description(
          "Track citations from doc claims to source lines and check them for drift",
        ),
    ],
  },
  {
    names: ["lint"],
    load: async () => [
      (await import("./lint/cli.js"))
        .buildProgram()
        .name("lint")
        .description(
          "Validate document structure against doctype templates, routed by a page's type",
        ),
    ],
  },
  {
    names: ["docevals"],
    load: async () => [
      (await import("./docevals/cli.js"))
        .buildProgram()
        .name("docevals")
        .description(
          "Deterministic and LLM-as-judge evals for documentation pages, driven by frontmatter",
        ),
    ],
  },
  {
    names: ["term"],
    load: async () => [
      (await import("./term/index.js"))
        .buildProgram()
        .name("term")
        .description("Check, lint and render a docset's terms and the references into them"),
    ],
  },
  {
    names: ["graph"],
    load: async () => [
      (await import("./graph/cli.js"))
        .buildProgram()
        .name("graph")
        .description(
          "Deterministic knowledge graphs derived from documentation frontmatter and formatting",
        ),
    ],
  },
  {
    names: ["tracevals"],
    load: async () => [
      (await import("./tracevals/cli.js"))
        .buildProgram()
        .name("tracevals")
        .description(
          "Deterministic and LLM-as-judge adherence evals for AI agent session traces",
        ),
    ],
  },
  // Not a tool but a family resource with verbs (proposal 0045).
  {
    names: ["key"],
    load: async () => [
      (await import("./key/cli.js"))
        .buildProgram()
        .name("key")
        .description("Set and rotate the family key that encrypted values are encrypted with."),
    ],
  },
  // The two family verbs (proposal 0078), and the only verbs the umbrella
  // carries: each runs other domains' command cores and owns no checks.
  {
    names: ["check", "status"],
    load: async () => {
      const { buildCheck, buildStatus } = await import("./family/cli.js");
      return [buildCheck(), buildStatus()];
    },
  },
];

const VERSION_FLAGS = new Set(["-V", "--version"]);

/**
 * The domains a run with these arguments (argv after the script) dispatches
 * to. The umbrella's only options are `--version` and `--help`, so the first
 * argument is one of them or the command commander will look up.
 */
function domainsFor(args: readonly string[]): readonly Domain[] {
  const first = args[0];
  if (first === undefined) return DOMAINS;
  if (VERSION_FLAGS.has(first)) return [];
  const named = DOMAINS.find((d) => d.names.includes(first));
  return named === undefined ? DOMAINS : [named];
}

async function mount(domains: readonly Domain[]): Promise<Command> {
  const mounted = (await Promise.all(domains.map((d) => d.load()))).flat();
  const metaCommands = new Set(
    mounted.find((c) => c.name() === "meta")?.commands.map((c) => c.name()),
  );

  const program = new Command();
  program
    .name("manni")
    .description("Tools for documentation that is meant to be checked.")
    .version(pkg.version, "-V, --version")
    // A pointer, not the whole help screen. Commander appends this after every
    // usage error, and the message that precedes it already names the problem.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before `addCommand`, which copies the exit callback into the
    // mounted program by value. See the same note in ./meta/cli.ts.
    .exitOverride()
    .configureOutput({
      outputError: (str, write) => {
        write(str);
        // `manni validate …` is the most likely thing a docmeta user types
        // first. Commander's "unknown command" is correct and unhelpful; say
        // where the command went.
        const m = /unknown command '([^']+)'/.exec(str);
        const name = m?.[1];
        if (name !== undefined && metaCommands.has(name)) {
          write(
            `(\`${name}\` is a metadata command: try \`manni meta ${name}\`)\n`,
          );
        }
      },
    });

  for (const command of mounted) program.addCommand(command);
  return program;
}

/** The whole command tree, every domain mounted. */
export function buildProgram(): Promise<Command> {
  return mount(DOMAINS);
}

/** The tree a run with these arguments needs: the one domain they name, or all of them. */
export function buildProgramFor(args: readonly string[]): Promise<Command> {
  return mount(domainsFor(args));
}

runIfMain(import.meta.url, () => buildProgramFor(process.argv.slice(2)));
