/**
 * Persona-aware judging, end to end (proposal 0111).
 *
 * Under the rule, an opted-in `ai` eval is judged as its page's personas: the
 * prompt carries the readers section, the result carries `personas`, pretty
 * tags it, and `--since` and `--newer-than` count the persona record.
 *
 * Everywhere else the run is today's, byte for byte. Each fall-back case runs
 * twice, once as written and once with every `options.readers` stripped, and
 * the provider requests, the JSON report, stderr and the exit code must agree.
 * The JSON is compared with timings and each page's `integrity` set aside:
 * stripping the option edits the page file, so its whole-file hash moves.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { runEvals, type EngineReport } from "../../../src/docevals/core/engine.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { render } from "../../../src/docevals/reporters/index.js";
import type { ExecFn } from "../../../src/docevals/graders/types.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const PERSONAS = join(ROOT, "test/docevals/fixtures/personas");
const FREE_FORM = join(ROOT, "test/docevals/fixtures/personas-free-form");

/** A copy of a fixture, outside the repository. */
function copy(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-personas-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

/**
 * The same fixture with every `options: { readers: … }` block commented out.
 * Commented rather than deleted, so every later line keeps its number and a
 * result's location is the one the run as written reports.
 */
function stripped(fixture: string): string {
  const dir = copy(fixture);
  let edited = 0;
  for (const file of files(dir)) {
    const text = readFileSync(file, "utf8");
    const out = text.replace(
      /^( *)options:\n\1 {2}readers: ([^\n]*)\n/gm,
      (match: string, indent: string, value: string, offset: number) => {
        // A block holding another key would leave it a stray line under the comment.
        const next = text.slice(offset + match.length).split("\n", 1)[0] ?? "";
        if (next.startsWith(`${indent}  `) && next.trim() !== "") {
          throw new Error(`${file}: an options block holds more than readers, so stripping it would strand a key`);
        }
        return `${indent}# options:\n${indent}#   readers: ${value}\n`;
      },
    );
    if (out === text) continue;
    writeFileSync(file, out);
    edited += 1;
  }
  // A pattern that matched nothing would compare a fixture with itself.
  if (edited === 0) throw new Error(`no options.readers to strip in ${fixture}`);
  return dir;
}

interface Captured {
  requests: unknown[];
  json: string;
  stderr: string;
  exitCode: number;
  report: EngineReport;
}

async function judged(
  dir: string,
  opts: Partial<Parameters<typeof runEvals>[0]> = {},
): Promise<Captured> {
  const provider = new MockProvider([mockVerdict("pass", 0.95)]);
  const judge = makeJudge({ provider, root: dir });
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    const report = await runEvals({
      cwd: dir,
      generate: false,
      judge,
      judgeOptions: { noCache: true },
      ...opts,
    });
    const json = render(report, "json")
      .replaceAll(JSON.stringify(dir).slice(1, -1), "<root>")
      .replaceAll(dir, "<root>")
      .replace(/"durationMs": \d+/g, '"durationMs": 0')
      .replace(/"integrity": "[^"]*"/g, '"integrity": "-"');
    return { requests: provider.requests, json, stderr: writes.join(""), exitCode: report.exitCode, report };
  } finally {
    spy.mockRestore();
  }
}

function byFile(report: EngineReport, file: string, evalName: string) {
  return report.evalResults.find((r) => r.file === file && r.evalName === evalName);
}

