/**
 * `runKeyRotate`: every encrypted value in the family re-encrypted under a new
 * key, and the key written last (proposal 0045). Each case builds a small
 * family in a temp directory: a config holding the key and two collections,
 * two pages with an encrypted `owner`, and one page citing an encrypted source.
 * A `.git` directory is made by hand so discovery stops there and the source
 * root is the tree, and sources are indexed by a walk (`git: false`), so
 * nothing depends on git answering. Every run passes its own `env`, so a
 * developer's `MANNI_ENCRYPTION_KEY` is never read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { runCheck } from "../../src/cite/index.js";
import {
  KeyError,
  runKeyRotate,
  runKeySet,
  type KeyRotateOptions,
  type KeyRotateResult,
} from "../../src/key/index.js";
import { renderRotateJson } from "../../src/key/reporters/json.js";
import { renderRotatePretty } from "../../src/key/reporters/pretty.js";
import { runValidate } from "../../src/meta/index.js";
import { decryptValue, encryptValue } from "../../src/shared/encryption.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

/** Fixed test keys. Never real ones. */
const OLD = "rotate-old-key-0123456789abcdef01234567";
const NEW = "rotate-new-key-0123456789abcdef01234567";
const STRANGER = "stranger-key-0123456789abcdef0123456789";

const SOURCE = [
  "export const RETRIES = 3;",
  "export const FETCH_TIMEOUT_MS = 10_000;",
  "export const BACKOFF = 2;",
  "",
].join("\n");
const LINE_2 = { start: 2, end: 2 };

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    owner: { type: "string", enum: ["platform", "billing"], "x-manni-encrypt": true },
  },
  required: ["owner"],
});

const COLLECTIONS = [
  "collections:",
  "  - name: site",
  '    paths: ["docs/**/*.md"]',
  "  - name: blog",
  '    paths: ["blog/**/*.md"]',
  "",
].join("\n");

const BASELINE_NOTICE =
  "The citation baseline fingerprints id-less encrypted citations by their pin; re-record it with `manni cite check --write-baseline`.";
const UNFINISHED =
  "A rotation is unfinished in manni.config.yaml. Run `manni key rotate` with no --to to finish it.";

const ownerPage = (title: string, value: string, key = OLD): string =>
  `---\ntitle: ${title}\nowner: ${encryptValue(value, key, "meta")}\n---\n\n# ${title}\n`;

function citingPage(key: string): string {
  return [
    "---",
    "title: Limits",
    "citations:",
    "  - id: fetch-timeout",
    `    src: ${encryptSourcePath("src/limits.ts", key)}:2`,
    `    integrity: ${hashRange(SOURCE, LINE_2, key)}`,
    "    claim: The fetch timeout is 10 seconds.",
    "---",
    "",
    "The fetch timeout is 10 seconds.",
    "",
  ].join("\n");
}

const PAGES = ["docs/auth.md", "docs/limits.md", "blog/post.md"];

let dir: string | undefined;
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

/**
 * The family: `encryptionKey: OLD` in the config unless `key` says otherwise
 * (`null` for none), and every page encrypted under OLD.
 */
function family(opts: { key?: string | null; config?: string; extra?: Record<string, string> } = {}): string {
  const key = opts.key === undefined ? OLD : opts.key;
  const header = key === null ? "" : `encryptionKey: ${key}\n`;
  dir = makeTempRepo({
    init: false,
    files: {
      "manni.config.yaml": header + COLLECTIONS + (opts.config ?? ""),
      "schemas/page.schema.json": SCHEMA,
      "src/limits.ts": SOURCE,
      "docs/auth.md": ownerPage("Auth", "platform"),
      "docs/limits.md": citingPage(OLD),
      "blog/post.md": ownerPage("Post", "billing"),
      ...opts.extra,
    },
  });
  // A boundary for discovery and the source root, without git answering.
  mkdirSync(join(dir, ".git"));
  return dir;
}

function tree(): string {
  if (dir === undefined) throw new Error("no family built");
  return dir;
}

const read = (rel: string): string => readFileSync(join(tree(), rel), "utf8");
const readConfig = (): Record<string, unknown> =>
  parse(read("manni.config.yaml")) as Record<string, unknown>;

/** Every file's bytes, to prove a run wrote nothing. */
function snapshot(extra: readonly string[] = []): Record<string, string> {
  return Object.fromEntries(
    ["manni.config.yaml", ...PAGES, ...extra].map((rel) => [rel, read(rel)]),
  );
}

