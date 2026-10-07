/**
 * The `site` domain's commander program. Mounted by `src/cli.ts` under
 * `manni site`; no entry point of its own. Like `key` (proposal 0045), `site`
 * is a family resource with verbs: the site every other domain checks
 * (proposal 0082). Three verbs, no default subcommand.
 *
 * These verbs print no report: the framework's output is the output, on the
 * inherited stdio. manni's own lines are diagnostics on stderr. Exit `0` done,
 * `2` operational/usage, and never `1`, because nothing here is a finding.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { fail } from "../shared/run.js";
import { runSite } from "./commands/run.js";
import type { Verb } from "./types.js";

/** What commander hands each verb's action. */
interface SiteCliOptions {
  /** `-c, --config <file>`. */
  config?: string;
  /** `--port <n>` as typed; `resolvePlan` validates it. start and preview only. */
  port?: string;
  /** `--host <host>`. start and preview only. */
  host?: string;
}

/**
 * Split a verb's operands into `[dir]` and what came after `--`.
 *
 * Commander drops the `--` itself, at whichever program met it first (here,
 * the umbrella), and hands everything after it on as operands. So `[dir]`
 * alone cannot tell `start -- --open` (no dir) from `start website`. The
 * process argv still has the `--`, and what follows it is the tail of the
 * operands; a tail that does not match (a program parsed from elsewhere) is
 * no passthrough at all.
 * ponytail: an option given `--` as its value (`--host --`) is misread as the
 * separator; nobody binds a host named `--`.
 */
function splitOperands(args: readonly string[]): { dir: string | undefined; passthrough: string[]; extra: number } {
  const at = process.argv.indexOf("--");
  const tail = at === -1 ? [] : process.argv.slice(at + 1);
  const start = args.length - tail.length;
  const passthrough = start >= 0 && tail.every((arg, i) => args[start + i] === arg) ? tail : [];
  const before = args.slice(0, args.length - passthrough.length);
  return { dir: before[0], passthrough, extra: before.length };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("site")
    .description("Start, build and preview the docs site")
    .version(pkg.version, "-V, --version")
    // A pointer, not the whole help screen: the message that precedes it
    // already names the offending flag.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls below. `copyInheritedSettings`
    // copies `_exitCallback` by value at subcommand-creation time, so an
    // `exitOverride()` installed afterwards leaves every subcommand still
    // calling `process.exit(1)`.
    .exitOverride();

  const verb = (name: Verb, description: string, serves: boolean): void => {
    const cmd = program
      .command(name)
      .description(description)
      .argument("[dir]", "the site's directory (default: site.dir, else found by search)")
      // Everything after `--` arrives as operands; splitOperands sorts them.
      .allowExcessArguments();
    if (serves) {
      cmd
        .option("--port <n>", "port, an integer from 1 to 65535 (default: a local collection url, else the framework's)")
        .option("--host <host>", "host to bind (default: a local collection url, else the framework's)");
    }
    cmd
      .option("-c, --config <file>", "path to a manni config file")
      .action(async (_dir: string | undefined, options: SiteCliOptions, self: Command) => {
        const { dir, passthrough, extra } = splitOperands(self.args);
        if (extra > 1) {
          self.error(
            `error: too many arguments for '${name}'. Expected 1 argument but got ${String(extra)}.`,
            { code: "commander.excessArguments" },
          );
        }
        try {
          process.exitCode = await runSite(name, {
            cwd: process.cwd(),
            dir,
            configPath: options.config,
            port: options.port,
            host: options.host,
            passthrough,
          });
        } catch (err) {
          fail(err);
        }
      });
  };

  verb("start", "Run the docs framework's dev server", true);
  verb("build", "Build the docs site", false);
  verb("preview", "Build the docs site, then serve the output", true);

  program.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  manni site start                      # detect the framework, run its dev server",
      "  manni site build",
      "  manni site preview --port 4000        # build, then serve the output",
      "  manni site start website -- --open    # arguments after -- go to the framework",
    ].join("\n"),
  );

  return program;
}
