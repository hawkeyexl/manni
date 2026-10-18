/**
 * Sample questions as findability checks (proposal 0085 §7), end to end
 * through the built CLI. `graph build` derives each page's questions, and
 * `graph check` asks each one through the retrieval `graph search` uses. A
 * page its own question does not find is a finding. Nothing judges an answer.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "sample-questions");

function run(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

/** A fresh copy of the fixture, built, outside any repository. */
function built(config?: (yaml: string) => string): string {
  const cwd = mkdtempSync(join(tmpdir(), "manni-graph-questions-"));
  cpSync(fixture, cwd, { recursive: true });
  if (config) {
    const path = join(cwd, "manni.config.yaml");
    writeFileSync(path, config(readFileSync(path, "utf8")));
  }
  const b = run(["build"], cwd);
  expect(b.status, b.stdout + b.stderr).toBe(0);
  return cwd;
}

const RANKED =
  'warning: https://example.com/graph/doc/docs/limits.md graph:sampleQuestion — "How do I retry a failed upload?" does not find this page in the top 1 (it ranks 2; first is docs/retry.md) [docs/limits.md]';
const LOST =
  'warning: https://example.com/graph/doc/docs/ledger.md graph:sampleQuestion — "Retry uploads?" does not find this page in the top 1 (it is not found; first is docs/retry.md) [docs/ledger.md]';
const HIDDEN =
  'warning: https://example.com/graph/doc/docs/hidden.md graph:sampleQuestion — "Retry uploads?" does not find this page in the top 1 (it is not found; first is docs/retry.md) [docs/hidden.md]';

describe("sample questions", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = built();
  });

  it("derives each question, tagged with the page language", () => {
    const turtle = readFileSync(join(cwd, "graph.ttl"), "utf8");
    expect(turtle).toContain(
      'graph:sampleQuestion "How do I retry a failed upload?"',
    );
    expect(turtle).toContain('"Wie richte ich den Proxy ein?"@de');
    expect(turtle).toContain('"How do I configure the proxy?"@en');
    // hidden.md's question is marked x-manni-graph-output: false.
    expect(turtle.split('"Retry uploads?"').length - 1).toBe(1);
  });

  it("reports a page ranked below the top, and one not found at all", () => {
    const r = run(["check"], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines).toContain(RANKED);
    expect(lines).toContain(LOST);
    // Found for its own question, in its own language.
    expect(lines.filter((l) => l.includes("docs/retry.md graph:sampleQuestion") && l.includes("does not find"))).toEqual([]);
    expect(r.stdout).not.toContain("proxy.md graph:sampleQuestion");
    // hidden.md's question stays out of the graph and is still asked, because
    // check reads questions from the page sources (proposal 0087).
    expect(lines).toContain(HIDDEN);
    // Two pages ask each question, so the second copy of each is reported
    // (proposal 0087 § 7b).
    expect(lines).toContain(
      'warning: https://example.com/graph/doc/docs/ledger.md graph:sampleQuestion — "Retry uploads?" is also asked on docs/hidden.md, so keep it where it is answered. [docs/ledger.md]',
    );
    expect(lines).toContain(
      'warning: https://example.com/graph/doc/docs/retry.md graph:sampleQuestion — "How do I retry a failed upload?" is also asked on docs/limits.md, so keep it where it is answered. [docs/retry.md]',
    );
    expect(r.stdout).toContain("0 errors, 5 warnings, 0 notices");
  });

  it("keeps the finding shape in JSON, with no SHACL severity", () => {
    const r = run(["check", "-f", "json"], cwd);
    const report = JSON.parse(r.stdout) as {
      findings: Array<Record<string, unknown>>;
    };
    const ours = report.findings.filter(
      (f) =>
        f.path === "https://hawkeyexl.github.io/manni/graph/ns#sampleQuestion" &&
        String(f.message).includes("does not find"),
    );
    expect(ours).toEqual([
      {
        severity: "warning",
        message:
          '"Retry uploads?" does not find this page in the top 1 (it is not found; first is docs/retry.md)',
        focusNode: "https://example.com/graph/doc/docs/hidden.md",
        path: "https://hawkeyexl.github.io/manni/graph/ns#sampleQuestion",
        docs: ["docs/hidden.md"],
      },
      {
        severity: "warning",
        message:
          '"Retry uploads?" does not find this page in the top 1 (it is not found; first is docs/retry.md)',
        focusNode: "https://example.com/graph/doc/docs/ledger.md",
        path: "https://hawkeyexl.github.io/manni/graph/ns#sampleQuestion",
        docs: ["docs/ledger.md"],
      },
      {
        severity: "warning",
        message:
          '"How do I retry a failed upload?" does not find this page in the top 1 (it ranks 2; first is docs/retry.md)',
        focusNode: "https://example.com/graph/doc/docs/limits.md",
        path: "https://hawkeyexl.github.io/manni/graph/ns#sampleQuestion",
        docs: ["docs/limits.md"],
      },
    ]);
  });

  it("is the same twice over unchanged inputs", () => {
    expect(run(["check"], cwd).stdout).toBe(run(["check"], cwd).stdout);
  });

  it("finds the page within a wider top", () => {
    const wide = built((y) => y.replace("      top: 1", "      top: 2"));
    const r = run(["check"], wide);
    expect(r.stdout).not.toContain("limits.md graph:sampleQuestion");
    expect(r.stdout).toContain("ledger.md graph:sampleQuestion");
  });

  it("fails the run at severity error", () => {
    const strict = built((y) =>
      y.replace("      top: 1", "      top: 1\n      severity: error"),
    );
    const r = run(["check"], strict);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      RANKED.replace("warning: ", "error: "),
    );
  });

  it("reports no question at severity off", () => {
    const off = built((y) => y.replace("      top: 1", "      top: 1\n      severity: off"));
    const r = run(["check"], off);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("sampleQuestion");
  });

  it("uses the vector sidecar beside the graph, and says when it is stale", () => {
    const hybrid = built();
    expect(run(["export", "search"], hybrid).status).toBe(0);
    const embed = run(
      ["embed", "--embedding-model", "mock", "--no-cache"],
      hybrid,
    );
    expect(embed.status, embed.stdout + embed.stderr).toBe(0);
    const fresh = run(["check"], hybrid);
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stderr).not.toContain("Falling back to lexical");

    // A page edited and rebuilt without re-embedding leaves the sidecar stale.
    const page = join(hybrid, "docs", "ledger.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("Archived", "Kept"));
    expect(run(["build"], hybrid).status).toBe(0);
    const stale = run(["check"], hybrid);
    expect(stale.status).toBe(0);
    expect(stale.stderr).toContain("Falling back to lexical");
  });
});
