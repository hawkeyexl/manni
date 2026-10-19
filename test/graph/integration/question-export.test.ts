/**
 * `graph export questions` (proposal 0087 § 7d), end to end through the built
 * CLI. It writes one JSON line per question, from pages and golden-set files,
 * with each answer's text rendered from its pin as the page reads now.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "questions", "export");

function run(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

/** A fresh, built copy of the fixture, outside any repository. */
function built(): string {
  // realpath: macOS hands out /var/... while the CLI prints /private/var/...
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "manni-graph-export-questions-")));
  cpSync(fixture, cwd, { recursive: true });
  const b = run(["build"], cwd);
  expect(b.status, b.stdout + b.stderr).toBe(0);
  return cwd;
}

describe("manni graph export questions", () => {
  it("matches the golden byte-for-byte, beside the graph by default", () => {
    const cwd = built();
    const r = run(["export", "questions"], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toBe(`Wrote 8 questions to ${join(cwd, "questions.jsonl")}\n`);
    expect(readFileSync(join(cwd, "questions.jsonl"), "utf8")).toBe(
      readFileSync(join(fixture, "expected.jsonl"), "utf8"),
    );
    rmSync(cwd, { recursive: true, force: true });
  });

  it("warns once with the count of changed answers, exported as stale", () => {
    const cwd = built();
    const r = run(["export", "questions"], cwd);
    expect(r.stderr).toBe(
      "manni: 1 answer changed since it was pinned, so it is exported as it reads now, marked stale.\n",
    );
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes where -o says, and the same bytes twice", () => {
    const cwd = built();
    const a = run(["export", "questions", "-o", "eval/golden.jsonl"], cwd);
    expect(a.status, a.stdout + a.stderr).toBe(0);
    expect(a.stdout).toBe(`Wrote 8 questions to ${join(cwd, "eval", "golden.jsonl")}\n`);
    const first = readFileSync(join(cwd, "eval", "golden.jsonl"), "utf8");
    run(["export", "questions", "-o", "eval/golden.jsonl"], cwd);
    expect(readFileSync(join(cwd, "eval", "golden.jsonl"), "utf8")).toBe(first);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes an empty file when no question exists", () => {
    const cwd = built();
    writeFileSync(
      join(cwd, "manni.config.yaml"),
      readFileSync(join(cwd, "manni.config.yaml"), "utf8").replace("  questionFiles: [questions.yaml]\n", ""),
    );
    writeFileSync(
      join(cwd, "docs", "retry.md"),
      "---\ntitle: Retry a failed upload\ndescription: Send a failed upload again.\n---\n\nNo questions.\n",
    );
    expect(run(["build"], cwd).status).toBe(0);
    const r = run(["export", "questions"], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toBe(`Wrote 0 questions to ${join(cwd, "questions.jsonl")}\n`);
    expect(r.stderr).toBe("");
    expect(readFileSync(join(cwd, "questions.jsonl"), "utf8")).toBe("");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("lists questions among the targets an unknown one names", () => {
    const r = run(["export", "bogus"], fixture);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown export target "bogus". Use jsonld | iirds | search | questions.');
  });
});
