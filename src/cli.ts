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
 */
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { buildProgram as buildA11y } from "./a11y/cli.js";
import { buildProgram as buildCite } from "./cite/cli.js";
import { buildProgram as buildMeta } from "./meta/cli.js";
import { runIfMain } from "./shared/run.js";

export function buildProgram(): Command {
  const meta = buildMeta()
    .name("meta")
    .description(
      "Validate, read, query and fill document metadata against JSON Schema",
    );
  const metaCommands = new Set(meta.commands.map((c) => c.name()));

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

  program.addCommand(meta);
  program.addCommand(
    buildA11y()
      .name("a11y")
      .description(
        "Crawl a site and check every page for accessibility violations with axe-core",
      ),
  );
  program.addCommand(
    buildCite()
      .name("cite")
      .description(
        "Track citations from doc claims to source lines and check them for drift",
      ),
  );
  return program;
}

runIfMain(import.meta.url, buildProgram);
