import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig, loadConfig } from "../../../src/docevals/core/config.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const PATH = "/fake/manni.config.yaml";

/**
 * Nest a docevals config body under the `docevals:` key of a moose config, so
 * the tests read as the settings they exercise rather than as YAML plumbing.
 */
function moose(...lines: string[]): string {
  return ["docevals:", ...lines.map((l) => (l === "" ? l : `  ${l}`))].join("\n") + "\n";
}

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig(moose("version: 1"), PATH);
    expect(c.files.include).toEqual(["**/*.{md,mdx}"]);
    expect(c.defaults.concurrency).toBe(4);
    expect(c.provider.default).toBe("anthropic");
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
        "  version: 1",
        "  defaults:",
        "    concurrency: 9",
      ].join("\n"),
      PATH,
    );
    expect(c.defaults.concurrency).toBe(9);
  });

  it("falls back to defaults when the file configures only other tools", () => {
    const c = parseConfig("some-other-tool:\n  enabled: true\n", PATH);
    expect(c.version).toBe(1);
    expect(c.defaults.concurrency).toBe(4);
    expect(c.evals).toEqual({});
  });

  // The `--config <path>` flag hands parseConfig the file directly, bypassing
  // loadConfig's filename-based migration guard. Without this check a
  // pre-rename config passed with -c parses to pure defaults: zero evals, zero
  // suites, exit 0 — a green run that checked nothing.
  it("rejects a pre-rename config whose keys sit at the root", () => {
    const flat = ["version: 1", "files:", '  include: ["docs/**"]'].join("\n");
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
    expect(() => parseConfig(moose("version: 1", "runners: {}"), PATH)).toThrow(
      /Invalid config/,
    );
  });

  it("rejects a missing version", () => {
    expect(() => parseConfig(moose("files: {}"), PATH)).toThrow(/version/);
  });

  it("parses evals and suites, defaulting targetPassRate to 1.0", () => {
    const c = parseConfig(
      moose(
        "version: 1",
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
      moose(
        "version: 1",
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
        moose("version: 1", "criteria:", "  broken:", "    evals: [ghost]"),
        PATH,
      ),
    ).toThrow(/criterion "broken" references undefined eval "ghost"/);
  });

  it("rejects a suite referencing an undefined criterion", () => {
    expect(() =>
      parseConfig(
        moose("version: 1", "suites:", "  ref:", "    criteria: [ghost]"),
        PATH,
      ),
    ).toThrow(/suite "ref" references undefined criterion "ghost"/);
  });

  it("rejects a zero weight, which would silently disable an eval", () => {
    expect(() =>
      parseConfig(
        moose(
          "version: 1",
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
        moose("version: 1", "evals:", "  a:", "    assertion: A.", "    runs: 51"),
        PATH,
      ),
    ).toThrow();
  });

  it("defaults the local provider to a named tier, not auto", () => {
    // A tier the library resolves against this machine, but a *named* one, so
    // two contributors reading the config see the same intent.
    const c = parseConfig(moose("version: 1"), PATH);
    expect(c.provider["llama-cpp"]).toEqual({
      model: "balanced",
      modelsDir: null,
      thoughtTokens: 0,
    });
  });

  it("accepts llama-cpp as the default provider", () => {
    const c = parseConfig(
      moose(
        "version: 1",
        "provider:",
        "  default: llama-cpp",
        "  llama-cpp:",
        "    model: quality",
        "    thought-tokens: 256",
      ),
      PATH,
    );
    expect(c.provider.default).toBe("llama-cpp");
    expect(c.provider["llama-cpp"].model).toBe("quality");
    expect(c.provider["llama-cpp"].thoughtTokens).toBe(256);
  });

  it("rejects an unknown key inside the local provider section", () => {
    expect(() =>
      parseConfig(
        moose("version: 1", "provider:", "  llama-cpp:", "    modle: quality"),
        PATH,
      ),
    ).toThrow(/Invalid config/);
  });

  it("rejects a suite referencing an undefined eval", () => {
    expect(() =>
      parseConfig(moose("version: 1", "suites:", "  ref:", "    evals: [ghost]"), PATH),
    ).toThrow(/references undefined eval "ghost"/);
  });

  it("rejects an undefined defaults.suite", () => {
    expect(() =>
      parseConfig(moose("version: 1", "defaults:", "  suite: ghost"), PATH),
    ).toThrow(/defaults\.suite "ghost"/);
  });

  // Judging is the expensive stage and its right parallelism is not the
  // corpus's: a local in-process model serves one context at a time, while
  // deterministic graders are happy at 4. Unset, it follows defaults.
  it("defaults judge.concurrency to defaults.concurrency", () => {
    expect(parseConfig(moose("version: 1"), PATH).judge.concurrency).toBe(4);
    const c = parseConfig(
      moose("version: 1", "defaults:", "  concurrency: 8"),
      PATH,
    );
    expect(c.judge.concurrency).toBe(8);
  });

  it("lets judge.concurrency be set independently of defaults.concurrency", () => {
    const c = parseConfig(
      moose(
        "version: 1",
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
      parseConfig(moose("version: 1", "judge:", "  concurrency: 0"), PATH),
    ).toThrow(/Invalid config/);
  });

  it("applies fill defaults for a minimal config", () => {
    const c = parseConfig(moose("version: 1"), PATH);
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
      moose(
        "version: 1",
        "fill:",
        "  confidence-threshold: 0.9",
        "  max-evals-per-page: 1",
        "  temperature: 0.5",
        "  cache-dir: .cache/fill",
        "  max-turns: 2",
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
    expect(() => parseConfig(moose("version: 1", "fill:", "  bogus: true"), PATH)).toThrow(
      /Invalid config/,
    );
  });

  it("rejects an out-of-range fill confidenceThreshold", () => {
    expect(() =>
      parseConfig(moose("version: 1", "fill:", "  confidence-threshold: 1.5"), PATH),
    ).toThrow(/Invalid config/);
  });

  // Naming the key generalizes past the ADR 01019 migration. Ajv reports an
  // `additionalProperties` violation against the *parent*, so every typo under
  // `docevals:` used to arrive as "must NOT have additional properties"
  // pointing at a section with a dozen keys in it — true, and useless.
  it("names the offending key, not just the section holding it", () => {
    expect(() =>
      parseConfig(moose("version: 1", "judge:", "  nonsense: 1"), PATH),
    ).toThrow(/\/docevals\/judge: unknown key "nonsense"/);
  });

  // "Stop after this many inference calls" has no meaningful zero: a budget of
  // 0 skips every target and reports nothing, which is not what anyone means by
  // it. The floor lives in the schema, so both sections inherit it (ADR 01019).
  it("rejects a max-turns below the floor of 1", () => {
    for (const section of ["judge", "fill"] as const) {
      expect(() =>
        parseConfig(moose("version: 1", `${section}:`, "  max-turns: 0"), PATH),
      ).toThrow(/Invalid config/);
    }
  });

  it("rejects invalid eval names", () => {
    expect(() =>
      parseConfig(moose("version: 1", "evals:", "  Bad_Name:", "    assertion: x"), PATH),
    ).toThrow(/Invalid config/);
  });
});

describe("loadConfig", () => {
  /** The pre-rename filename. Spelled out here so a rename sweep can't erase it. */
  const LEGACY = "docevals" + ".config.yaml";
  const dir = () => mkdtempSync(join(tmpdir(), "manni-docevals-config-"));

  it("discovers manni.config.yaml in the working directory", () => {
    const root = dir();
    writeFileSync(join(root, "manni.config.yaml"), moose("version: 1", "defaults:", "  concurrency: 7"));
    expect(loadConfig(undefined, root).defaults.concurrency).toBe(7);
  });

  it("returns built-in defaults when no config file is present", () => {
    const c = loadConfig(undefined, dir());
    expect(c.version).toBe(1);
    expect(c.evals).toEqual({});
  });

  // A legacy file must not fall through to defaults: that would run with no
  // named evals and no suites, and silently pass.
  it("errors on a legacy docevals.config.yaml instead of ignoring it", () => {
    const root = dir();
    writeFileSync(join(root, LEGACY), "version: 1\n");
    expect(() => loadConfig(undefined, root)).toThrow(DocevalsError);
    expect(() => loadConfig(undefined, root)).toThrow(/manni\.config\.yaml/);
  });

  it("prefers manni.config.yaml when a legacy file sits beside it", () => {
    const root = dir();
    writeFileSync(join(root, LEGACY), "version: 1\n");
    writeFileSync(
      join(root, "manni.config.yaml"),
      moose("version: 1", "defaults:", "  concurrency: 5"),
    );
    expect(loadConfig(undefined, root).defaults.concurrency).toBe(5);
  });
});

/**
 * Config discovery walks up (docmeta proposal 0004).
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
    "  version: 1",
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
      ["docevals:", "  version: 1", "  evals:", "    from-docs:", "      assertion: Nearer."].join("\n"),
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

  it("names an unmigrated config found during the walk", () => {
    // Silently walking past it would resolve to defaults and pass, which is
    // exactly what the cwd-level guard exists to prevent.
    writeFileSync(join(root, "docevals.config.yaml"), "version: 1\n");
    expect(() => loadConfig(undefined, join(root, "docs", "deep"))).toThrow(
      /docevals\.config\.yaml/,
    );
  });

  it("still resolves to defaults when no config exists anywhere", () => {
    const config = loadConfig(undefined, join(root, "docs", "deep"));
    expect(config.version).toBe(1);
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
        parseConfig(moose("version: 1", `${section}:`, "  max-cost-usd: 2"), PATH);
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
        moose(
          "version: 1",
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
      moose(
        "version: 1",
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
        moose(
          "version: 1",
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
