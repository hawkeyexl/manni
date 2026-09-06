import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");

/**
 * Run the built CLI; returns { stdout, stderr, status }. Never throws on
 * nonzero exit. stderr is captured because dockg's error messages go there —
 * a test that can only see stdout can assert an exit code but not the reason.
 *
 * `spawnSync`, not `execFileSync`: the latter surfaces stderr only when the
 * child exits nonzero, so a success path can only ever hardcode `stderr: ""`.
 * That is not a smaller version of the truth — it is a value that makes any
 * assertion about it pass unconditionally. dockg writes warnings to stderr and
 * still exits 0 (ADR 01010), so the success path is exactly where a stderr
 * assertion has something to say.
 */
export function runCli(args: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(process.execPath, [cli, "kg", ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? root,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return {
    stdout,
    stderr,
    output: stdout + stderr,
    // spawnSync gives a null status when the process died on a signal or could
    // not be spawned; r.error carries the reason in the latter case.
    status: r.status ?? -1,
    error: r.error,
  };
}

describe("dockg CLI", () => {
  it("--help exits 0 and names the tool", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("manni kg");
  });

  it("--version exits 0", () => {
    const { status } = runCli(["--version"]);
    expect(status).toBe(0);
  });
});

describe("numeric options are range-checked", () => {
  // Every count-like flag, not just the ones a fill run happens to read. A raw
  // `Number.parseInt` accepts `abc` as NaN and `-1` as a negative count; both
  // then flow into a command core with no defence against either.
  //
  // Each case asserts the MESSAGE, not just exit 2. Run from the repo root
  // these commands exit 2 anyway — on a missing graph or search index — so a
  // status-only assertion would pass without the range check existing at all.
  const cases: Array<[string, string[], string]> = [
    ["a negative --top", ["stats", "--top", "-1"], "--top must be >= 1"],
    [
      "a non-numeric --top",
      ["stats", "--top", "abc"],
      "--top expects a number",
    ],
    [
      "a fractional --top",
      ["stats", "--top", "2.5"],
      "--top expects a whole number",
    ],
    ["a zero --limit", ["search", "q", "--limit", "0"], "--limit must be >= 1"],
    [
      "a negative --depth",
      ["traverse", "x", "--depth", "-2"],
      "--depth must be >= 0",
    ],
    [
      "a non-numeric traverse --limit",
      ["traverse", "x", "--limit", "abc"],
      "--limit expects a number",
    ],
    [
      "a --min-confidence above 1",
      ["fill", "--min-confidence", "5"],
      "--min-confidence must be 0..1",
    ],
    [
      "a negative --max-cost",
      ["fill", "--max-cost", "-1"],
      "--max-cost must be >= 0",
    ],
    // The one this sweep first missed. NaN here is worse than a wrong number:
    // `pct < NaN` is false for every field, so the coverage gate silently
    // passes rather than failing.
    [
      "a non-numeric --coverage-threshold",
      ["stats", "--check", "--coverage-threshold", "abc"],
      "--coverage-threshold expects a number",
    ],
    [
      "a --coverage-threshold above 100",
      ["stats", "--coverage-threshold", "101"],
      "--coverage-threshold must be 0..100",
    ],
  ];
  for (const [name, args, message] of cases) {
    it(`refuses ${name}`, () => {
      const { status, stderr } = runCli(args);
      expect(stderr, `stderr was: ${stderr}`).toContain(message);
      // Operational error, not a finding.
      expect(status).toBe(2);
    });
  }

  it("allows --depth 0, which means the node itself", () => {
    // The guard must not turn a meaningful value into an error. This gets as
    // far as the graph lookup, which is proof the parser let it through.
    const { stderr } = runCli(["traverse", "x", "--depth", "0"]);
    expect(stderr).not.toContain("--depth");
  });
});

describe("enum options are checked against the same list config is", () => {
  it("refuses an unknown --provider, naming the valid ones", () => {
    // `fill.provider` is Ajv-validated against the schema enum, but the CLI
    // override was an arbitrary string cast straight to ProviderName. The
    // documented precedence is config → Ajv → CLI override, so the override
    // has to be held to the same list.
    const { status, stderr } = runCli(["fill", "--provider", "bogus"]);
    expect(stderr).toContain("--provider must be one of");
    expect(stderr).toContain("llama-cpp");
    expect(status).toBe(2);
  });

  it("still accepts a real provider name", () => {
    const { stderr, status } = runCli(["fill", "--provider", "mock"]);
    // This assertion was vacuous until `runCli` captured stderr for real: the
    // helper hardcoded `stderr: ""` on the success path, so `not.toContain`
    // held no matter what the CLI wrote. The run does write to stderr — an
    // unpriceable-cap warning — so the empty string was not even close to
    // the truth, and it is now checked against what actually came back.
    expect(stderr).toContain("Cost cap of 5 USD cannot be enforced");
    expect(stderr).not.toContain("--provider must be one of");
    expect(status).toBe(0);
  });
});