describe("under the rule", () => {
  it("judges an opted-in eval as its page's personas, and tags only it", async () => {
    const { report, requests } = await judged(PERSONAS);
    expect(byFile(report, "docs/one-reader.md", "finish-task")?.personas).toEqual(["theo"]);
    expect(byFile(report, "docs/two-readers.md", "finish-task")?.personas).toEqual(["theo", "maya"]);
    expect(byFile(report, "docs/sidecar-reader.md", "finish-task")?.personas).toEqual(["theo"]);
    expect(byFile(report, "docs/use-reader.md", "reader-can-finish")?.personas).toEqual(["theo"]);
    for (const [file, name] of [
      ["docs/one-reader.md", "plain-judge"],
      ["docs/one-reader.md", "no-todo-markers"],
      ["docs/not-opted.md", "finish-task"],
      ["docs/unknown-reader.md", "finish-task"],
      ["docs/no-reader.md", "finish-task"],
      ["docs/bad-key.md", "finish-task"],
      ["docs/bad-value.md", "finish-task"],
      ["strategy/t1.md", "journey-outcome"],
    ] as const) {
      expect(byFile(report, file, name), `${file} ${name}`).not.toHaveProperty("personas");
    }
    const sections = (requests as { user: string }[]).filter((r) => r.user.includes("# Readers"));
    // Exactly the tagged results' requests, one per ensemble run.
    expect(sections).toHaveLength(report.evalResults.filter((r) => r.personas !== undefined).length);
    expect(sections.every((r) => !r.user.includes("BODY-SENTINEL"))).toBe(true);

    const pretty = render(report, "pretty", { color: false });
    expect(pretty).toMatch(/pass finish-task \[auto-pass\] \(read as theo, maya\) {2}docs\/two-readers\.md/);
    expect(pretty).toMatch(/pass plain-judge \[auto-pass\] {2}/);
  });

  it("reports readers: persona as an error where persona records exist, exit 1", async () => {
    const { report } = await judged(PERSONAS, { paths: ["docs/bad-value.md"] });
    expect(report.problems).toContainEqual({
      file: "docs/bad-value.md",
      level: "error",
      message: 'Eval "finish-task": ai options.readers must be one of: personas',
    });
    expect(report.exitCode).toBe(1);
    expect(render(report, "pretty", { color: false })).toContain(
      'error docs/bad-value.md Eval "finish-task": ai options.readers must be one of: personas',
    );
  });

  it("leaves SARIF, JUnit, GitHub, Markdown and HTML as they are without the field", async () => {
    const { report } = await judged(PERSONAS, { paths: ["docs/one-reader.md"] });
    const bare: EngineReport = {
      ...report,
      evalResults: report.evalResults.map(({ personas: _personas, ...rest }) => rest),
    };
    for (const format of ["sarif", "junit", "github", "markdown", "html"] as const) {
      expect(render(report, format), format).toBe(render(bare, format));
    }
  });
});

describe("the fall-back rule, byte for byte", () => {
  for (const page of ["docs/not-opted.md", "docs/unknown-reader.md", "docs/no-reader.md", "docs/bad-key.md"]) {
    it(`${page}: the same run with options.readers removed`, async () => {
      const asWritten = await judged(copy(PERSONAS), { paths: [page] });
      const without = await judged(stripped(PERSONAS), { paths: [page] });
      expect(asWritten.requests).toEqual(without.requests);
      expect(asWritten.json).toBe(without.json);
      expect(asWritten.stderr).toBe(without.stderr);
      expect(asWritten.exitCode).toBe(without.exitCode);
    });
  }

  it("a repository with no persona records: the same run with options.readers removed", async () => {
    const asWritten = await judged(copy(FREE_FORM));
    const without = await judged(stripped(FREE_FORM));
    expect(asWritten.requests.length).toBeGreaterThan(0);
    expect(asWritten.requests).toEqual(without.requests);
    expect(asWritten.json).toBe(without.json);
    expect(asWritten.stderr).toBe(without.stderr);
    expect(asWritten.exitCode).toBe(without.exitCode);
  });

  it("--deterministic-only through the built CLI: the same stdout, stderr and exit", () => {
    const run = (cwd: string) => {
      const r = spawnSync("node", [MANNI, "docevals", "run", "--deterministic-only", "--no-generate"], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });
      return { stdout: r.stdout.replaceAll(cwd, "<root>"), stderr: r.stderr.replaceAll(cwd, "<root>"), status: r.status };
    };
    const asWritten = run(copy(PERSONAS));
    const without = run(stripped(PERSONAS));
    expect(asWritten.stdout).not.toContain("read as");
    expect(asWritten).toEqual(without);
    expect(asWritten.status).toBe(0);
  });
});

