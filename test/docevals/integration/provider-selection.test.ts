/**
 * `manni docevals` choosing a provider and model the way `manni meta fill`
 * does, against the built `dist/cli.js`: every verb that sends a page to a
 * model refuses the same selections, with meta's message and exit 2, and the
 * old `provider:` object names where its settings went.
 *
 * Every case exits before a provider is resolved, so nothing here probes the
 * machine, spawns the Claude CLI or reaches the network.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const PAGE = "test/docevals/fixtures/pages/docs/actions/find.mdx";

const UNKNOWN =
  'manni: Unknown provider "gemini". Available: anthropic, openai, claude-cli, mock, llama-cpp, auto.\n';
const NO_PROVIDER =
  'manni: Model "some-model" was given without a provider: a model name does not say ' +
  "which provider owns it. Set --provider or docevals.provider to one of anthropic, " +
  "openai, claude-cli, mock, llama-cpp, or drop the model to take the detected " +
  "provider's default.\n";

function manni(args: string[], cwd = ROOT): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** Each verb that takes --provider, with the arguments that reach selection. */
const VERBS: readonly (readonly string[])[] = [
  ["run", PAGE, "--deterministic-only", "--no-generate"],
  ["generate", PAGE],
  ["fill", PAGE, "--dry-run"],
  ["promote", PAGE],
  ["calibrate", "--golden", "test/docevals/fixtures/golden-does-not-exist"],
];

describe("manni docevals --provider and --model", () => {
  for (const verb of VERBS) {
    it(`${verb[0] ?? ""}: refuses an unknown provider, exit 2`, () => {
      const r = manni([...verb, "--provider", "gemini"]);
      expect(r.stderr).toBe(UNKNOWN);
      expect(r.status).toBe(2);
    });

    it(`${verb[0] ?? ""}: refuses a model under auto, exit 2`, () => {
      const r = manni([...verb, "--provider", "auto", "--model", "some-model"]);
      expect(r.stderr).toBe(NO_PROVIDER);
      expect(r.status).toBe(2);
    });
  }

  it("names auto as the default in run --help", () => {
    const help = manni(["run", "--help"]).stdout.replace(/\s+/g, " ");
    expect(help).toContain(
      "--provider <name> Judge provider: auto (default) | anthropic | openai | claude-cli | llama-cpp",
    );
    expect(help).toContain("--model <model> Model override; needs a named provider, from here or config");
  });
});

describe("docevals.provider in manni.config.yaml", () => {
  const withConfig = (docevals: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "manni-docevals-provider-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      ["docevals:", ...docevals.map((l) => `  ${l}`), ""].join("\n"),
    );
    return dir;
  };

  it("refuses the old provider object, naming the key and where its settings went", () => {
    const dir = withConfig(["provider:", "  default: anthropic", "  anthropic:", "    apiKeyEnv: KEY"]);
    const r = manni(["list"], dir);
    // The file is named by its absolute path, which differs per run.
    const [first, ...rest] = r.stderr.split("\n");
    expect(first).toMatch(/^manni: Invalid config in .*manni\.config\.yaml:$/);
    expect(rest.join("\n")).toBe(
      `  /docevals/provider: must be string; ` +
        `"provider" is now a provider name; per-provider settings moved to the top-level providers: map\n`,
    );
    expect(r.status).toBe(2);
  });

  it("refuses an unknown provider name, exit 2", () => {
    const r = manni(["list"], withConfig(["provider: gemini"]));
    expect(r.stderr).toBe(UNKNOWN);
    expect(r.status).toBe(2);
  });

  it("refuses a configured model under auto when a verb needs a provider, exit 2", () => {
    const r = manni(["generate", "--provider", "auto"], withConfig(["model: some-model"]));
    expect(r.stderr).toBe(NO_PROVIDER);
    expect(r.status).toBe(2);
  });
});
