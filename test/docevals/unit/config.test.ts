import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig, loadConfig } from "../../../src/docevals/core/config.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import configSchema from "../../../src/docevals/core/config-schema.json" with { type: "json" };

const PATH = "/fake/manni.config.yaml";

/**
 * Nest a docevals config body under the `docevals:` key of a manni config, so
 * the tests read as the settings they exercise rather than as YAML plumbing.
 */
function inDocevals(...lines: string[]): string {
  return ["docevals:", ...lines.map((l) => (l === "" ? l : `  ${l}`))].join("\n") + "\n";
}

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig(inDocevals(), PATH);
    // No document set of its own: those are the family's `collections:`.
    expect(c.collections).toEqual([]);
    expect(c.defaults.concurrency).toBe(4);
    expect(c.provider).toBe("auto");
    expect(c.model).toBeNull();
    // Connection settings only; no model is manni's to choose.
    expect(c.providers).toEqual({
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      openai: { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
      "claude-cli": { command: "claude" },
      "llama-cpp": { modelsDir: null, thoughtTokens: 0 },
    });
    expect(c.judge.ensembleRuns).toBe(3);
    expect(c.judge.temperature).toBe(0);
    expect(c.judge.zones).toEqual({ autoPass: 0.8, autoFail: 0.8 });
    expect(c.judge.falsePositiveAlert).toBe(0.15);
    expect(c.judge.cacheDir).toBe(".manni/docevals/cache");
    expect(c.judge.maxTurns).toBeNull();
    // Default deny: nothing content-authored executes until an operator says so.
    expect(c.execution.allow).toEqual([]);
    expect(c.scripts.dir).toBe("{docDir}/manni-docevals");
    expect(c.scripts.configDir).toBe("manni-docevals-scripts");
    expect(c.evals).toEqual({});
    expect(c.suites).toEqual({});
  });

  it("ignores root keys belonging to other tools in the manni family", () => {
    const c = parseConfig(
      [
        "some-other-tool:",
        "  enabled: true",
        "  anything: { at: all }",
        "docevals:",
        "  defaults:",
        "    concurrency: 9",
      ].join("\n"),
      PATH,
    );
    expect(c.defaults.concurrency).toBe(9);
  });

  it("falls back to defaults when the file configures only other tools", () => {
    const c = parseConfig("some-other-tool:\n  enabled: true\n", PATH);
    expect(c.defaults.concurrency).toBe(4);
    expect(c.evals).toEqual({});
  });

  // The `--config <path>` flag hands parseConfig the file directly, bypassing
  // loadConfig's filename-based migration guard. Without this check a
  // pre-rename config passed with -c parses to pure defaults: zero evals, zero
  // suites, exit 0 — a green run that checked nothing.
  it("rejects a pre-rename config whose keys sit at the root", () => {
    const flat = ["files:", '  include: ["docs/**"]'].join("\n");
    expect(() => parseConfig(flat, PATH)).toThrow(DocevalsError);
    expect(() => parseConfig(flat, PATH)).toThrow(/docevals:/);
  });

  it("names the root keys it recognized as ours", () => {
    expect(() =>
      parseConfig(["suites:", "  s:", "    evals: []"].join("\n"), PATH),
    ).toThrow(/suites/);
  });

  it("still accepts a sibling-only file, even one with a nested files key", () => {
    expect(() =>
      parseConfig(["some-other-tool:", "  files: [a]"].join("\n"), PATH),
    ).not.toThrow();
  });

  it("rejects invalid YAML", () => {
    expect(() => parseConfig("docevals: [1", PATH)).toThrow(DocevalsError);
  });

  it("rejects a non-object root", () => {
    expect(() => parseConfig("- a\n- b\n", PATH)).toThrow(/root must be an object/);
  });

  it("rejects unknown keys inside the docevals namespace", () => {
    expect(() => parseConfig(inDocevals("runners: {}"), PATH)).toThrow(
      /Invalid config/,
    );
  });

  it("needs no version key", () => {
    expect(parseConfig(inDocevals("defaults: {}"), PATH).defaults.concurrency).toBe(4);
  });

  it("rejects version, which the section no longer carries", () => {
    expect(() => parseConfig(inDocevals("version: 1"), PATH)).toThrow(
      new DocevalsError(`Invalid config in ${PATH}:\n  /docevals: unknown key "version"`),
    );
  });

  it("parses evals and suites, defaulting targetPassRate to 1.0", () => {
    const c = parseConfig(
      inDocevals(
        "evals:",
        "  my-eval:",
        "    assertion: Something is true.",
        "suites:",
        "  ref:",
        "    evals: [my-eval]",
      ),
      PATH,
    );
    // `criteria` defaults to the empty list rather than being omitted, so
    // downstream code reads one shape — the same rule every other default in
    // parseConfig follows.
    expect(c.suites.ref).toEqual({
      targetPassRate: 1.0,
      evals: ["my-eval"],
      criteria: [],
    });
    expect(c.evals["my-eval"]?.assertion).toBe("Something is true.");
  });

  it("parses criteria, defaulting combine to all and weight to 1", () => {
    const c = parseConfig(
      inDocevals(
        "evals:",
        "  a:",
        "    assertion: A.",
        "  b:",
        "    assertion: B.",
        "criteria:",
        "  install-works:",
        "    evals: [a, b]",
        "suites:",
        "  ref:",
        "    evals: [a, b]",
        "    criteria: [install-works]",
      ),
      PATH,
    );
    expect(c.criteria["install-works"]).toEqual({
      evals: ["a", "b"],
      combine: "all",
      weight: 1,
    });
    expect(c.suites.ref?.criteria).toEqual(["install-works"]);
  });

  it("rejects a criterion referencing an undefined eval", () => {
    expect(() =>
      parseConfig(
        inDocevals("criteria:", "  broken:", "    evals: [ghost]"),
        PATH,
      ),
    ).toThrow(/criterion "broken" references undefined eval "ghost"/);
  });

  it("rejects a suite referencing an undefined criterion", () => {
    expect(() =>
      parseConfig(
        inDocevals("suites:", "  ref:", "    criteria: [ghost]"),
        PATH,
      ),
    ).toThrow(/suite "ref" references undefined criterion "ghost"/);
  });

  it("rejects a zero weight, which would silently disable an eval", () => {
    expect(() =>
      parseConfig(
        inDocevals(
          "evals:",
          "  a:",
          "    assertion: A.",
          "    weight: 0",
        ),
        PATH,
      ),
    ).toThrow();
  });

  it("rejects a runs count past the cap", () => {
    expect(() =>
      parseConfig(
        inDocevals("evals:", "  a:", "    assertion: A.", "    runs: 51"),
        PATH,
      ),
    ).toThrow();
  });

  it("reads a provider name and a model", () => {
    const c = parseConfig(
      inDocevals(
        "provider: llama-cpp",
        "model: quality",
        "providers:",
        "  llama-cpp:",
        "    thoughtTokens: 256",
      ),
      PATH,
    );
    expect(c.provider).toBe("llama-cpp");
    expect(c.model).toBe("quality");
    expect(c.providers["llama-cpp"].thoughtTokens).toBe(256);
  });

  it("accepts auto by name", () => {
    expect(parseConfig(inDocevals("provider: auto"), PATH).provider).toBe("auto");
  });

  it("refuses an unknown provider name with the shared message", () => {
    expect(() => parseConfig(inDocevals("provider: gemini"), PATH)).toThrow(
      new DocevalsError(
        'Unknown provider "gemini". Available: anthropic, openai, claude-cli, mock, llama-cpp, auto.',
      ),
    );
  });

  it("refuses the old provider object, saying where its settings went", () => {
    const hint = `; "provider" is now a provider name; per-provider settings moved to "providers"`;
    for (const body of [
      ["provider:", "  default: anthropic"],
      ["provider:", "  anthropic:", "    apiKeyEnv: KEY"],
    ]) {
      expect(() => parseConfig(inDocevals(...body), PATH)).toThrow(
        new DocevalsError(`Invalid config in ${PATH}:\n  /docevals/provider: must be string${hint}`),
      );
    }
  });

  it("rejects a model inside a provider's connection settings", () => {
    expect(() =>
      parseConfig(inDocevals("providers:", "  anthropic:", "    model: m"), PATH),
    ).toThrow(
      new DocevalsError(
        `Invalid config in ${PATH}:\n  /docevals/providers/anthropic: unknown key "model"`,
      ),
    );
  });

  it("rejects an unknown key inside the local provider section", () => {
    expect(() =>
      parseConfig(
        inDocevals("providers:", "  llama-cpp:", "    modle: quality"),
        PATH,
      ),
    ).toThrow(/Invalid config/);
  });

  it("rejects a suite referencing an undefined eval", () => {
    expect(() =>
      parseConfig(inDocevals("suites:", "  ref:", "    evals: [ghost]"), PATH),
    ).toThrow(/references undefined eval "ghost"/);
  });

  it("rejects an undefined defaults.suite", () => {
    expect(() =>
      parseConfig(inDocevals("defaults:", "  suite: ghost"), PATH),
    ).toThrow(/defaults\.suite "ghost"/);
  });

  // Judging is the expensive stage and its right parallelism is not the
  // corpus's: a local in-process model serves one context at a time, while
  // deterministic graders are happy at 4. Unset, it follows defaults.
  it("defaults judge.concurrency to defaults.concurrency", () => {
    expect(parseConfig(inDocevals(), PATH).judge.concurrency).toBe(4);
    const c = parseConfig(
      inDocevals("defaults:", "  concurrency: 8"),
      PATH,
    );
    expect(c.judge.concurrency).toBe(8);
  });

  it("lets judge.concurrency be set independently of defaults.concurrency", () => {
    const c = parseConfig(
      inDocevals(
        "defaults:",
        "  concurrency: 4",
        "judge:",
        "  concurrency: 1",
      ),
      PATH,
    );
    expect(c.defaults.concurrency).toBe(4);
    expect(c.judge.concurrency).toBe(1);
  });

  it("rejects a judge.concurrency below 1", () => {
    expect(() =>
      parseConfig(inDocevals("judge:", "  concurrency: 0"), PATH),
    ).toThrow(/Invalid config/);
  });

  it("applies fill defaults for a minimal config", () => {
    const c = parseConfig(inDocevals(), PATH);
    expect(c.fill).toEqual({
      confidenceThreshold: 0.7,
      maxEvalsPerPage: 3,
      temperature: 0,
      cacheDir: ".manni/docevals/cache/fill",
      maxTurns: null,
      chunkChars: 12000,
    });
  });

  it("respects explicit fill values", () => {
    const c = parseConfig(
      inDocevals(
        "fill:",
        "  confidenceThreshold: 0.9",
        "  maxEvalsPerPage: 1",
        "  temperature: 0.5",
        "  cacheDir: .cache/fill",
        "  maxTurns: 2",
      ),
      PATH,
    );
    expect(c.fill).toEqual({
      confidenceThreshold: 0.9,
      maxEvalsPerPage: 1,
      temperature: 0.5,
      cacheDir: ".cache/fill",
      maxTurns: 2,
      chunkChars: 12000,
    });
  });

  it("rejects unknown fill keys", () => {
    expect(() => parseConfig(inDocevals("fill:", "  bogus: true"), PATH)).toThrow(
      /Invalid config/,
    );
  });

  it("rejects an out-of-range fill confidenceThreshold", () => {
    expect(() =>
      parseConfig(inDocevals("fill:", "  confidenceThreshold: 1.5"), PATH),
    ).toThrow(/Invalid config/);
  });

  // Naming the key generalizes past the ADR 01019 migration. Ajv reports an
  // `additionalProperties` violation against the *parent*, so every typo under
  // `docevals:` used to arrive as "must NOT have additional properties"
  // pointing at a section with a dozen keys in it — true, and useless.
  it("names the offending key, not just the section holding it", () => {
    expect(() =>
      parseConfig(inDocevals("judge:", "  nonsense: 1"), PATH),
    ).toThrow(/\/docevals\/judge: unknown key "nonsense"/);
  });

  // "Stop after this many inference calls" has no meaningful zero: a budget of
  // 0 skips every target and reports nothing, which is not what anyone means by
  // it. The floor lives in the schema, so both sections inherit it (ADR 01019).
  it("rejects a max-turns below the floor of 1", () => {
    for (const section of ["judge", "fill"] as const) {
      expect(() =>
        parseConfig(inDocevals(`${section}:`, "  maxTurns: 0"), PATH),
      ).toThrow(/Invalid config/);
    }
  });

  it("rejects invalid eval names", () => {
    expect(() =>
      parseConfig(inDocevals("evals:", "  Bad_Name:", "    assertion: x"), PATH),
    ).toThrow(/Invalid config/);
  });
});

