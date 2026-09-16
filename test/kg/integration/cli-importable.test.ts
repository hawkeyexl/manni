import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const cliUrl = pathToFileURL(cli).href;

/** Run a snippet in a child process with the CLI importable but not argv[1]. */
function evaluate(source: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    cwd: root,
  });
}

/**
 * The CLI module is imported by tooling that inspects commander's view of the
 * command surface (scripts/check-cli-reference.mjs) rather than running it. That
 * only works if importing the module does not parse argv — otherwise the import
 * consumes the *importer's* arguments and exits the process.
 */
describe("dist/cli.js as an importable module", () => {
  it("does not parse argv when imported rather than executed", () => {
    const r = evaluate(
      `await import(${JSON.stringify(cliUrl)}); console.log("IMPORT_RETURNED");`,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("IMPORT_RETURNED");
    // Commander's help output is the tell-tale of an unwanted parse.
    expect(r.stdout).not.toMatch(/Usage: manni/);
    expect(r.stderr).not.toMatch(/Usage: manni/);
  });

  // Deliberately not an exhaustive command list: scripts/check-cli-reference.mjs
  // already diffs commander's full surface against the CLI reference page, and
  // duplicating it here would mean two edits per command with no extra coverage.
  // What this asserts is only what that script depends on — that the umbrella's
  // `buildProgram()` mounts a populated `kg` subcommand.
  it("mounts a populated kg program on the umbrella", () => {
    const r = evaluate(
      `const m = await import(${JSON.stringify(cliUrl)});
       const kg = m.buildProgram().commands.find((c) => c.name() === "kg");
       console.log(JSON.stringify({
         count: kg.commands.length,
         hasBuild: kg.commands.some((c) => c.name() === "build"),
       }));`,
    );
    expect(r.status).toBe(0);
    const { count, hasBuild } = JSON.parse(r.stdout.trim());
    expect(count).toBeGreaterThan(1);
    expect(hasBuild).toBe(true);
  });

  it("still runs as a CLI when executed directly", () => {
    const r = spawnSync(process.execPath, [cli, "kg", "--help"], {
      encoding: "utf8",
      cwd: root,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage: manni kg/);
  });
});
