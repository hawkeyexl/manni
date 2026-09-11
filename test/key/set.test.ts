/**
 * `runKeySet`: write the family encryption key to a config file (proposal
 * 0045). Repositories are built at runtime: a `.git` directory decides where
 * a new file goes and what `git check-ignore` says, and neither can be
 * committed as a fixture. Every run passes its own `env`, so a developer's
 * `MANNI_ENCRYPTION_KEY` is never read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { KeyError, runKeySet, type KeySetOptions } from "../../src/key/index.js";
import { setMessage } from "../../src/key/reporters/pretty.js";
import { committedKeyWarning } from "../../src/shared/encryption-key.js";
import { DOC, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
// Not all decimal digits: YAML would read such a key as a number.
const OTHER = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const hasGit = gitAvailable();

let dir: string | undefined;
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

function repo(files: Record<string, string>, init = true): string {
  dir = makeTempRepo({ files, init });
  return dir;
}

function readConfig(root: string, name = "manni.config.yaml"): Record<string, unknown> {
  return parse(readFileSync(join(root, name), "utf8")) as Record<string, unknown>;
}

/** A run with no environment key, collecting notices. */
function set(cwd: string, opts: Partial<KeySetOptions> = {}): {
  run: ReturnType<typeof runKeySet>;
  notices: string[];
} {
  const notices: string[] = [];
  const run = runKeySet({
    cwd,
    env: {},
    onNotice: (m) => notices.push(m),
    ...opts,
  });
  return { run, notices };
}

/** The refusal a run ends in: a `KeyError`, by message. */
async function refusal(run: Promise<unknown>): Promise<string> {
  const err: unknown = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(KeyError);
  return (err as Error).message;
}

