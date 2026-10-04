/**
 * Colour is the caller's decision, never the reporter's. The CLI decides it
 * once (`colorFor`, from `src/shared/color.ts`, reading the domain's
 * `--no-color`) and passes it down, so a reporter never reads the environment.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../../src/tracevals/cli.js";
import { renderList, runList } from "../../../src/tracevals/commands/list.js";
import { runRun } from "../../../src/tracevals/commands/run.js";
import { render } from "../../../src/tracevals/reporters/index.js";

const ESC = "\u001b[";
const claudeDir = fileURLToPath(new URL("../fixtures/home/.claude", import.meta.url));
const trace = fileURLToPath(
  new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
);
const project = fileURLToPath(new URL("../fixtures/project", import.meta.url));

describe("tracevals colour is passed in, not detected", () => {
  it("renderList emits escapes only with colour on", async () => {
    const run = await runList({ allProjects: true, env: { CLAUDE_CONFIG_DIR: claudeDir } });
    expect(renderList(run, { color: true })).toContain(ESC);
    expect(renderList(run, { color: false })).not.toContain(ESC);
    expect(renderList(run)).not.toContain(ESC);
  });

  it("the pretty report emits escapes only with colour on", async () => {
    const { report } = await runRun({
      tracePath: trace,
      project,
      deterministicOnly: true,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(render(report, "pretty", { color: true })).toContain(ESC);
    expect(render(report, "pretty", { color: false })).not.toContain(ESC);
    expect(render(report, "pretty")).not.toContain(ESC);
  });

  it("runRun colours its rendering only when asked", async () => {
    const plain = await runRun({
      tracePath: trace,
      project,
      deterministicOnly: true,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    const coloured = await runRun({
      tracePath: trace,
      project,
      deterministicOnly: true,
      color: true,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(plain.rendered).not.toContain(ESC);
    expect(coloured.rendered).toContain(ESC);
  });
});

describe("the --no-color flag", () => {
  it("is declared on the domain program, as docevals declares it", () => {
    const flag = buildProgram().options.find((o) => o.long === "--no-color");
    expect(flag?.description).toBe("disable colored output");
  });
});
