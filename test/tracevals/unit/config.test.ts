import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverConfig,
  loadConfig,
  parseConfig,
} from "../../../src/tracevals/core/config.js";
import { TracevalsError } from "../../../src/tracevals/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";

describe("parseConfig", () => {
  it("fills every default from an empty config", () => {
    const config = parseConfig({});
    expect(config.judge.ensembleRuns).toBe(3);
    expect(config.judge.temperature).toBe(0);
    expect(config.judge.zones).toEqual({ autoPass: 0.8, autoFail: 0.8 });
    expect(config.judge.cacheDir).toBe(".manni/tracevals/cache");
    expect(config.render.maxBlockChars).toBe(2000);
    expect(config.render.maxTotalChars).toBe(150000);
    expect(config.history.file).toBe(".manni/tracevals/history.jsonl");
    expect(config.capture.dir).toBe(".manni/tracevals/sessions");
    expect(config.failOnNeedsReview).toBe(true);
  });

  it("takes an explicit capture directory and rejects a bad one", () => {
    expect(parseConfig({ capture: { dir: "artifacts/manifests" } }).capture.dir).toBe(
      "artifacts/manifests",
    );
    expect(() => parseConfig({ capture: { dir: "" } })).toThrow(TracevalsError);
    expect(() => parseConfig({ capture: { nope: true } })).toThrow(
      TracevalsError,
    );
  });

  it("keeps explicit values", () => {
    const config = parseConfig({
      judge: { ensembleRuns: 5, maxCostUsd: 1.5 },
      failOnNeedsReview: false,
    });
    expect(config.judge.ensembleRuns).toBe(5);
    expect(config.judge.maxCostUsd).toBe(1.5);
    expect(config.failOnNeedsReview).toBe(false);
    // Untouched sections still get defaults.
    expect(config.judge.temperature).toBe(0);
  });

  it("fills fill defaults and honours explicit ones", () => {
    const config = parseConfig({});
    expect(config.fill.confidenceThreshold).toBe(0.7);
    expect(config.fill.maxEvalsPerArtifact).toBe(8);
    expect(config.fill.temperature).toBe(0);
    expect(config.fill.cacheDir).toBe(".manni/tracevals/cache/fill");
    expect(config.fill.maxCostUsd).toBeUndefined();

    const explicit = parseConfig({ fill: { confidenceThreshold: 0.5, maxCostUsd: 2 } });
    expect(explicit.fill.confidenceThreshold).toBe(0.5);
    expect(explicit.fill.maxCostUsd).toBe(2);
    expect(explicit.fill.maxEvalsPerArtifact).toBe(8);
  });

  it("rejects out-of-range and unknown fill keys", () => {
    expect(() => parseConfig({ fill: { confidenceThreshold: 2 } })).toThrow(
      TracevalsError,
    );
    expect(() => parseConfig({ fill: { maxEvalsPerArtifact: 0 } })).toThrow(
      TracevalsError,
    );
    expect(() => parseConfig({ fill: { bogus: true } })).toThrow(TracevalsError);
  });

  it("rejects invalid configs with an operational error", () => {
    expect(() => parseConfig({ judge: { ensembleRuns: 0 } })).toThrow(
      TracevalsError,
    );
    expect(() => parseConfig({ unknownKey: true })).toThrow(TracevalsError);
  });

  describe("plugins", () => {
    it("defaults to an empty list, so the read site never sees a hole", () => {
      expect(parseConfig({}).plugins).toEqual([]);
    });

    it("keeps declared module specifiers in order", () => {
      // Order is load order, and a later plugin wins a colliding kind — so it
      // is a value, not incidental.
      const config = parseConfig({
        plugins: ["./tracevals/graders.mjs", "@acme/tracevals-graders"],
      });
      expect(config.plugins).toEqual([
        "./tracevals/graders.mjs",
        "@acme/tracevals-graders",
      ]);
    });

    it("rejects a bare string, a non-string entry, and an empty specifier", () => {
      expect(() => parseConfig({ plugins: "./one.mjs" })).toThrow(TracevalsError);
      expect(() => parseConfig({ plugins: [1] })).toThrow(TracevalsError);
      expect(() => parseConfig({ plugins: [""] })).toThrow(TracevalsError);
    });
  });

  describe("graders.command.enabled", () => {
    it("defaults to enabled — ADR 01011 stands, this is only an opt-out", () => {
      expect(parseConfig({}).graders.command.enabled).toBe(true);
    });

    it("honours an explicit opt-out", () => {
      const config = parseConfig({ graders: { command: { enabled: false } } });
      expect(config.graders.command.enabled).toBe(false);
    });

    it("rejects unknown keys under graders", () => {
      expect(() => parseConfig({ graders: { commands: {} } })).toThrow(
        TracevalsError,
      );
      expect(() =>
        parseConfig({ graders: { command: { enabled: "no" } } }),
      ).toThrow(TracevalsError);
    });
  });

  describe("judge.redact", () => {
    it("defaults to an empty list — the built-ins are a floor, not a default", () => {
      expect(parseConfig({}).judge.redact).toEqual([]);
    });

    it("keeps declared patterns", () => {
      const config = parseConfig({ judge: { redact: ["ACME-[0-9]{4}"] } });
      expect(config.judge.redact).toEqual(["ACME-[0-9]{4}"]);
    });

    it("rejects a pattern that will not compile, at load time", () => {
      // An unusable pattern must not surface as a crash inside the judge, and
      // must never be silently dropped — that would be a silent leak.
      expect(() => parseConfig({ judge: { redact: ["("] } })).toThrow(
        TracevalsError,
      );
      expect(() => parseConfig({ judge: { redact: [""] } })).toThrow(
        TracevalsError,
      );
      expect(() => parseConfig({ judge: { redact: "secret" } })).toThrow(
        TracevalsError,
      );
    });
  });

  describe("provider section", () => {
    it("defaults to claude-cli so a fresh checkout needs no API key", () => {
      const config = parseConfig({});
      expect(config.provider.default).toBe("claude-cli");
      expect(config.provider["claude-cli"]).toEqual({
        model: "claude-sonnet-4-5",
        command: "claude",
      });
    });

    it("fills per-provider defaults for sections that were not configured", () => {
      const config = parseConfig({ provider: { default: "anthropic" } });
      expect(config.provider.anthropic).toEqual({
        model: "claude-sonnet-4-5",
        apiKeyEnv: "ANTHROPIC_API_KEY",
      });
      expect(config.provider.openai.baseUrl).toBe("https://api.openai.com/v1");
    });

    it("keeps explicit provider values, including a pricing override", () => {
      const config = parseConfig({
        provider: {
          default: "openai",
          openai: {
            baseUrl: "http://localhost:11434/v1",
            model: "qwen2.5",
            pricing: { inputPerMTok: 0, outputPerMTok: 0 },
          },
        },
      });
      expect(config.provider.openai.baseUrl).toBe("http://localhost:11434/v1");
      expect(config.provider.openai.model).toBe("qwen2.5");
      expect(config.provider.openai.pricing).toEqual({
        inputPerMTok: 0,
        outputPerMTok: 0,
      });
      // Untouched sections still get their defaults.
      expect(config.provider.anthropic.model).toBe("claude-sonnet-4-5");
    });

    it("rejects a typo'd provider name instead of silently defaulting", () => {
      // This section used to be an untyped passthrough, so `default: antropic`
      // or a misspelled section name sailed through validation and the run
      // quietly used a different provider than the author intended.
      expect(() => parseConfig({ provider: { default: "antropic" } })).toThrow(
        TracevalsError,
      );
      expect(() =>
        parseConfig({ provider: { anthropc: { model: "x" } } }),
      ).toThrow(TracevalsError);
    });

    it("rejects a typo'd key inside a provider section", () => {
      expect(() =>
        parseConfig({ provider: { anthropic: { modl: "x" } } }),
      ).toThrow(TracevalsError);
    });

    it("rejects an empty apiKeyEnv", () => {
      expect(() =>
        parseConfig({ provider: { anthropic: { apiKeyEnv: "" } } }),
      ).toThrow(TracevalsError);
    });

    it("rejects a half-specified pricing override", () => {
      expect(() =>
        parseConfig({
          provider: { anthropic: { pricing: { inputPerMTok: 3 } } },
        }),
      ).toThrow(TracevalsError);
    });
  });

  // Calibration knobs (ADR 01022). The sweep grid is config rather than a
  // flag because a corpus's useful range is a property of the corpus.
  describe("calibrate section", () => {
    it("fills the labels path and the sweep grid", () => {
      const config = parseConfig({});
      expect(config.calibrate.labels).toBe("tracevals/labels.yaml");
      expect(config.calibrate.sweep.ensembleRuns).toEqual([1, 3, 5]);
      expect(config.calibrate.sweep.autoPass).toEqual([
        0.5, 0.6, 0.7, 0.8, 0.9, 0.95,
      ]);
      expect(config.calibrate.sweep.autoFail).toEqual([
        0.5, 0.6, 0.7, 0.8, 0.9, 0.95,
      ]);
      // No threshold by default: a calibration run is a measurement, and a
      // measurement that fails by default is one nobody runs.
      expect(config.calibrate.maxFalsePass).toBeUndefined();
      expect(config.calibrate.maxFalseFail).toBeUndefined();
      expect(config.calibrate.maxReview).toBeUndefined();
    });

    it("keeps explicit values", () => {
      const config = parseConfig({
        calibrate: {
          labels: "eval/ground-truth.yaml",
          maxFalsePass: 0,
          maxFalseFail: 2,
          maxReview: 10,
          sweep: { ensembleRuns: [1, 2], autoPass: [0.75], autoFail: [0.75] },
        },
      });
      expect(config.calibrate.labels).toBe("eval/ground-truth.yaml");
      expect(config.calibrate.maxFalsePass).toBe(0);
      expect(config.calibrate.maxFalseFail).toBe(2);
      expect(config.calibrate.maxReview).toBe(10);
      expect(config.calibrate.sweep.ensembleRuns).toEqual([1, 2]);
    });

    it("rejects unknown keys, empty axes, and out-of-range thresholds", () => {
      expect(() => parseConfig({ calibrate: { bogus: true } })).toThrow(
        TracevalsError,
      );
      expect(() =>
        parseConfig({ calibrate: { sweep: { ensembleRuns: [] } } }),
      ).toThrow(TracevalsError);
      expect(() =>
        parseConfig({ calibrate: { sweep: { autoPass: [1.5] } } }),
      ).toThrow(TracevalsError);
      expect(() => parseConfig({ calibrate: { maxFalsePass: -1 } })).toThrow(
        TracevalsError,
      );
      expect(() =>
        parseConfig({ calibrate: { sweep: { ensembleRuns: [0] } } }),
      ).toThrow(TracevalsError);
    });
  });
});

