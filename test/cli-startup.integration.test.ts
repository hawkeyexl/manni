/**
 * What the built `manni` bin loads, by command.
 *
 * A Claude Code hook runs `manni check <page>` after every edit, so the
 * umbrella mounts only the domain argv names and a domain imports its
 * heaviest dependencies where they run. This asserts the packages a run
 * loaded, recorded by a `--import` hook, rather than how long it took:
 * a timing is noise on a shared runner, a module list is not.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Command } from "commander";
import { afterAll, describe, expect, it } from "vitest";
import { buildProgram, buildProgramFor } from "../src/cli.js";
import { fixtureRepo } from "./family/helpers.js";
import { removeTempRepo } from "./helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const manni = resolve(here, "..", "dist", "cli.js");
const recorder = pathToFileURL(join(here, "fixtures", "startup", "record-loads.mjs")).href;

/** Packages no `--version`, `meta validate` or per-page `check` needs. */
const HEAVY = [
  "playwright-core",
  "@axe-core/playwright",
  "axe-core",
  "@asciidoctor/core",
  "@asciidoctor/opal-runtime",
  "n3",
  "rdf-validate-shacl",
  "@tpluscode/rdf-ns-builders",
];

function loaded(args: string[], cwd: string): { packages: string[]; stdout: string } {
  const r = spawnSync(process.execPath, ["--import", recorder, manni, ...args], {
    cwd,
    input: "",
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const line = /^MANNI_LOADED (.*)$/m.exec(r.stderr)?.[1];
  if (line === undefined) throw new Error(`no MANNI_LOADED line; stderr:\n${r.stderr}`);
  return { packages: JSON.parse(line) as string[], stdout: r.stdout };
}

describe("manni startup", () => {
  const repo = fixtureRepo("everything");
  afterAll(() => {
    removeTempRepo(repo);
  });

  it("--version loads commander and nothing else", () => {
    expect(loaded(["--version"], repo).packages).toEqual(["commander"]);
  });

  it("meta validate on one page loads none of the heavy packages", () => {
    const { packages } = loaded(["meta", "validate", "docs/limits.md"], repo);
    expect(packages).toContain("ajv");
    expect(packages.filter((p) => HEAVY.includes(p))).toEqual([]);
  });

  it("check on one page runs lint without Asciidoctor and leaves graph unloaded", () => {
    const { packages, stdout } = loaded(["check", "docs/limits.md"], repo);
    expect(stdout).toContain("lint check");
    expect(packages.filter((p) => HEAVY.includes(p))).toEqual([]);
  });
});

describe("the tree the bin mounts for one domain", () => {
  it("is that domain exactly as the whole tree mounts it", async () => {
    const whole = await buildProgram();
    for (const command of whole.commands) {
      const one = await buildProgramFor([command.name()]);
      const mounted: Command | undefined = one.commands.find((c) => c.name() === command.name());
      expect(mounted?.helpInformation(), command.name()).toBe(command.helpInformation());
    }
  });

  it("--version mounts no domain", async () => {
    expect((await buildProgramFor(["--version"])).commands).toEqual([]);
  });
});