describe("a broken strategy", () => {
  function broken(): string {
    const dir = copy(PERSONAS);
    writeFileSync(join(dir, "strategy/theo.md"), "---\ntype: [persona\n---\n");
    return dir;
  }

  it("stops a judged run that carries options.readers, in strategy's own sentence", async () => {
    await expect(judged(broken())).rejects.toThrow(/^strategy\/theo\.md: could not be read as markdown: /);
  });

  it("never touches a run with no options.readers, or a deterministic one", async () => {
    const dir = broken();
    await expect(judged(dir, { paths: ["docs/not-opted.md"] })).resolves.toMatchObject({ exitCode: 0 });
    await expect(judged(dir, { deterministicOnly: true })).resolves.toBeDefined();
  });

  it("stops a judged run on a malformed strategy: section", async () => {
    const dir = copy(PERSONAS);
    writeFileSync(
      join(dir, "manni.config.yaml"),
      `${readFileSync(join(dir, "manni.config.yaml"), "utf8")}\nstrategy:\n  rules: 1\n`,
    );
    await expect(judged(dir)).rejects.toThrow(
      'Unknown key "rules" under strategy: in manni.config.yaml. Supported keys: severity, baseline, allowEmpty, respectGitignore.',
    );
  });
});

/** The pages a scoped run graded: the files any result names. */
function graded(report: EngineReport): Set<string> {
  return new Set(report.evalResults.map((r) => r.file));
}

/** The pages whose opted-in evals read `id`. */
function reading(report: EngineReport, id: string): Set<string> {
  return new Set(report.evalResults.filter((r) => r.personas?.includes(id)).map((r) => r.file));
}

describe("--since counts a persona record for an opted-in page", () => {
  const OK = { code: 0, stdout: "", stderr: "", timedOut: false };
  const git =
    (topLevel: string, changed: string[]): ExecFn =>
    (cmd) =>
      Promise.resolve(
        cmd[1] === "rev-parse"
          ? { ...OK, stdout: `${topLevel}\n` }
          : { ...OK, stdout: changed.map((f) => `${f}\0`).join("") },
      );

  it("selects exactly the pages whose opted-in evals read the changed persona, in a judged run", async () => {
    const full = (await judged(PERSONAS)).report;
    const scoped = (await judged(PERSONAS, { since: "main", exec: git(PERSONAS, ["strategy/maya.md"]) })).report;
    expect(graded(scoped)).toEqual(reading(full, "maya"));
    // The record itself is a page of the strategy collection, so it counts too.
    expect(scoped.since?.pagesSelected).toBe(reading(full, "maya").size + 1);
  });

  it("selects only the record itself under --deterministic-only", async () => {
    const scoped = (
      await judged(PERSONAS, { since: "main", deterministicOnly: true, exec: git(PERSONAS, ["strategy/maya.md"]) })
    ).report;
    expect(scoped.since?.pagesSelected).toBe(1);
  });
});

describe("--newer-than counts a persona record's age for an opted-in page", () => {
  /** No git here: every page takes the newest mtime among its scope files. */
  const noGit: ExecFn = () => Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: "ENOENT" });

  it("selects the pages whose opted-in evals read a persona edited inside the window", async () => {
    const dir = copy(PERSONAS);
    const old = new Date("2001-01-01T00:00:00Z");
    for (const file of files(dir)) utimesSync(file, old, old);
    const now = new Date();
    utimesSync(join(dir, "strategy/maya.md"), now, now);

    const full = (await judged(PERSONAS)).report;
    const scoped = (await judged(dir, { newerThan: "1h", exec: noGit })).report;
    expect(graded(scoped)).toEqual(reading(full, "maya"));
    expect(scoped.newerThan?.pagesSelected).toBe(reading(full, "maya").size + 1);
  });
});