describe("runKeySet", () => {
  it.skipIf(!hasGit)(
    "with no value and no config, generates 64 hex characters into a new manni.config.yaml at the git root",
    async () => {
      const root = repo({ "docs/a.md": DOC });
      const result = await set(join(root, "docs")).run;

      expect(result).toEqual({
        path: join(root, "manni.config.yaml"),
        source: "../manni.config.yaml",
        created: true,
        generated: true,
        dryRun: false,
      });
      const config = readConfig(root);
      expect(Object.keys(config)).toEqual(["encryptionKey"]);
      expect(config.encryptionKey).toMatch(/^[0-9a-f]{64}$/);
      expect(setMessage(result)).toBe("Encryption key written to ../manni.config.yaml.");
    },
  );

  it("writes a given value into the nearest family file, keeping its other keys", async () => {
    const root = repo({
      "manni.config.yaml": "# the family file\nmeta:\n  allowEmpty: true\n",
    });
    const result = await set(root, { value: KEY }).run;

    expect(result).toMatchObject({ source: "manni.config.yaml", created: false, generated: false });
    expect(readConfig(root)).toEqual({ meta: { allowEmpty: true }, encryptionKey: KEY });
    expect(readFileSync(join(root, "manni.config.yaml"), "utf8")).toMatch(/^# the family file\n/);
    expect(setMessage(result)).toBe("Encryption key written to manni.config.yaml.");
  });

  it("never carries the key in its result", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    const result = await set(root, { value: KEY }).run;
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("refuses a value of the wrong shape, without echoing it, and writes nothing", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    const message = await refusal(set(root, { value: "tooshort" }).run);
    expect(message).toBe(
      "The key must be at least 32 hex or base64url characters. Run `manni key set` with no value to generate one.",
    );
    expect(readConfig(root)).toEqual({ meta: {} });
  });

  it("refuses when a key is already configured: rotate is what replaces one", async () => {
    const root = repo({ "manni.config.yaml": `encryptionKey: ${KEY}\n` });
    const message = await refusal(set(root, { value: OTHER }).run);
    expect(message).toBe(
      "An encryption key is already configured in manni.config.yaml. Run `manni key rotate` to replace it and re-encrypt every value.",
    );
    expect(readConfig(root)).toEqual({ encryptionKey: KEY });
  });

  it("refuses while MANNI_ENCRYPTION_KEY is set, because the config's key would never be read", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    const message = await refusal(set(root, { env: { MANNI_ENCRYPTION_KEY: KEY } }).run);
    expect(message).toBe(
      "MANNI_ENCRYPTION_KEY is set, so a key written to config would never be read. Unset it, or keep the key in the secret.",
    );
    expect(readConfig(root)).toEqual({ meta: {} });
  });

  it("an empty MANNI_ENCRYPTION_KEY counts as unset, as an absent CI secret expands", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    await set(root, { value: KEY, env: { MANNI_ENCRYPTION_KEY: "" } }).run;
    expect(readConfig(root).encryptionKey).toBe(KEY);
  });

  it("refuses while a rotation is unfinished", async () => {
    const root = repo({
      "manni.config.yaml": `encryptionKey: ${KEY}\nencryptionKeyPrevious: ${OTHER}\n`,
    });
    const message = await refusal(set(root).run);
    expect(message).toBe(
      "A rotation is unfinished in manni.config.yaml. Run `manni key rotate` with no --to to finish it.",
    );
  });

  it.each(["docmeta.config.yaml", "docmeta.config.yml"])(
    "refuses to create manni.config.yaml beside a legacy %s, which it would hide",
    async (legacy) => {
      const root = repo({ [legacy]: "allowEmpty: true\n" }, false);
      const message = await refusal(set(root).run);
      expect(message).toBe(
        `${legacy} is a single-tool config; a manni.config.yaml beside it would hide it. Move its keys under meta: in manni.config.yaml first.`,
      );
      expect(existsSync(join(root, "manni.config.yaml"))).toBe(false);
    },
  );

  it("edits a family file that sits beside a legacy one: nothing new is created to hide it", async () => {
    const root = repo(
      { "manni.config.yaml": "meta: {}\n", "docmeta.config.yaml": "allowEmpty: true\n" },
      false,
    );
    await set(root, { value: KEY }).run;
    expect(readConfig(root).encryptionKey).toBe(KEY);
  });

  it.skipIf(!hasGit)("warns before writing a file git would publish", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    const { run, notices } = set(root, { value: KEY });
    await run;
    expect(notices).toEqual([committedKeyWarning("manni.config.yaml")]);
  });

  it.skipIf(!hasGit)("says nothing about git for a file git ignores", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n", ".gitignore": "manni.config.yaml\n" });
    const { run, notices } = set(root, { value: KEY });
    await run;
    expect(notices).toEqual([]);
  });

  it("--dry-run names the target and writes nothing", async () => {
    const root = repo({ "docs/a.md": DOC }, false);
    const result = await set(root, { dryRun: true }).run;
    expect(result).toMatchObject({ source: "manni.config.yaml", created: true, dryRun: true });
    expect(existsSync(join(root, "manni.config.yaml"))).toBe(false);
    expect(setMessage(result)).toBe("Would write encryptionKey to manni.config.yaml.");
  });

  it("-c names the file to write, whatever sections it carries", async () => {
    const root = repo({ "ops/manni.config.yaml": "meta:\n  allowEmpty: true\n" }, false);
    const result = await set(root, { value: KEY, configPath: "ops/manni.config.yaml" }).run;
    expect(result.source).toBe("ops/manni.config.yaml");
    expect(readConfig(root, "ops/manni.config.yaml")).toEqual({
      meta: { allowEmpty: true },
      encryptionKey: KEY,
    });
    expect(setMessage(result)).toBe("Encryption key written to ops/manni.config.yaml.");
  });

  it("-c at a missing file is an error, as it is for every command", async () => {
    const root = repo({}, false);
    expect(await refusal(set(root, { configPath: "nope.yaml" }).run)).toBe(
      'Config file not found: "nope.yaml".',
    );
  });

  it("-c at a single-tool file refuses: a top-level key would turn it into a family file", async () => {
    const root = repo({ "docmeta.config.yaml": "allowEmpty: true\n" }, false);
    const message = await refusal(set(root, { configPath: "docmeta.config.yaml" }).run);
    expect(message).toMatch(/^docmeta\.config\.yaml is a single-tool config file/);
    expect(readFileSync(join(root, "docmeta.config.yaml"), "utf8")).toBe("allowEmpty: true\n");
  });
});