/** The `owner` ciphertext on a page. */
function ownerOf(rel: string): string {
  const m = /^owner: (~\S+)$/m.exec(read(rel));
  if (m?.[1] === undefined) throw new Error(`no owner on ${rel}`);
  return m[1];
}

/** The citation's `src` token on the limits page, without its line suffix. */
function srcOf(): string {
  const m = /src: (~[A-Za-z0-9_-]+):2$/m.exec(read("docs/limits.md"));
  if (m?.[1] === undefined) throw new Error("no encrypted src");
  return m[1];
}

function rotate(opts: Partial<KeyRotateOptions> = {}): Promise<KeyRotateResult> {
  return runKeyRotate({ inputs: [], cwd: tree(), env: {}, git: false, ...opts });
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

const pretty = (result: KeyRotateResult): string[] =>
  renderRotatePretty(result, { color: false }).split("\n");

const short = (token: string): string => `${token.slice(0, 5)}…`;

/** Whether every value in the family decrypts under `key`. */
function allUnder(key: string): boolean {
  return (
    decryptValue(ownerOf("docs/auth.md"), key, "meta").ok &&
    decryptValue(ownerOf("blog/post.md"), key, "meta").ok &&
    decryptValue(srcOf(), key, "cite-src").ok
  );
}

describe("runKeyRotate: a whole run", () => {
  it("re-encrypts every metadata value and citation, then writes the new key to the config", async () => {
    family();
    const before = { auth: ownerOf("docs/auth.md"), src: srcOf() };

    const result = await rotate();

    expect(result).toMatchObject({
      outcome: "written",
      keyWritten: true,
      reencrypted: 3,
      skipped: 0,
      exitCode: 0,
      configSource: "manni.config.yaml",
      baselineStale: false,
    });
    const config = readConfig();
    const key = config.encryptionKey;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    if (typeof key !== "string") throw new Error("no key written");
    expect(config).not.toHaveProperty("encryptionKeyPrevious");
    // The generated key is never carried out of the run.
    expect(JSON.stringify(result)).not.toContain(key);
    expect(allUnder(key)).toBe(true);
    expect(decryptValue(ownerOf("docs/auth.md"), key, "meta")).toEqual({ ok: true, value: "platform" });

    const lines = pretty(result);
    expect(lines).toContain(`docs/auth.md: /owner  ${short(before.auth)}  -> ${short(ownerOf("docs/auth.md"))}`);
    expect(lines).toContain(`docs/limits.md: fetch-timeout  ${short(before.src)}:2 -> ${short(srcOf())}:2`);
    expect(lines.slice(-2)).toEqual([
      "3 values re-encrypted in 3 files, 0 skipped",
      "Encryption key written to manni.config.yaml.",
    ]);
  });

  it("leaves the family valid under the new key: meta validates and cite checks", async () => {
    family();
    await rotate({ to: NEW });

    const inputs = ["docs/auth.md", "blog/post.md"];
    const cliSchemas = ["schemas/page.schema.json"];
    const validated = await runValidate({ inputs, cliSchemas, cwd: tree(), env: {} });
    expect(validated.summary.failed).toBe(0);
    // The control: under the old key the same pages no longer read, so the
    // pass above decrypted them rather than looking past them.
    const stale = await runValidate({ inputs, cliSchemas, cwd: tree(), env: { MANNI_ENCRYPTION_KEY: OLD } });
    expect(stale.summary.failed).toBe(2);

    const checked = await runCheck({ inputs: ["docs/limits.md"], cwd: tree(), env: {}, git: false });
    expect(checked.pages[0]?.citations.map((c) => c.status)).toEqual(["current"]);
    expect(checked.summary.failed).toBe(0);
  });

  it("renders the plan's JSON shape, with full ciphertexts", async () => {
    family();
    const before = { auth: ownerOf("docs/auth.md"), src: srcOf() };
    const result = await rotate({ to: NEW });
    const json = JSON.parse(renderRotateJson(result)) as {
      pages: { file: string; rewritten: unknown[]; skipped: unknown[]; written: boolean }[];
    } & Record<string, unknown>;

    expect(Object.keys(json)).toEqual(["pages", "reencrypted", "skipped", "keyWritten"]);
    expect(json).toMatchObject({ reencrypted: 3, skipped: 0, keyWritten: true });
    expect(json.pages).toContainEqual({
      file: "docs/auth.md",
      rewritten: [{ kind: "metadata", pointer: "/owner", from: before.auth, to: ownerOf("docs/auth.md") }],
      skipped: [],
      written: true,
    });
    const limits = json.pages.find((p) => p.file === "docs/limits.md");
    expect(limits?.rewritten).toEqual([
      expect.objectContaining({
        kind: "citation",
        id: "fetch-timeout",
        index: 0,
        from: `${before.src}:2`,
        to: `${srcOf()}:2`,
      }),
    ]);
    expect(renderRotateJson(result)).not.toContain(NEW);
  });

  it("refuses a --to of the wrong shape, without echoing it", async () => {
    family();
    expect(await refusal(rotate({ to: "tooshort" }))).toBe(
      "--to must be at least 32 hex or base64url characters.",
    );
  });

  it("refuses --collection beside paths, as every command does", async () => {
    family();
    expect(await refusal(rotate({ inputs: ["docs/auth.md"], collection: ["site"], to: NEW }))).toBe(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("refuses with no key available", async () => {
    family({ key: null });
    expect(await refusal(rotate())).toBe(
      "No encryption key is available, so nothing can be re-encrypted. Run `manni key set` first.",
    );
  });

  it("dry run re-encrypts in memory and writes nothing at all", async () => {
    family({ extra: { ".manni-cite-baseline.json": "{}\n" } });
    const before = snapshot();
    const result = await rotate({ dryRun: true });
    expect(result).toMatchObject({
      outcome: "dry-run",
      keyWritten: false,
      reencrypted: 3,
      exitCode: 0,
      baselineStale: false,
    });
    expect(result.pages.every((p) => !p.written)).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(pretty(result).at(-1)).toBe("Dry run: nothing written.");
  });
});

describe("runKeyRotate: a narrowed run", () => {
  it.each([
    ["positional paths", { inputs: ["docs/"] }],
    ["--collection", { collection: ["site"] }],
  ])("refuses without --to (%s), and writes nothing", async (_label, opts) => {
    family();
    const before = snapshot();
    expect(await refusal(rotate(opts))).toBe(
      "A run over part of the family needs --to, and never writes the key.",
    );
    expect(snapshot()).toEqual(before);
  });

  it("with --to, re-encrypts its part and never writes the key; a whole run under the same --to finishes", async () => {
    family();
    const narrowed = await rotate({ collection: ["site"], to: NEW });
    expect(narrowed).toMatchObject({ outcome: "narrowed", keyWritten: false, reencrypted: 2, exitCode: 0 });
    expect(readConfig().encryptionKey).toBe(OLD);
    expect(decryptValue(ownerOf("docs/auth.md"), NEW, "meta").ok).toBe(true);
    expect(decryptValue(ownerOf("blog/post.md"), OLD, "meta").ok).toBe(true);
    expect(pretty(narrowed).at(-1)).toBe(
      "Key not written: this run covered part of the family. Finish with a whole run under the same key: `manni key rotate --to <the same value>`.",
    );

    // The values already under NEW count as done; the rest are rotated.
    const whole = await rotate({ to: NEW });
    expect(whole).toMatchObject({ outcome: "written", keyWritten: true, reencrypted: 1, skipped: 0 });
    expect(readConfig().encryptionKey).toBe(NEW);
    expect(allUnder(NEW)).toBe(true);
  });

  it("a positional path is narrowed too", async () => {
    family();
    const result = await rotate({ inputs: ["docs/auth.md"], to: NEW });
    expect(result).toMatchObject({ outcome: "narrowed", reencrypted: 1, keyWritten: false });
    expect(readConfig().encryptionKey).toBe(OLD);
  });
});

describe("runKeyRotate: a key from the environment", () => {
  it("refuses without --to", async () => {
    family({ key: null });
    expect(await refusal(rotate({ env: { MANNI_ENCRYPTION_KEY: OLD } }))).toBe(
      "The key comes from MANNI_ENCRYPTION_KEY; pass --to <value>, re-encrypt with it, then update the secret. Nothing is written to config.",
    );
  });

  it("with --to, re-encrypts every page and never touches the config", async () => {
    family({ key: null });
    const config = read("manni.config.yaml");
    const result = await rotate({ env: { MANNI_ENCRYPTION_KEY: OLD }, to: NEW });
    expect(result).toMatchObject({ outcome: "env", keyWritten: false, reencrypted: 3, exitCode: 0 });
    expect(read("manni.config.yaml")).toBe(config);
    expect(allUnder(NEW)).toBe(true);
    expect(pretty(result).at(-1)).toBe(
      "Key not written: it comes from MANNI_ENCRYPTION_KEY. Update the secret to the value you passed.",
    );
  });
});

describe("runKeyRotate: every value, or none", () => {
  it("a value that decrypts under neither key is skipped, exit 1, and nothing is written", async () => {
    family({ extra: { "docs/stray.md": ownerPage("Stray", "platform", STRANGER) } });
    const before = snapshot(["docs/stray.md"]);
    const result = await rotate();

    expect(result).toMatchObject({ outcome: "skipped", keyWritten: false, skipped: 1, exitCode: 1 });
    expect(result.pages.every((p) => !p.written)).toBe(true);
    expect(snapshot(["docs/stray.md"])).toEqual(before);
    const lines = pretty(result);
    expect(lines).toContain("docs/stray.md: /owner  skipped: does not decrypt under the current key");
    expect(lines.at(-1)).toBe("Key not written: 1 value could not be re-encrypted. Fix it and rotate again.");
  });

  it("says how many, in the plural", async () => {
    family({
      extra: {
        "docs/stray.md": ownerPage("Stray", "platform", STRANGER),
        "blog/stray.md": ownerPage("Stray", "billing", STRANGER),
      },
    });
    const result = await rotate();
    expect(pretty(result).at(-1)).toBe(
      "Key not written: 2 values could not be re-encrypted. Fix them and rotate again.",
    );
  });
});

describe("runKeyRotate: an interrupted rotation", () => {
  /** A rotation to NEW that dies writing its second page. */
  async function interrupt(): Promise<void> {
    let calls = 0;
    const writePage = (path: string, content: string): Promise<void> => {
      calls++;
      if (calls > 1) return Promise.reject(new Error("interrupted"));
      // The key went first: by the first page write the config names both.
      expect(readConfig()).toMatchObject({ encryptionKey: NEW, encryptionKeyPrevious: OLD });
      writeFileSync(path, content, "utf8");
      return Promise.resolve();
    };
    await expect(rotate({ to: NEW, writePage })).rejects.toThrow("interrupted");
  }

  it("leaves both keys in the config, so no value is ever unreadable to the next run", async () => {
    family();
    await interrupt();
    expect(readConfig()).toMatchObject({ encryptionKey: NEW, encryptionKeyPrevious: OLD });
    const under = (key: string): number =>
      [
        decryptValue(ownerOf("docs/auth.md"), key, "meta").ok,
        decryptValue(ownerOf("blog/post.md"), key, "meta").ok,
        decryptValue(srcOf(), key, "cite-src").ok,
      ].filter(Boolean).length;
    // One page landed before the interruption and the rest did not: every
    // value is under one of the two keys the config names.
    expect(under(NEW)).toBe(1);
    expect(under(OLD)).toBe(2);
  });

  it.each([
    ["with no --to", {}],
    ["with --to the key it was rotating to", { to: NEW }],
  ])("a second run finishes it %s, and removes encryptionKeyPrevious", async (_label, opts) => {
    family();
    await interrupt();
    const result = await rotate(opts);

    expect(result).toMatchObject({ outcome: "finished", keyWritten: true, reencrypted: 2, skipped: 0, exitCode: 0 });
    expect(readConfig()).not.toHaveProperty("encryptionKeyPrevious");
    expect(readConfig().encryptionKey).toBe(NEW);
    expect(allUnder(NEW)).toBe(true);
    expect(pretty(result).slice(-2)).toEqual([
      "Finished the interrupted rotation in manni.config.yaml.",
      "2 values re-encrypted in 2 files, 0 skipped",
    ]);
  });

  it("refuses another --to, a narrowed run, and key set while it is unfinished", async () => {
    family();
    await interrupt();
    expect(await refusal(rotate({ to: STRANGER }))).toBe(UNFINISHED);
    expect(await refusal(rotate({ collection: ["blog"], to: NEW }))).toBe(UNFINISHED);
    expect(await refusal(runKeySet({ cwd: tree(), env: {} }))).toBe(UNFINISHED);
  });
});

describe("runKeyRotate: the citation baseline", () => {
  it("a writing run says the baseline needs re-recording when .manni-cite-baseline.json exists", async () => {
    family({ extra: { ".manni-cite-baseline.json": "{}\n" } });
    const result = await rotate();
    expect(result.baselineStale).toBe(true);
    expect(pretty(result).at(-1)).toBe(BASELINE_NOTICE);
  });

  it("finds a baseline cite.baseline names, relative to the config", async () => {
    family({ config: "cite:\n  baseline: records/cite.json\n", extra: { "records/cite.json": "{}\n" } });
    const result = await rotate();
    expect(result.baselineStale).toBe(true);
  });

  it("says nothing when there is no baseline", async () => {
    family();
    const result = await rotate();
    expect(result.baselineStale).toBe(false);
    expect(pretty(result)).not.toContain(BASELINE_NOTICE);
  });
});
