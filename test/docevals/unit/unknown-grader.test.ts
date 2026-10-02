/**
 * An eval naming a grader nothing registered is a usage error, exit 2.
 *
 * The configuration's bug is not the page's fault (ADR 01029). Reporting it as
 * a per-eval `error` result blamed every page that carried the eval and exited
 * 1, as though the pages had failed a check. So `run`, `list`, `generate` and
 * `promote` refuse it before they do anything else, and name the file that
 * declared it: the config for a config eval, the page for an inline one.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { runList } from "../../../src/docevals/commands/list.js";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";
import {
  listGraderKinds,
  registerGrader,
} from "../../../src/docevals/graders/registry.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const BODY = "\n# Install\n\nRun the installer.\n";

const REGISTERED = "Registered graders: ai, command, human, tool:regex.";

/** A config eval named `fresh-enough` with `grader`, used by the one page. */
function configScaffold(grader: string): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-unknown-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    ["---", "title: Install", "evals:", "  - use: fresh-enough", "---", BODY].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "collections:",
      "  - name: pages",
      '    paths: ["docs/**/*.md"]',
      "docevals:",
      "  evals:",
      "    fresh-enough:",
      "      assertion: The page was reviewed this year.",
      `      grader: ${grader}`,
      "",
    ].join("\n"),
  );
  return root;
}

/** One page declaring an inline eval named `readable` with `grader`. */
function pageScaffold(grader: string): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-unknown-page-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "evals:",
      "  - id: readable",
      "    assertion: The page reads at grade eight.",
      `    grader: ${grader}`,
      "---",
      BODY,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    ["collections:", "  - name: pages", '    paths: ["docs/**/*.md"]', "docevals:", ""].join(
      "\n",
    ),
  );
  return root;
}

const CONFIG_MESSAGE =
  'manni.config.yaml: eval "fresh-enough" names grader "tool:freshness", ' +
  `which is not registered. ${REGISTERED}`;

describe("an eval naming an unregistered grader", () => {
  it("lists the registered kinds in registry order", () => {
    expect(listGraderKinds().slice(0, 4)).toEqual(["ai", "command", "human", "tool:regex"]);
  });

  it("refuses run, naming the config that declared it", async () => {
    const cwd = configScaffold("tool:freshness");
    await expect(runEvals({ cwd, generate: false })).rejects.toThrow(
      new DocevalsError(CONFIG_MESSAGE),
    );
  });

  it("refuses run under --deterministic-only too", async () => {
    const cwd = configScaffold("tool:freshness");
    await expect(
      runEvals({ cwd, generate: false, deterministicOnly: true }),
    ).rejects.toThrow(new DocevalsError(CONFIG_MESSAGE));
  });

  it("refuses list", async () => {
    const cwd = configScaffold("tool:freshness");
    await expect(runList([], { cwd })).rejects.toThrow(new DocevalsError(CONFIG_MESSAGE));
  });

  it("refuses generate", async () => {
    const cwd = configScaffold("tool:freshness");
    await expect(runGenerate([], { cwd })).rejects.toThrow(
      new DocevalsError(CONFIG_MESSAGE),
    );
  });

  it("refuses promote", async () => {
    const cwd = configScaffold("tool:freshness");
    await expect(runPromote([], { cwd })).rejects.toThrow(
      new DocevalsError(CONFIG_MESSAGE),
    );
  });

  it("refuses a config eval no page uses", async () => {
    const cwd = configScaffold("tool:freshness");
    writeFileSync(
      join(cwd, "docs", "install.md"),
      ["---", "title: Install", "evals: The page names the installer.", "---", BODY].join("\n"),
    );
    await expect(runList([], { cwd })).rejects.toThrow(new DocevalsError(CONFIG_MESSAGE));
  });

  it("names the page that declared an inline eval", async () => {
    const cwd = pageScaffold("tool:reading-level");
    await expect(runEvals({ cwd, generate: false })).rejects.toThrow(
      new DocevalsError(
        'docs/install.md: eval "readable" names grader "tool:reading-level", ' +
          `which is not registered. ${REGISTERED}`,
      ),
    );
  });

  it("lets a grader added through registerGrader through", async () => {
    registerGrader({
      kind: "tool:house-rule",
      mode: "per-file",
      grade: () => Promise.resolve([]),
    });
    const cwd = pageScaffold("tool:house-rule");
    const report = await runEvals({ cwd, generate: false });
    expect(report.evalResults.map((r) => r.outcome)).toEqual(["pass"]);
    expect(listGraderKinds()).toContain("tool:house-rule");
  });
});
