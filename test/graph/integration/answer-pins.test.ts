/**
 * A sample question can pin the lines that answer it (proposal 0087 § 7a),
 * end to end through the built CLI. `graph check` reads each page's questions
 * from its source, finds the section that holds a pinned answer, and reports
 * an answer that moved or changed. Each fixture under
 * test/graph/fixtures/questions/ is one feature.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "test", "graph", "fixtures", "questions");

function run(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

/** A fresh, built copy of one fixture, outside any repository. */
function built(feature: string, config?: (yaml: string) => string): string {
  const cwd = mkdtempSync(join(tmpdir(), `manni-graph-${feature}-`));
  cpSync(join(fixtures, feature), cwd, { recursive: true });
  if (config) {
    const path = join(cwd, "manni.config.yaml");
    writeFileSync(path, config(readFileSync(path, "utf8")));
  }
  const b = run(["build"], cwd);
  expect(b.status, b.stdout + b.stderr).toBe(0);
  return cwd;
}

const severity = (knob: string) => (y: string) =>
  y.replace("      top: 1", `      top: 1\n      severity: ${knob}`);

/** The finding lines of a pretty report, without the summary. */
function findings(stdout: string): string[] {
  return stdout.split("\n").filter((l) => /^(error|warning|notice): /.test(l));
}

const DOC = "https://example.com/graph/doc";

describe("a pinned answer", () => {
  it("must find the section that holds its lines, not just the page", () => {
    const cwd = built("pinned-answer");
    const r = run(["check"], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `warning: ${DOC}/docs/retry.md graph:sampleQuestion — "How many times does an upload retry by default?" does not find the section that answers it, § Retry limits, in the top 1 (it ranks 2; first is docs/retry.md § Retry a failed upload) [docs/retry.md]`,
    ]);
    expect(r.stdout).toContain("0 errors, 1 warning, 0 notices");
  });

  it("keeps 0086's finding shape in JSON", () => {
    const cwd = built("pinned-answer");
    const report = JSON.parse(run(["check", "-f", "json"], cwd).stdout) as {
      findings: Record<string, unknown>[];
    };
    expect(report.findings).toEqual([
      {
        severity: "warning",
        message:
          '"How many times does an upload retry by default?" does not find the section that answers it, § Retry limits, in the top 1 (it ranks 2; first is docs/retry.md § Retry a failed upload)',
        focusNode: `${DOC}/docs/retry.md`,
        path: "https://hawkeyexl.github.io/manni/graph/ns#sampleQuestion",
        docs: ["docs/retry.md"],
      },
    ]);
  });

  it("is found within a wider top", () => {
    const cwd = built("pinned-answer", (y) => y.replace("      top: 1", "      top: 2"));
    expect(findings(run(["check"], cwd).stdout)).toEqual([]);
  });

  it("skips a page that is not on disk, with one warning", () => {
    const cwd = built("pinned-answer");
    rmSync(join(cwd, "docs", "retry.md"));
    const r = run(["check"], cwd);
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([]);
    expect(r.stderr).toContain(
      "manni: 1 page in the graph is not on disk, so its questions were not checked; run manni graph build.",
    );
  });

  it("reads pins from an HTML page, whose body lines are its file lines", () => {
    const cwd = built("html-pins");
    const r = run(["check"], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `warning: ${DOC}/docs/guide.html graph:sampleQuestion — "How many times does an upload retry by default?" does not find the section that answers it, § Retry limits, in the top 1 (it ranks 2; first is docs/guide.html § Retry a failed upload) [docs/guide.html]`,
      `notice: ${DOC}/docs/guide.html graph:sampleQuestion — the answer to "How do I resume a paused upload?" moved from lines 16 to 19, so manni graph fill --fields sample-questions re-pins it. [docs/guide.html]`,
    ]);
  });
});

describe("an answer that moved or changed", () => {
  it("is checked at its new lines when it moved, with a notice", () => {
    const cwd = built("moved-answer");
    const r = run(["check"], cwd);
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `notice: ${DOC}/docs/upload.md graph:sampleQuestion — the answer to "How large may an upload be?" moved from lines 4-5 to 7-8, so manni graph fill --fields sample-questions re-pins it. [docs/upload.md]`,
    ]);
  });

  it("warns when two places match", () => {
    const cwd = built("ambiguous-move");
    const r = run(["check"], cwd);
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `warning: ${DOC}/docs/upload.md graph:sampleQuestion — the answer to "How large may an upload be?" moved, and lines 4 and 8 both match, so pin one of them by hand. [docs/upload.md]`,
    ]);
  });

  it("reports a changed answer at the questions severity", () => {
    const cwd = built("changed-answer");
    const r = run(["check"], cwd);
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `warning: ${DOC}/docs/upload.md graph:sampleQuestion — lines 4-5 no longer hold the answer to "How large may an upload be?" as pinned, so re-pair it with manni graph fill --fields sample-questions and review it. [docs/upload.md]`,
    ]);

    const strict = run(["check"], built("changed-answer", severity("error")));
    expect(strict.status).toBe(1);
    expect(findings(strict.stdout)[0]).toMatch(/^error: .* no longer hold the answer/);

    const off = run(["check"], built("changed-answer", severity("off")));
    expect(off.status).toBe(0);
    expect(findings(off.stdout)).toEqual([]);
  });

  it("still reports a move at severity off, which is not on the knob", () => {
    const cwd = built("moved-answer", severity("off"));
    expect(findings(run(["check"], cwd).stdout)).toHaveLength(1);
  });
});

describe("review state", () => {
  it("reports a drafted question at notice, whatever the knob says", () => {
    const expected = [
      `notice: ${DOC}/docs/upload.md graph:sampleQuestion — "Which archive formats can I upload?" does not find this page in the top 1 (it ranks 2; first is docs/archive.md) (drafted, not reviewed) [docs/upload.md]`,
      `notice: ${DOC}/docs/upload.md graph:sampleQuestion — lines 4 no longer hold the answer to "How large may an upload be?" as pinned, so re-pair it with manni graph fill --fields sample-questions and review it. (drafted, not reviewed) [docs/upload.md]`,
    ];
    const r = run(["check"], built("drafted"));
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual(expected);

    const strict = run(["check"], built("drafted", severity("error")));
    expect(strict.status).toBe(0);
    expect(findings(strict.stdout)).toEqual(expected);

    const off = run(["check"], built("drafted", severity("off")));
    expect(findings(off.stdout)).toEqual([]);
  });

  it("holds a confirmed question with a drafted pin to the page test, and the pin at notice", () => {
    const r = run(["check"], built("drafted-pin"));
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      `notice: ${DOC}/docs/retry.md graph:sampleQuestion — "How many times does an upload retry by default?" does not find the section that answers it, § Retry limits, in the top 1 (it ranks 2; first is docs/retry.md § Retry a failed upload) (answer not reviewed) [docs/retry.md]`,
    ]);
  });
});