describe("loadConfig", () => {
  /** The moose-docevals filename. Spelled out here so a rename sweep can't erase it. */
  const LEGACY = "docevals" + ".config.yaml";
  const dir = () => mkdtempSync(join(tmpdir(), "manni-docevals-config-"));

  it("discovers manni.config.yaml in the working directory", () => {
    const root = dir();
    writeFileSync(join(root, "manni.config.yaml"), inDocevals("defaults:", "  concurrency: 7"));
    expect(loadConfig(undefined, root).defaults.concurrency).toBe(7);
  });

  it("returns built-in defaults when no config file is present", () => {
    const c = loadConfig(undefined, dir());
    expect(c.configSource).toBeNull();
    expect(c.evals).toEqual({});
  });

  // docevals never shipped under this file name in manni, so it has no legacy
  // name to read, as cite and a11y have none: the file is not config at all.
  it("does not read a docevals.config.yaml", () => {
    const root = dir();
    writeFileSync(join(root, LEGACY), "defaults:\n  concurrency: 9\n");
    resetWarnings();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const c = loadConfig(undefined, root);
      expect(c.configSource).toBeNull();
      expect(c.defaults.concurrency).toBe(4);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it("reads manni.config.yaml when a docevals.config.yaml sits beside it", () => {
    const root = dir();
    writeFileSync(join(root, LEGACY), "defaults:\n  concurrency: 9\n");
    writeFileSync(
      join(root, "manni.config.yaml"),
      inDocevals("defaults:", "  concurrency: 5"),
    );
    expect(loadConfig(undefined, root).defaults.concurrency).toBe(5);
  });
});

/**
 * Config discovery walks up (proposal 0004).
 *
 * A repo keeps one `manni.config.yaml` at its root, and people run the CLI
 * from wherever they are — `docs/`, a package directory, a worktree subdir.
 * Looking only in `cwd` meant every one of those runs resolved to pure
 * defaults: no named evals, no suites, and a green exit reporting nothing. The
 * config was right there one directory up.
 */
describe("loadConfig discovery", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "manni-docevals-discovery-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "docs", "deep"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeConfig = (dir: string, body: string): void => { writeFileSync(join(dir, "manni.config.yaml"), body); };

  const SIMPLE = [
    "docevals:",
    "  evals:",
    "    from-root:",
    "      assertion: Something.",
    "  suites:",
    "    s: { evals: [from-root] }",
  ].join("\n");

  it("finds a config in an ancestor directory", () => {
    writeConfig(root, SIMPLE);
    const config = loadConfig(undefined, join(root, "docs", "deep"));
    expect(Object.keys(config.evals)).toEqual(["from-root"]);
    expect(config.configPath).toBe(resolve(root, "manni.config.yaml"));
  });

  it("prefers the nearest config to a farther one", () => {
    writeConfig(root, SIMPLE);
    writeConfig(
      join(root, "docs"),
      ["docevals:", "  evals:", "    from-docs:", "      assertion: Nearer."].join("\n"),
    );
    const config = loadConfig(undefined, join(root, "docs", "deep"));
    expect(Object.keys(config.evals)).toEqual(["from-docs"]);
  });

  it("stops at the repository root rather than escaping the project", () => {
    // Without a boundary the walk reaches the home directory and beyond, and
    // picks up a config belonging to an unrelated project.
    const outside = mkdtempSync(join(tmpdir(), "manni-docevals-outside-"));
    try {
      const inner = join(outside, "repo");
      mkdirSync(join(inner, ".git"), { recursive: true });
      mkdirSync(join(inner, "docs"), { recursive: true });
      writeConfig(outside, SIMPLE); // above the repo root — must not be found
      const config = loadConfig(undefined, join(inner, "docs"));
      expect(config.evals).toEqual({});
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("walks past a docevals.config.yaml to the manni.config.yaml above it", () => {
    writeConfig(root, SIMPLE);
    writeFileSync(join(root, "docs", "docevals.config.yaml"), "defaults:\n  concurrency: 9\n");
    const config = loadConfig(undefined, join(root, "docs", "deep"));
    expect(config.configPath).toBe(resolve(root, "manni.config.yaml"));
  });

  it("still resolves to defaults when no config exists anywhere", () => {
    const config = loadConfig(undefined, join(root, "docs", "deep"));
    expect(config.configSource).toBeNull();
    expect(config.evals).toEqual({});
  });
});

/**
 * `max-cost-usd` is gone, replaced by `max-turns` (ADR 01019). The whole value
 * of a breaking removal is that it breaks loudly: a config still carrying the
 * old ceiling must be told so, not quietly run unbounded. Quiet is the worse
 * failure here — the key exists to *stop* spending, so ignoring it spends.
 */
describe("parseConfig rejects the removed cost ceiling", () => {
  for (const section of ["judge", "fill"] as const) {
    it(`rejects ${section}.max-cost-usd instead of ignoring it`, () => {
      const parse = () =>
        parseConfig(inDocevals(`${section}:`, "  max-cost-usd: 2"), PATH);
      // DocevalsError is the exit-2 path: a stale config aborts the run.
      expect(parse).toThrow(DocevalsError);
      // And names the retired key, so the message carries the migration.
      expect(parse).toThrow(
        new RegExp(`/docevals/${section}: unknown key "max-cost-usd"`),
      );
    });
  }
});

/**
 * The camelCase migration guard must not fire on keys it does not own.
 * `options` is an open object — a grader's runtime contract — so a key named
 * `generated` there is legal config, not a leftover `generated.assertionHash`
 * wrapper. Rejecting it produces an error whose advice cannot be followed.
 */
describe("parseConfig camelCase guard", () => {
  it("names a stale eval-definition wrapper", () => {
    expect(() =>
      parseConfig(
        inDocevals(
          "evals:",
          "  e:",
          "    assertion: x",
          "    grader: command",
          '    command: ["a"]',
          "    generated:",
          "      assertionHash: abc",
        ),
        PATH,
      ),
    ).toThrow(/generated-assertion-hash/);
  });

  it("leaves a grader option named `generated` alone", () => {
    const c = parseConfig(
      inDocevals(
        "evals:",
        "  e:",
        "    assertion: x",
        "    grader: tool:whatever",
        "    options:",
        "      generated: true",
      ),
      PATH,
    );
    expect(c.evals.e?.options).toEqual({ generated: true });
  });

  it("still catches camelCase inside grader options", () => {
    expect(() =>
      parseConfig(
        inDocevals(
          "evals:",
          "  e:",
          "    assertion: x",
          "    grader: tool:freshness",
          "    options:",
          "      maxAgeDays: 30",
        ),
        PATH,
      ),
    ).toThrow(/max-age-days/);
  });
});

/**
 * Section keys are camelCase, as every manni tool's are. The entries under
 * `evals:`, `criteria:` and `suites:` stay kebab-case: they are the same
 * entries a page carries, in the vocabulary's spelling.
 */
describe("parseConfig camelCase section keys", () => {
  const RENAMED: readonly [string[], string, string][] = [
    [["defaults:"], "fail-fast: true", "failFast"],
    [["providers:", "  anthropic:"], "api-key-env: KEY", "apiKeyEnv"],
    [["providers:", "  openai:"], "api-key-env: KEY", "apiKeyEnv"],
    [["providers:", "  openai:"], "base-url: http://localhost", "baseUrl"],
    [["providers:", "  llama-cpp:"], "models-dir: models", "modelsDir"],
    [["providers:", "  llama-cpp:"], "thought-tokens: 64", "thoughtTokens"],
    [["judge:"], "ensemble-runs: 5", "ensembleRuns"],
    [["judge:", "  zones:"], "auto-pass: 0.9", "autoPass"],
    [["judge:", "  zones:"], "auto-fail: 0.9", "autoFail"],
    [["judge:"], "false-positive-alert: 0.2", "falsePositiveAlert"],
    [["judge:"], "cache-dir: .cache", "cacheDir"],
    [["judge:"], "max-turns: 3", "maxTurns"],
    [["judge:"], "chunk-chars: 100", "chunkChars"],
    [["scripts:"], "config-dir: scripts", "configDir"],
    [["scripts:"], "timeout-ms: 100", "timeoutMs"],
    [["fill:"], "confidence-threshold: 0.9", "confidenceThreshold"],
    [["fill:"], "max-evals-per-page: 2", "maxEvalsPerPage"],
    [["fill:"], "cache-dir: .cache", "cacheDir"],
    [["fill:"], "max-turns: 3", "maxTurns"],
    [["fill:"], "chunk-chars: 100", "chunkChars"],
  ];

  for (const [parents, line, camel] of RENAMED) {
    const kebab = line.slice(0, line.indexOf(":"));
    const at = `/docevals/${parents.map((p) => p.trim().replace(/:$/, "")).join("/")}`;
    const indent = "  ".repeat(parents.length);

    it(`reads ${at}/${camel}`, () => {
      const c = parseConfig(inDocevals(...parents, `${indent}${camel}${line.slice(kebab.length)}`), PATH);
      expect(c.configSource).toBe(PATH);
    });

    it(`rejects ${kebab} under ${at}, naming ${camel}`, () => {
      expect(() => parseConfig(inDocevals(...parents, `${indent}${line}`), PATH)).toThrow(
        new DocevalsError(
          `Invalid config in ${PATH}:\n  ${at}: unknown key "${kebab}"; did you mean "${camel}"?`,
        ),
      );
    });
  }

  it("resolves every camelCase key to its value", () => {
    const c = parseConfig(
      inDocevals(
        "defaults:",
        "  failFast: true",
        "providers:",
        "  anthropic:",
        "    apiKeyEnv: A_KEY",
        "  openai:",
        "    baseUrl: http://localhost:11434/v1",
        "    apiKeyEnv: O_KEY",
        "  llama-cpp:",
        "    modelsDir: models",
        "    thoughtTokens: 64",
        "judge:",
        "  ensembleRuns: 5",
        "  zones:",
        "    autoPass: 0.9",
        "    autoFail: 0.7",
        "  falsePositiveAlert: 0.2",
        "  cacheDir: .cache/judge",
        "  maxTurns: 40",
        "  chunkChars: 8000",
        "scripts:",
        "  configDir: checks",
        "  timeoutMs: 5000",
        "fill:",
        "  confidenceThreshold: 0.9",
        "  maxEvalsPerPage: 2",
        "  cacheDir: .cache/fill",
        "  maxTurns: 10",
        "  chunkChars: 6000",
      ),
      PATH,
    );
    expect(c.defaults.failFast).toBe(true);
    expect(c.providers.anthropic.apiKeyEnv).toBe("A_KEY");
    expect(c.providers.openai).toMatchObject({ baseUrl: "http://localhost:11434/v1", apiKeyEnv: "O_KEY" });
    expect(c.providers["llama-cpp"]).toMatchObject({ modelsDir: "models", thoughtTokens: 64 });
    expect(c.judge).toMatchObject({
      ensembleRuns: 5,
      zones: { autoPass: 0.9, autoFail: 0.7 },
      falsePositiveAlert: 0.2,
      cacheDir: ".cache/judge",
      maxTurns: 40,
      chunkChars: 8000,
    });
    expect(c.scripts).toMatchObject({ configDir: "checks", timeoutMs: 5000 });
    expect(c.fill).toMatchObject({
      confidenceThreshold: 0.9,
      maxEvalsPerPage: 2,
      cacheDir: ".cache/fill",
      maxTurns: 10,
      chunkChars: 6000,
    });
  });

  it("gives no hint for an unknown key with no camelCase counterpart", () => {
    expect(() => parseConfig(inDocevals("judge:", "  max-cost-usd: 2"), PATH)).toThrow(
      new DocevalsError(`Invalid config in ${PATH}:\n  /docevals/judge: unknown key "max-cost-usd"`),
    );
  });

  it("keeps eval, criterion and suite entries kebab-case", () => {
    const c = parseConfig(
      inDocevals(
        "evals:",
        "  run-it:",
        "    grader: command",
        '    command: ["node", "check.mjs"]',
        "    success-exit-codes: [0, 3]",
        "    timeout-ms: 900",
        "    severity-map: { warning: notice }",
        "suites:",
        "  ref:",
        "    target-pass-rate: 0.5",
        "    evals: [run-it]",
      ),
      PATH,
    );
    expect(c.evals["run-it"]).toMatchObject({ successExitCodes: [0, 3], timeoutMs: 900 });
    expect(c.suites.ref?.targetPassRate).toBe(0.5);
  });

  it("still names a camelCase key inside an eval entry and its kebab spelling", () => {
    expect(() =>
      parseConfig(
        inDocevals("evals:", "  run-it:", "    grader: command", '    command: ["a"]', "    timeoutMs: 900"),
        PATH,
      ),
    ).toThrow(/docevals\.evals\.run-it\.timeoutMs -> timeout-ms/);
    expect(() =>
      parseConfig(inDocevals("suites:", "  ref:", "    targetPassRate: 0.5"), PATH),
    ).toThrow(/docevals\.suites\.ref\.targetPassRate -> target-pass-rate/);
  });
});

describe("config schema", () => {
  it("carries a manni $id", () => {
    expect(configSchema.$id).toBe("manni:config:docevals");
  });
});
