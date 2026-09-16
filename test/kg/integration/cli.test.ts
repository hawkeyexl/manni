import { spawnSync } from "node:child_process";
import { spawnText } from "../../helpers/spawn.js";
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
  const raw = spawnSync(process.execPath, [cli, "kg", ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? root,
  });
  // `spawnText` restores the `null` both streams really carry when the spawn
  // itself failed; `@types/node` promises a string once `encoding` is set, so
  // the guards below would otherwise read as dead code.
  const r = spawnText(raw);
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return {
    stdout,
    stderr,
    output: stdout + stderr,
    // spawnSync gives a null status when the process died on a signal or could
    // not be spawned; r.error carries the reason in the latter case.
    status: r.status ?? -1,
    error: raw.error,
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
      "a --confidence above 1",
      ["fill", "--confidence", "5"],
      "--confidence must be 0..1",
    ],
    [
      "a zero --max-turns",
      ["fill", "--max-turns", "0"],
      "--max-turns must be >= 1",
    ],
    [
      "a fractional --max-turns",
      ["fill", "--max-turns", "1.5"],
      "--max-turns expects a whole number",
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

describe("the provider flags are the family's", () => {
  it("refuses an unknown --provider, naming the ones on offer", () => {
    // `assertKnownProvider` from src/shared/providers.ts, the message
    // `manni meta fill` and `manni docevals` give. `mock` is accepted by name
    // and never listed (proposal 0051 §3).
    const { status, stderr } = runCli(["fill", "--provider", "bogus"]);
    expect(stderr).toContain(
      'Unknown provider "bogus". Available: anthropic, openai, claude-cli, llama-cpp, auto.',
    );
    expect(stderr).not.toContain("mock");
    expect(status).toBe(2);
  });

  it("refuses a --model with no provider to own it, naming kg.provider", () => {
    const { status, stderr } = runCli(["fill", "--model", "some-model"]);
    expect(stderr).toContain(
      'Model "some-model" was given without a provider',
    );
    expect(stderr).toContain("Set --provider or kg.provider to one of");
    expect(status).toBe(2);
  });

  it("refuses --local beside a hosted --provider", () => {
    const { status, stderr } = runCli([
      "fill",
      "x.md",
      "--local",
      "--provider",
      "anthropic",
    ]);
    expect(stderr).toContain(
      "--local and --provider anthropic contradict each other: --local runs inference on " +
        "this machine with llama-cpp. Drop one of them.",
    );
    expect(status).toBe(2);
  });

  it("refuses an unknown --fields value, naming the fillable ones", () => {
    const { status, stderr } = runCli(["fill", "--fields", "label,bogus"]);
    expect(stderr).toContain("--fields must be one of");
    expect(stderr).toContain("alt-labels");
    expect(status).toBe(2);
  });

  it("names the local flag and the turn budget in fill's help, and not the mock", () => {
    const { stdout, status } = runCli(["fill", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--local");
    expect(stdout).toContain("run inference on this machine (llama-cpp)");
    expect(stdout).toContain("--max-turns <n>");
    expect(stdout).toContain("--confidence <n>");
    expect(stdout).toContain("--fields <list>");
    // commander wraps the option column, so compare on collapsed whitespace.
    expect(stdout.replace(/\s+/g, " ")).toContain(
      "auto (default) | anthropic | openai | claude-cli | llama-cpp",
    );
    expect(stdout).not.toContain("--max-cost");
    expect(stdout).not.toContain("--min-confidence");
    // The test double is accepted by name and never offered (#10's rule).
    expect(stdout).not.toContain("mock");
  });
});
