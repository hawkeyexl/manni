/**
 * `manni docevals --local`, against the built `dist/cli.js`: every verb that
 * sends a page to a model runs it on this machine with llama-cpp, whatever
 * `docevals.provider`, the family's `providers:` or an eval's own `provider:`
 * asks for, and says what it replaced.
 *
 * Nothing here reaches a model. The contradictions exit before a provider is
 * resolved. The override runs name a concrete llama-cpp model, so resolving
 * it probes nothing, and `--runs 2 --max-turns 1` skips every uncached
 * ensemble before it is dispatched, so no weights are loaded or fetched.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const PAGE = "test/docevals/fixtures/pages/docs/actions/find.mdx";
const LOCAL_MODEL = "granite-4.1-3b-q2";

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function manni(args: string[], cwd = ROOT, env: Record<string, string> = {}): Run {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Each verb that takes --local, with the arguments that reach selection. */
const VERBS: readonly (readonly string[])[] = [
  ["run", PAGE, "--deterministic-only", "--no-generate"],
  ["generate", PAGE],
  ["fill", PAGE, "--dry-run"],
  ["promote", PAGE],
  ["calibrate", "--golden", "test/docevals/fixtures/golden-does-not-exist"],
];

const contradicts = (provider: string): string =>
  `manni: --local and --provider ${provider} contradict each other: --local runs inference ` +
  "on this machine with llama-cpp. Drop one of them.\n";

/** A directory holding a `manni.config.yaml` and one page with two ai evals. */
function project(config: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-local-"));
  writeFileSync(join(dir, "manni.config.yaml"), [...config, ""].join("\n"));
  writeFileSync(
    join(dir, "guide.md"),
    [
      "---",
      "title: Guide",
      "evals:",
      "  - id: says-hello",
      "    assertion: The page says hello.",
      "  - id: names-openai",
      "    assertion: The page names a greeting.",
      "    provider: openai",
      "---",
      "# Guide",
      "",
      "Hello.",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("manni docevals --local", () => {
  for (const verb of VERBS) {
    const name = verb[0] ?? "";

    it(`${name}: documents --local in its help`, () => {
      const help = manni([name, "--help"]).stdout.replace(/\s+/g, " ");
      expect(help).toContain(
        "--local run inference on this machine (llama-cpp); overrides any configured or eval-level provider",
      );
    });

    it(`${name}: --local --provider anthropic is a contradiction, exit 2`, () => {
      const r = manni([...verb, "--local", "--provider", "anthropic"]);
      expect(r.stderr).toBe(contradicts("anthropic"));
      expect(r.status).toBe(2);
    });
  }

  it("run: --local --provider claude-cli is a contradiction too", () => {
    const r = manni([...(VERBS[0] ?? []), "--local", "--provider", "claude-cli"]);
    expect(r.stderr).toBe(contradicts("claude-cli"));
    expect(r.status).toBe(2);
  });

  it("run: --local overrides docevals.provider and an eval's provider:, saying each once", () => {
    const dir = project(["docevals:", "  provider: anthropic"]);
    const r = manni(
      ["run", "guide.md", "--local", "--model", LOCAL_MODEL, "--runs", "2", "--max-turns", "1"],
      dir,
      { ANTHROPIC_API_KEY: "sk-fake", OPENAI_API_KEY: "sk-fake" },
    );
    const notices = r.stderr.split("\n").filter((line) => line.includes("--local:"));
    expect(notices).toEqual([
      'manni: --local: using llama-cpp instead of "anthropic" from docevals.provider.',
      'manni: --local: using llama-cpp instead of "openai" from eval "names-openai" in guide.md.',
    ]);
    expect(r.stderr).not.toMatch(/provider unavailable/);
    expect(r.status).not.toBe(2);
  });

  it("run: --local overrides the family's providers.provider, naming it", () => {
    const dir = project(["providers:", "  provider: claude-cli"]);
    const r = manni(
      ["run", "guide.md", "--local", "--model", LOCAL_MODEL, "--runs", "2", "--max-turns", "1"],
      dir,
    );
    expect(r.stderr).toContain(
      'manni: --local: using llama-cpp instead of "claude-cli" from providers.provider.\n',
    );
    expect(r.status).not.toBe(2);
  });

  it("run: --local --deterministic-only is accepted and says nothing about providers", () => {
    const dir = project(["docevals:", "  provider: anthropic"]);
    const r = manni(["run", "guide.md", "--local", "--deterministic-only"], dir);
    expect(r.stderr).not.toMatch(/--local/);
    expect(r.stderr).not.toMatch(/provider unavailable/);
    expect(r.status).not.toBe(2);
  });
});
