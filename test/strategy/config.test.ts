/**
 * The `strategy:` section (proposal 0102). Every key has a default, and the
 * document set is `collections:`, so `paths` and `exclude` are refused by
 * name. A refusal never quotes a value back, except a severity level.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseStrategyConfig, resolveStrategyRun } from "../../src/strategy/core/config.js";
import { StrategyError } from "../../src/strategy/errors.js";

const SOURCE = "manni.config.yaml";
const parse = (raw: unknown) => parseStrategyConfig(raw, SOURCE);

describe("parseStrategyConfig", () => {
  it("treats an empty section as no keys", () => {
    expect(parse(null)).toEqual({});
  });

  it("reads every key", () => {
    expect(
      parse({
        severity: { "unserved-journey": "error", "unused-record": "off" },
        baseline: ".base.json",
        allowEmpty: true,
        respectGitignore: false,
      }),
    ).toEqual({
      severity: { "unserved-journey": "error", "unused-record": "off" },
      baseline: ".base.json",
      allowEmpty: true,
      respectGitignore: false,
    });
  });

  it("refuses a section that is not a mapping", () => {
    expect(() => parse([1])).toThrow(StrategyError);
    expect(() => parse([1])).toThrow(`strategy: in ${SOURCE} must be a mapping.`);
  });

  it.each(["paths", "exclude"])("refuses %s by name, pointing at collections", (key) => {
    expect(() => parse({ [key]: ["x"] })).toThrow(
      `${SOURCE}: strategy does not carry "${key}". Name a collection under collections:.`,
    );
  });

  it("refuses an unknown key, naming the supported ones", () => {
    expect(() => parse({ rules: {} })).toThrow(
      `Unknown key "rules" under strategy: in ${SOURCE}. Supported keys: severity, baseline, allowEmpty, respectGitignore.`,
    );
  });

  it("refuses an unknown rule, naming every rule", () => {
    expect(() => parse({ severity: { unserved: "error" } })).toThrow(
      `Unknown key "unserved" under strategy.severity: in ${SOURCE}. Supported keys: undefined-reference, duplicate-id, missing-parent, orphan-record, unserved-journey, unused-record.`,
    );
  });

  it("refuses a level that is not one, quoting a string level back", () => {
    expect(() => parse({ severity: { "unserved-journey": "fatal" } })).toThrow(
      `${SOURCE}: strategy.severity.unserved-journey "fatal" is not a level. Expected notice | warning | error | off.`,
    );
    expect(() => parse({ severity: { "unserved-journey": 3 } })).toThrow(
      `${SOURCE}: strategy.severity.unserved-journey is not a level. Expected notice | warning | error | off.`,
    );
  });

  it("refuses a value of the wrong type without quoting it", () => {
    expect(() => parse({ allowEmpty: "yes" })).toThrow(`strategy.allowEmpty in ${SOURCE} must be a boolean.`);
    expect(() => parse({ respectGitignore: "no" })).toThrow(`strategy.respectGitignore in ${SOURCE} must be a boolean.`);
    expect(() => parse({ baseline: 1 })).toThrow(`strategy.baseline in ${SOURCE} must be a string.`);
    expect(() => parse({ severity: [] })).toThrow(`strategy.severity in ${SOURCE} must be a mapping.`);
  });
});

describe("resolveStrategyRun", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function configured(yaml: string | null): Promise<string> {
    dir = await realpath(await mkdtemp(join(tmpdir(), "manni-strategy-config-")));
    if (yaml !== null) await writeFile(join(dir, "manni.config.yaml"), yaml);
    return dir;
  }

  const COLLECTIONS = 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n  - name: strategy\n    paths: ["strategy/**/*.md"]\n';

  it("falls back to every collection's paths, from the config directory", async () => {
    const cwd = await configured(COLLECTIONS);
    const run = await resolveStrategyRun({ cwd, inputs: [] });
    expect(run.inputs).toEqual(["docs/**/*.md", "strategy/**/*.md"]);
    expect(run.base).toBe(cwd);
    expect(run.fromCollections).toBe(true);
  });

  it("selects one collection", async () => {
    const cwd = await configured(COLLECTIONS);
    expect((await resolveStrategyRun({ cwd, inputs: [], collection: ["strategy"] })).inputs).toEqual(["strategy/**/*.md"]);
  });

  it("refuses --collection beside paths, without a config, and by an unknown name", async () => {
    const cwd = await configured(COLLECTIONS);
    await expect(resolveStrategyRun({ cwd, inputs: ["docs/"], collection: ["site"] })).rejects.toThrow(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
    await expect(resolveStrategyRun({ cwd, inputs: [], collection: ["nope"] })).rejects.toThrow(
      'no collection named "nope" in manni.config.yaml. Configured: site, strategy.',
    );
    const bare = await mkdtemp(join(tmpdir(), "manni-strategy-bare-"));
    try {
      await expect(resolveStrategyRun({ cwd: bare, inputs: [], collection: ["site"] })).rejects.toThrow(
        "--collection needs a config file to select from.",
      );
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("parses the strategy: section of the file it finds", async () => {
    const cwd = await configured(`${COLLECTIONS}strategy:\n  severity:\n    unserved-journey: error\n`);
    expect((await resolveStrategyRun({ cwd, inputs: [] })).config).toEqual({ severity: { "unserved-journey": "error" } });
  });
});
