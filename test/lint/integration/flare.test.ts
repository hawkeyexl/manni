/**
 * `lint structure` over a MadCap Flare project (proposal 0125, Part 2): the
 * `flare` line `--explain` prints in each of its three forms, and the skip a
 * topic the target excludes gets.
 */
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLint, type LintOptions } from "../../../src/lint/commands/lint.js";
import { renderExplain, renderPretty } from "../../../src/lint/reporters/index.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FLARE = join(import.meta.dirname, "..", "fixtures", "flare");
const INSTALL = "widget/Content/Topics/Install.htm";
const PRINT_GUIDE = "widget/Content/Topics/PrintGuide.htm";

beforeEach(() => {
  resetWarnings();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function explain(inputs: string[], config?: string): Promise<string[]> {
  const opts: LintOptions = {
    inputs,
    cwd: FLARE,
    explain: true,
    ...(config === undefined ? { noConfig: true } : { configPath: join(FLARE, config) }),
  };
  return renderExplain(await runLint(opts)).split("\n");
}

describe("lint structure --explain on a Flare topic", () => {
  it("names the target tools.flare.target chose, before the routing lines", async () => {
    const lines = await explain([INSTALL], "html5.config.yaml");
    const flare = lines.findIndex((l) => l.includes("flare"));
    expect(lines[flare]).toBe(`    · ${"flare".padEnd(20)} Widget.flprj, target HTML5 (tools.flare.target)`);
    expect(flare).toBeLessThan(lines.findIndex((l) => l.includes("--template not given")));
  });

  it("names the only target", async () => {
    const lines = await explain(["solo/Content/Topic.htm"]);
    expect(lines).toContain(`    · ${"flare".padEnd(20)} Solo.flprj, target Online (the only target)`);
  });

  it("says when there is no target", async () => {
    const lines = await explain([INSTALL]);
    expect(lines).toContain(`    · ${"flare".padEnd(20)} Widget.flprj, no target`);
  });

  it("prints no flare line for a page outside any project", async () => {
    const lines = await explain(["orphan/Topic.htm"]);
    expect(lines.some((l) => l.includes("· flare"))).toBe(false);
  });

  it("skips a topic the target excludes, with the reason", async () => {
    const lines = await explain([PRINT_GUIDE, INSTALL], "html5.config.yaml");
    expect(lines).toContain("    skipped: target HTML5 excludes the page by its conditions");
  });
});

describe("lint structure on a Flare topic the target excludes", () => {
  it("counts it as skipped, not checked", async () => {
    const run = await runLint({
      inputs: [PRINT_GUIDE, INSTALL],
      cwd: FLARE,
      configPath: join(FLARE, "html5.config.yaml"),
      template: "tgdp:how-to:1.6",
    });
    expect(run.summary).toMatchObject({ checked: 1, skipped: 1 });
    const guide = run.results.find((r) => r.file === PRINT_GUIDE);
    expect(guide?.skipped).toBe("excluded");
    expect(renderPretty(run)).toContain(
      `- ${PRINT_GUIDE}  skipped: target HTML5 excludes the page by its conditions`,
    );
  });

  it("is checked under a target that builds it", async () => {
    const run = await runLint({ inputs: [PRINT_GUIDE], cwd: FLARE, configPath: join(FLARE, "print.config.yaml"), explain: true });
    expect(run.results[0]?.skipped).not.toBe("excluded");
  });

  it("says why when every page is excluded", async () => {
    await expect(
      runLint({ inputs: [PRINT_GUIDE], cwd: FLARE, configPath: join(FLARE, "html5.config.yaml") }),
    ).rejects.toThrow("1 is excluded by the Flare target's conditions");
  });

  it("exits 2 naming an unknown target, rather than failing each page", async () => {
    await expect(
      runLint({ inputs: [INSTALL], cwd: FLARE, configPath: join(FLARE, "unknown.config.yaml") }),
    ).rejects.toThrow(
      'tools.flare.target "Nope" names no target in Widget.flprj. Its targets are HTML5 and Print.',
    );
  });
});
