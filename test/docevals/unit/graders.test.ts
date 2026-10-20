import { describe, it, expect } from "vitest";
import { parseDocevalsConfig } from "../helpers/config.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { commandGrader } from "../../../src/docevals/graders/command.js";
import type { ExecFn, ExecResult, GraderTarget } from "../../../src/docevals/graders/types.js";

const CONFIG = parseDocevalsConfig("", "/fake/manni.config.yaml");

function makeTarget(frontmatterYaml: string, body = "Body."): GraderTarget {
  const content = `---\n${frontmatterYaml}\n---\n${body}`;
  const page: PageFile = {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, CONFIG);
  const ev = plan.evals[0];
  if (ev === undefined) throw new Error("fixture resolved no evals");
  return { plan, eval: ev };
}

function fakeExec(result: Partial<ExecResult>): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = [];
  const exec: ExecFn = (cmd) => {
    calls.push(cmd);
    return Promise.resolve({
      code: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      ...result,
    });
  };
  return { exec, calls };
}

describe("commandGrader", () => {
  const fm = [
    "evals:",
    "  - id: check",
    "    assertion: Something.",
    "    grader: command",
    '    command: ["node", "check.mjs", "{file}"]',
  ].join("\n");

  it("passes on exit 0 with no findings", async () => {
    const { exec, calls } = fakeExec({ code: 0 });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
    expect(calls[0]).toEqual(["node", "check.mjs", "/fake/docs/page.md"]);
  });

  it("hands the command the page path as MANNI_DOCEVALS_FILE", async () => {
    const envs: unknown[] = [];
    const exec: ExecFn = (_cmd, opts) => {
      envs.push(opts?.env);
      return Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false });
    };
    await commandGrader.grade({ targets: [makeTarget(fm)], config: CONFIG, root: "/fake", exec });
    expect(envs).toEqual([{ MANNI_DOCEVALS_FILE: "/fake/docs/page.md" }]);
  });

  it("fails on nonzero exit with the output tail", async () => {
    const { exec } = fakeExec({ code: 1, stderr: "missing heading" });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      "Exit code 1. Edit the page until the command passes, or fix the command if it is broken. Output: missing heading",
    );
    expect(findings[0]?.severity).toBe("error");
  });

  it("honors successExitCodes", async () => {
    const target = makeTarget(
      fm.replace("grader: command", "grader: command\n    success-exit-codes: [0, 3]"),
    );
    const { exec } = fakeExec({ code: 3 });
    const findings = await commandGrader.grade({
      targets: [target],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
  });

  it("reports spawn errors", async () => {
    const { exec } = fakeExec({ code: null, spawnError: "ENOENT" });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toBe(`Failed to run command "node": ENOENT. Fix the eval's command.`);
  });

  it("reports timeouts", async () => {
    const { exec } = fakeExec({ code: null, timedOut: true });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toMatch(
      /^Command timed out after \d+ms\. Fix the command, or raise the eval's timeout-ms if the check is slow by design\.$/,
    );
  });

  it("says a killed command was killed, and what to do", async () => {
    const { exec } = fakeExec({ code: null, stderr: "half done" });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toBe(
      "Killed before exiting. Edit the page until the command passes, or fix the command if it is broken. Output: half done",
    );
  });

  it("says how to get a command when there is none", async () => {
    const { exec } = fakeExec({});
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm.replace(/\n.*command: .*$/m, ""))],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toBe(
      "No command to run, because the script is not generated. Run manni docevals generate, or manni docevals run with a provider configured.",
    );
  });
});
