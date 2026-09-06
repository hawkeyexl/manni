/**
 * The command grader spawns a real process, so these tests do too — with
 * `process.execPath` and `-e`, which needs no fixture script on disk and no
 * network. Everything stays inside the worktree.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandGrader, DEFAULT_TIMEOUT_MS } from "../../../../src/tracevals/graders/command.js";
import { makePlan, makeTrace } from "../../helpers.js";

const NODE = process.execPath;
let dir: string;
let tracePath: string;

beforeAll(async () => {
  // .tmp/ is gitignored, so a fresh checkout will not have it yet — and this
  // file must not depend on another test file having created it first.
  await mkdir(".tmp", { recursive: true });
  dir = await mkdtemp(join(process.cwd(), ".tmp", "command-grader-"));
  tracePath = join(dir, "trace.jsonl");
  await writeFile(tracePath, '{"type":"user","text":"hello"}\n');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function grade(planOverrides: Record<string, unknown>) {
  return commandGrader.grade({
    trace: makeTrace({ file: tracePath, cwd: dir }),
    plan: makePlan({ grader: "command", ...planOverrides }),
    projectRoot: dir,
  });
}

describe("command grader", () => {
  it("passes on exit 0", async () => {
    const result = await grade({ command: [NODE, "-e", "process.exit(0)"] });
    expect(result.error).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it("fails on a non-zero exit, carrying the code and stderr", async () => {
    const result = await grade({
      command: [NODE, "-e", 'console.error("force push found"); process.exit(1)'],
    });
    expect(result.error).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("exited 1");
    expect(result.findings[0]?.message).toContain("force push found");
    expect(result.findings[0]?.severity).toBe("error");
  });

  it("honors success-exit-codes", async () => {
    const argv = [NODE, "-e", "process.exit(3)"];
    expect((await grade({ command: argv })).findings).toHaveLength(1);
    expect(
      (await grade({ command: argv, successExitCodes: [0, 3] })).findings,
    ).toEqual([]);
  });

  it("substitutes {trace} with the trace path", async () => {
    // Reads the trace it was handed and exits non-zero unless the content is
    // there — so a substitution that silently passed the literal would fail.
    const result = await grade({
      command: [
        NODE,
        "-e",
        'const fs=require("fs");process.exit(fs.readFileSync(process.argv[1],"utf8").includes("hello")?0:1)',
        "{trace}",
      ],
    });
    expect(result.findings).toEqual([]);
  });

  it("carries a finding's severity from the eval, so warnings report but pass", async () => {
    const result = await grade({
      command: [NODE, "-e", "process.exit(1)"],
      severity: "warning",
    });
    expect(result.findings[0]?.severity).toBe("warning");
  });

  it("errors rather than hanging when the command overruns its timeout", async () => {
    const result = await grade({
      command: [NODE, "-e", "setTimeout(() => {}, 60000)"],
      timeoutMs: 250,
    });
    expect(result.error).toContain("timed out after 250ms");
    expect(result.findings).toEqual([]);
  });

  it("bounds an unstated timeout rather than leaving it open", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_TIMEOUT_MS)).toBe(true);
  });

  it("errors when grader: command carries no command", async () => {
    // The schema's legal generation-contract state. This tool generates no
    // check scripts, and an eval that cannot run must never read as a pass.
    const result = await grade({});
    expect(result.error).toContain("no `command`");
    expect(result.findings).toEqual([]);
  });

  it("errors when the executable does not exist", async () => {
    const result = await grade({
      command: [join(dir, "definitely-not-here"), "x"],
    });
    expect(result.error).toContain("could not run command");
    expect(result.findings).toEqual([]);
  });

  it("accepts a generated-assertion-hash that matches the assertion", async () => {
    const assertion = "The trace contains no force push.";
    const result = await grade({
      assertion,
      command: [NODE, "-e", "process.exit(0)"],
      generatedAssertionHash: createHash("sha256").update(assertion).digest("hex"),
    });
    expect(result.error).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it("errors when a hash is present but the assertion is gone", async () => {
    // proposal.2 made `assertion` optional, which created a shape that could
    // not exist before: a hash with nothing to check it against. Hashing the
    // empty string and comparing would pass for one specific stored hash and
    // fail confusingly for every other, so the half write-back is reported.
    const result = await grade({
      assertion: undefined,
      command: [NODE, "-e", "process.exit(0)"],
      generatedAssertionHash: createHash("sha256").update("gone").digest("hex"),
    });
    expect(result.error).toContain("no assertion");
    expect(result.findings).toEqual([]);
  });

  it("errors when the assertion has drifted from its generated command", async () => {
    const result = await grade({
      assertion: "The assertion was edited after the script was generated.",
      command: [NODE, "-e", "process.exit(0)"],
      generatedAssertionHash: createHash("sha256").update("something else").digest("hex"),
    });
    expect(result.error).toContain("assertion has changed");
    expect(result.findings).toEqual([]);
  });

  it("passes argv without a shell, so metacharacters are inert", async () => {
    // The containment that matters: `;` and `&&` reach the process as literal
    // argument text, never as shell syntax that could run a second command.
    const result = await grade({
      command: [
        NODE,
        "-e",
        'process.exit(process.argv[1] === "; echo pwned && true" ? 0 : 1)',
        "; echo pwned && true",
      ],
    });
    expect(result.findings).toEqual([]);
  });

  it("passes a script that writes more to stdout than a pipe buffer holds", async () => {
    // stdout is discarded rather than piped: a piped stream nobody reads fills
    // at ~64KB and blocks the child mid-write, which used to surface as a
    // timeout on a script that had already decided the answer.
    const result = await grade({
      command: [NODE, "-e", "process.stdout.write('x'.repeat(5_000_000)); process.exit(0)"],
      timeoutMs: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.findings).toEqual([]);
  }, 30_000);

  it("settles the timeout even when the child ignores SIGTERM", async () => {
    // Waiting for `close` would hang the whole run here, because a trapped
    // SIGTERM means the child never closes.
    const result = await grade({
      command: [NODE, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      timeoutMs: 500,
    });
    expect(result.error).toContain("timed out after 500ms");
    expect(result.findings).toEqual([]);
  }, 20_000);

  it("caps retained stderr even when it arrives in one oversized chunk", async () => {
    const result = await grade({
      command: [NODE, "-e", "process.stderr.write('e'.repeat(200_000)); process.exit(1)"],
      timeoutMs: 10_000,
    });
    // The cap is on what is retained, not merely on what is printed.
    expect(result.findings[0]?.message.length).toBeLessThan(4000);
  }, 30_000);
});