describe("loadConfig", () => {
  let dir: string;
  /** What the shared discovery warned, per test. */
  let stderr: string[];
  let restoreStderr: () => void;

  beforeEach(async () => {
    // .tmp/ is gitignored, so a fresh checkout won't have it yet.
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "config-"));
    // Warnings are said once per process; forget them so each case can
    // assert its own.
    resetWarnings();
    stderr = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    restoreStderr = () => {
      spy.mockRestore();
    };
  });

  afterEach(async () => {
    restoreStderr();
    await rm(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: string) =>
    writeFile(join(dir, name), body, "utf-8");

  it("reads settings from the tracevals section of manni.config.yaml", async () => {
    await write(
      "manni.config.yaml",
      "tracevals:\n  judge:\n    ensembleRuns: 5\n  failOnNeedsReview: false\n",
    );
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(5);
    expect(config.failOnNeedsReview).toBe(false);
    // Untouched sections still get their defaults.
    expect(config.judge.temperature).toBe(0);
  });

  it("ignores sibling sections owned by other tools in the family", async () => {
    // The whole point of the shared file: docevals/docmeta keys are none of
    // our business and must not trip `additionalProperties: false`.
    await write(
      "manni.config.yaml",
      [
        "docevals:",
        "  judge:",
        "    ensembleRuns: 99",
        "docmeta:",
        "  schemas: [a, b]",
        "tracevals:",
        "  judge:",
        "    ensembleRuns: 5",
      ].join("\n") + "\n",
    );
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(5);
  });

  it("returns defaults when the file is absent", async () => {
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(3);
  });

  it("reads a plugins list out of the section", async () => {
    await write(
      "manni.config.yaml",
      "tracevals:\n  plugins:\n    - ./tracevals/graders.mjs\n",
    );
    const config = await loadConfig(dir);
    expect(config.plugins).toEqual(["./tracevals/graders.mjs"]);
  });

  it("returns defaults when the file holds only other tools' sections", async () => {
    await write("manni.config.yaml", "docmeta:\n  schemas: [a]\n");
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(3);
  });

  it("walks up from a subdirectory to the config, and reports its directory", async () => {
    // Shared family discovery (src/shared/config-file.ts): nearest directory
    // first, up to the repository root. Relative paths in the config resolve
    // against the directory the file was found in, not the working directory.
    await write("manni.config.yaml", "tracevals:\n  judge:\n    ensembleRuns: 5\n");
    const sub = join(dir, "nested", "deeper");
    await mkdir(sub, { recursive: true });
    const found = await discoverConfig(sub);
    expect(found.config.judge.ensembleRuns).toBe(5);
    expect(found.dir).toBe(resolve(dir));
  });

  it("reports the starting directory when no config exists", async () => {
    const found = await discoverConfig(dir);
    expect(found.config.judge.ensembleRuns).toBe(3);
    expect(found.dir).toBe(dir);
  });

  it("reads the pre-rename moose.config.yaml, with a warning", async () => {
    await write("moose.config.yaml", "tracevals:\n  judge:\n    ensembleRuns: 5\n");
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(5);
    expect(stderr.join("")).toMatch(/moose\.config\.yaml.*pre-rename/);
  });

  it("reads a legacy moose-tracevals.config.yaml whole, with a warning", async () => {
    // The tool's own file from before the family config carries the section
    // with no wrapper key. Still read, so an unmigrated project keeps its
    // settings; the warning says where they should move.
    await write("moose-tracevals.config.yaml", "judge:\n  ensembleRuns: 5\n");
    const config = await loadConfig(dir);
    expect(config.judge.ensembleRuns).toBe(5);
    expect(stderr.join("")).toMatch(/moose-tracevals\.config\.yaml.*deprecated/);
    expect(stderr.join("")).toMatch(/`tracevals:`/);
  });

  it("validates the tracevals section", async () => {
    await write("manni.config.yaml", "tracevals:\n  judge:\n    ensembleRuns: 0\n");
    await expect(loadConfig(dir)).rejects.toThrow(TracevalsError);
  });

  it("reports an unparseable file by path", async () => {
    await write("manni.config.yaml", "tracevals:\n  judge: [unclosed\n");
    await expect(loadConfig(dir)).rejects.toThrow(TracevalsError);
    await expect(loadConfig(dir)).rejects.toThrow(/manni\.config\.yaml: invalid YAML/);
  });

  it("rejects a file whose root is not a mapping", async () => {
    await write("manni.config.yaml", "- one\n- two\n");
    await expect(loadConfig(dir)).rejects.toThrow(TracevalsError);
    await expect(loadConfig(dir)).rejects.toThrow(/top level must be a mapping/);
  });
});
