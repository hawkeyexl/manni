/**
 * `x-manni-encrypt` in meta (proposal 0045): the schema keyword, what
 * `validate` does with a marked property, the writers (`fill`, `query`), the
 * external-metadata join, and `reencryptMetadata` for `manni key rotate`.
 *
 * Hermetic: every run is handed `env` explicitly, so the developer's own
 * `MANNI_ENCRYPTION_KEY` is never read, and every page holding a ciphertext is
 * written into a fresh temp directory under a fixed test key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { MockProvider } from "@hawkeyexl/inference";
import { runValidate } from "../src/meta/commands/validate.js";
import { runFill } from "../src/meta/commands/fill.js";
import { runQuery } from "../src/meta/commands/query.js";
import { Validator } from "../src/meta/core/validator.js";
import { reencryptWith } from "../src/meta/core/reencrypt.js";
import { reencryptMetadata } from "../src/meta/index.js";
import { renderFill } from "../src/meta/reporters/fill.js";
import { renderQuery } from "../src/meta/reporters/query.js";
import { RESERVED_RULES, ruleIdFor } from "../src/meta/reporters/rule-id.js";
import { extractorForExtension } from "../src/meta/extractors/index.js";
import { DocmetaError, type MetadataExtractor } from "../src/meta/types.js";
import { decryptValue, encryptValue } from "../src/shared/encryption.js";
import { ENCRYPTION_KEY_ENV } from "../src/shared/encryption-key.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "encrypted");
const SCHEMA = join(fixtures, "encrypted.schema.json");

/** Fixed test keys: never the developer's. */
const KEY = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const THIRD = "abcdefabcdefabcdefabcdefabcdefab";
const withKey = { [ENCRYPTION_KEY_ENV]: KEY };
const noKey = {};

const enc = (value: unknown, key = KEY): string => encryptValue(value, key, "meta");

const REFUSAL =
  "/owner must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-encrypted-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a Markdown page with this frontmatter into the scratch dir. */
async function page(name: string, data: Record<string, unknown>): Promise<string> {
  const abs = join(dir, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, `---\n${stringify(data)}---\n\n# Page\n`, "utf8");
  return name;
}

/** The frontmatter of a page in the scratch dir. */
function frontmatter(name: string): Record<string, unknown> {
  const extractor = extractorForExtension(".md");
  if (!extractor) throw new Error("no markdown extractor");
  return extractor.extract(readFileSync(join(dir, name), "utf8"), name).data;
}

function decrypts(token: unknown, key = KEY): unknown {
  if (typeof token !== "string") throw new Error(`not a token: ${String(token)}`);
  const opened = decryptValue(token, key, "meta");
  if (!opened.ok) throw new Error("does not decrypt");
  return opened.value;
}

const validateOpts = (inputs: string[], env: NodeJS.ProcessEnv) => ({
  inputs,
  cwd: dir,
  noConfig: true,
  cliSchemas: [SCHEMA],
  env,
});

describe("x-manni-encrypt: the keyword", () => {
  it("records a mark wherever the validator evaluates it: $ref, allOf, anyOf, if/then", async () => {
    const schema = join(fixtures, "composed.schema.json");
    const validator = new Validator();
    const data = {
      kind: "internal",
      owner: "a",
      service: "b",
      "internal-ticket": "c",
      "public-note": "d",
    };
    expect([...(await validator.markedPointers(data, [schema]))].sort()).toEqual([
      "/internal-ticket",
      "/owner",
      "/service",
    ]);
    // The `then` branch is not evaluated when the condition fails, so its mark
    // does not count.
    const pub = { ...data, kind: "public" };
    expect([...(await validator.markedPointers(pub, [schema]))].sort()).toEqual([
      "/owner",
      "/service",
    ]);
  });

  it("marks only values that are present", async () => {
    const marks = await new Validator().markedPointers({ title: "x" }, [SCHEMA]);
    expect([...marks]).toEqual([]);
  });

  it("refuses a value that is not true or false, naming the schema", async () => {
    await page("a.md", { owner: "x" });
    await cp(join(fixtures, "bad-mark.schema.json"), join(dir, "bad-mark.schema.json"));
    const run = runValidate({
      inputs: ["a.md"],
      cwd: dir,
      noConfig: true,
      cliSchemas: ["bad-mark.schema.json"],
      env: noKey,
    });
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      'bad-mark.schema.json: "x-manni-encrypt" must be true or false.',
    );
  });
});

describe("meta validate with a marked property", () => {
  it("files encrypted:plain for a plain value, whatever the key state", async () => {
    await writeFile(join(dir, "auth.md"), readFileSync(join(fixtures, "plain-owner.md")));
    for (const env of [noKey, withKey]) {
      const { results } = await runValidate(validateOpts(["auth.md"], env));
      const [result] = results;
      expect(result?.ok).toBe(false);
      expect(result?.errors).toEqual([
        {
          schema: "encrypted:plain",
          keyword: "encrypted",
          instancePath: "/owner",
          message: "/owner holds a plain value; its schema marks it x-manni-encrypt.",
          line: 3,
        },
      ]);
      const [finding] = result?.errors ?? [];
      if (!finding) throw new Error("no finding");
      expect(ruleIdFor(finding)).toBe("encrypted:plain/encrypted");
      // Fingerprinted on schema, pointer and keyword: never on a value.
      expect(finding.subject).toBeUndefined();
    }
  });

  it("reserves both rule ids", () => {
    expect(Object.keys(RESERVED_RULES)).toEqual(
      expect.arrayContaining(["encrypted:plain/encrypted", "encrypted:unreadable/encrypted"]),
    );
  });

  it("never flags a plain value an external-metadata manifest supplied", async () => {
    const { results } = await runValidate({
      inputs: [],
      cwd: join(fixtures, "manifest"),
      env: noKey,
    });
    expect(results.map((r) => [r.file, r.ok, r.errors])).toEqual([
      ["docs/auth.md", true, []],
    ]);
  });

  it("validates a value that decrypts under the key against the full schema", async () => {
    await page("ok.md", { title: "Ok", owner: enc("platform"), "internal-ticket": enc("PROJ-12") });
    await page("bad.md", { title: "Bad", owner: enc("finance"), "internal-ticket": enc("nope") });
    const notices: string[] = [];
    const { results } = await runValidate({
      ...validateOpts(["ok.md", "bad.md"], withKey),
      onNotice: (m) => notices.push(m),
    });
    const byFile = new Map(results.map((r) => [r.file, r]));
    expect(byFile.get("ok.md")?.errors).toEqual([]);
    const bad = byFile.get("bad.md");
    expect(bad?.ok).toBe(false);
    expect(bad?.errors.map((e) => [e.instancePath, e.keyword])).toEqual([
      ["/owner", "enum"],
      ["/internal-ticket", "pattern"],
    ]);
    // No finding prints the plaintext.
    const text = JSON.stringify(results);
    expect(text).not.toContain("finance");
    expect(text).not.toContain("nope");
    expect(notices).toEqual([]);
  });

  it("never prints an encrypted object's own keys", async () => {
    await page("c.md", { contacts: enc({ "secret-name": "x" }) });
    const { results } = await runValidate({
      inputs: ["c.md"],
      cwd: dir,
      noConfig: true,
      cliSchemas: [join(fixtures, "object.schema.json")],
      env: withKey,
    });
    const errors = results[0]?.errors ?? [];
    expect(errors.map((e) => [e.instancePath, e.keyword])).toEqual([
      ["/contacts", "additionalProperties"],
    ]);
    expect(JSON.stringify(errors)).not.toContain("secret-name");
  });

  it("files encrypted:unreadable for a value that does not decrypt under the key", async () => {
    await page("other.md", { title: "Other", owner: enc("platform", OTHER) });
    const { results } = await runValidate(validateOpts(["other.md"], withKey));
    expect(results[0]?.errors).toEqual([
      {
        schema: "encrypted:unreadable",
        keyword: "encrypted",
        instancePath: "/owner",
        message:
          "/owner does not decrypt under the current key: encrypted under another key, or edited by hand.",
        line: 3,
      },
    ]);
    const [finding] = results[0]?.errors ?? [];
    if (!finding) throw new Error("no finding");
    expect(ruleIdFor(finding)).toBe("encrypted:unreadable/encrypted");
  });

  it("with no key, drops the findings under an encrypted value and warns once, counting values", async () => {
    await page("a.md", { title: "A", owner: enc("finance"), "internal-ticket": enc("nope") });
    await page("b.md", { title: "B", owner: enc("platform") });
    const notices: string[] = [];
    const run = await runValidate({
      ...validateOpts(["a.md", "b.md"], noKey),
      onNotice: (m) => notices.push(m),
    });
    expect(run.results.map((r) => [r.file, r.ok, r.errors])).toEqual([
      ["a.md", true, []],
      ["b.md", true, []],
    ]);
    expect(notices).toEqual([
      "3 encrypted values were not verified: no encryption key is available. Set MANNI_ENCRYPTION_KEY, or run `manni key set`.",
    ]);
  });

  it("says the singular for one unverified value", async () => {
    await page("b.md", { title: "B", owner: enc("platform") });
    const notices: string[] = [];
    await runValidate({
      ...validateOpts(["b.md"], noKey),
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([
      "1 encrypted value was not verified: no encryption key is available. Set MANNI_ENCRYPTION_KEY, or run `manni key set`.",
    ]);
  });

  it("refuses a malformed MANNI_ENCRYPTION_KEY once an encrypted value needs it", async () => {
    await page("b.md", { title: "B", owner: enc("platform") });
    await expect(
      runValidate(validateOpts(["b.md"], { [ENCRYPTION_KEY_ENV]: "short" })),
    ).rejects.toThrow("MANNI_ENCRYPTION_KEY must be at least 32 hex or base64url characters.");
  });
});

const propose = (
  fields: Record<string, { value: unknown; confidence: number }>,
): MockProvider =>
  new MockProvider([
    {
      json: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { ...v, reasoning: "stated in the page" }]),
      ),
    },
  ]);

const fillOpts = (inputs: string[], env: NodeJS.ProcessEnv) => ({
  inputs,
  cwd: dir,
  cache: false,
  cliSchemas: [SCHEMA],
  env,
});

describe("meta fill with a marked property", () => {
  it("writes a marked value encrypted, and reports (encrypted) in its place", async () => {
    await page("a.md", { title: "A" });
    const provider = propose({ owner: { value: "platform", confidence: 0.9 } });
    const run = await runFill({
      ...fillOpts(["a.md"], withKey),
      fields: ["owner"],
      inferenceProvider: provider,
    });
    const written = frontmatter("a.md");
    expect(decrypts(written.owner)).toBe("platform");
    expect(run.results[0]?.fields).toEqual([
      expect.objectContaining({ field: "/owner", written: true, value: "(encrypted)", encrypted: true }),
    ]);
    for (const format of ["pretty", "json", "github"] as const) {
      const report = renderFill(format, run);
      expect(report).not.toContain("platform");
      expect(report).not.toContain(String(written.owner));
    }
    expect(renderFill("json", run)).toContain("(encrypted)");
    expect(renderFill("pretty", run)).toContain("(encrypted)");
  });

  it("sends the model neither the plaintext nor the ciphertext of a marked field", async () => {
    const token = enc("billing");
    await page("a.md", { title: "A", owner: token });
    const provider = propose({ "internal-ticket": { value: "PROJ-7", confidence: 0.9 } });
    await runFill({ ...fillOpts(["a.md"], withKey), inferenceProvider: provider });
    const sent = JSON.stringify(provider.requests.map((r) => r.user));
    expect(provider.requests).toHaveLength(1);
    expect(sent).toContain("(encrypted)");
    expect(sent).not.toContain(token);
    expect(sent).not.toContain("billing");
    const written = frontmatter("a.md");
    expect(written.owner).toBe(token);
    expect(decrypts(written["internal-ticket"])).toBe("PROJ-7");
  });

  it("encrypts a valid plain value in place, with no model request", async () => {
    await writeFile(join(dir, "auth.md"), readFileSync(join(fixtures, "plain-owner.md")));
    const provider = propose({});
    const run = await runFill({
      ...fillOpts(["auth.md"], withKey),
      fields: ["owner"],
      inferenceProvider: provider,
    });
    expect(provider.requests).toHaveLength(0);
    expect(decrypts(frontmatter("auth.md").owner)).toBe("platform");
    expect(run.results[0]?.changed).toBe(true);
    expect(run.results[0]?.fields).toEqual([
      expect.objectContaining({ field: "/owner", written: true, value: "(encrypted)", encrypted: true }),
    ]);
    // Re-validation passes under the key.
    const { results } = await runValidate(validateOpts(["auth.md"], withKey));
    expect(results[0]?.errors).toEqual([]);
  });

  it("with no key and a yes, writes a key to the config and carries on", async () => {
    await page("a.md", { title: "A" });
    const notices: string[] = [];
    const questions: string[] = [];
    const provider = propose({ owner: { value: "billing", confidence: 0.9 } });
    await runFill({
      ...fillOpts(["a.md"], noKey),
      fields: ["owner"],
      inferenceProvider: provider,
      onNotice: (m) => notices.push(m),
      confirm: (q) => {
        questions.push(q);
        return Promise.resolve(true);
      },
    });
    expect(notices[0]).toBe("/owner must be encrypted, and no encryption key is available.");
    expect(questions).toEqual(["Generate a key and write it to manni.config.yaml? "]);
    const config = await readFile(join(dir, "manni.config.yaml"), "utf8");
    const key = /encryptionKey: (\S+)/.exec(config)?.[1];
    if (key === undefined) throw new Error("no key written");
    expect(decrypts(frontmatter("a.md").owner, key)).toBe("billing");
  });

  for (const [label, confirm] of [
    ["a no", () => Promise.resolve(false)],
    ["no terminal to ask on", undefined],
  ] as const) {
    it(`with no key and ${label}, refuses before the first model request`, async () => {
      await page("a.md", { title: "A" });
      const before = await readFile(join(dir, "a.md"), "utf8");
      const provider = propose({ owner: { value: "billing", confidence: 0.9 } });
      const run = runFill({
        ...fillOpts(["a.md"], noKey),
        fields: ["owner"],
        inferenceProvider: provider,
        ...(confirm === undefined ? {} : { confirm }),
      });
      await expect(run).rejects.toThrow(DocmetaError);
      await expect(run).rejects.toThrow(REFUSAL);
      expect(provider.requests).toHaveLength(0);
      expect(await readFile(join(dir, "a.md"), "utf8")).toBe(before);
      expect(existsSync(join(dir, "manni.config.yaml"))).toBe(false);
    });
  }

  it("with no key, a dry run still proposes a marked value, as (encrypted)", async () => {
    await page("a.md", { title: "A" });
    const before = await readFile(join(dir, "a.md"), "utf8");
    const provider = propose({ owner: { value: "billing", confidence: 0.9 } });
    const run = await runFill({
      ...fillOpts(["a.md"], noKey),
      fields: ["owner"],
      inferenceProvider: provider,
      dryRun: true,
    });
    expect(provider.requests).toHaveLength(1);
    expect(run.results[0]?.fields).toEqual([
      expect.objectContaining({ field: "/owner", value: "(encrypted)", encrypted: true }),
    ]);
    const report = renderFill("pretty", run);
    expect(report).toContain("(encrypted)");
    expect(report).not.toContain("billing");
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "manni.config.yaml"))).toBe(false);
  });

  it("with no key, a dry run reports an in-place encryption without asking for a key", async () => {
    await writeFile(join(dir, "auth.md"), readFileSync(join(fixtures, "plain-owner.md")));
    const before = await readFile(join(dir, "auth.md"), "utf8");
    const questions: string[] = [];
    const provider = propose({});
    const run = await runFill({
      ...fillOpts(["auth.md"], noKey),
      fields: ["owner"],
      inferenceProvider: provider,
      dryRun: true,
      confirm: (q) => {
        questions.push(q);
        return Promise.resolve(true);
      },
    });
    expect(questions).toEqual([]);
    expect(provider.requests).toHaveLength(0);
    expect(run.results[0]?.changed).toBe(true);
    expect(run.results[0]?.fields).toEqual([
      expect.objectContaining({ field: "/owner", value: "(encrypted)", encrypted: true }),
    ]);
    expect(renderFill("pretty", run)).toContain("(encrypted)");
    expect(await readFile(join(dir, "auth.md"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "manni.config.yaml"))).toBe(false);
  });
});

describe("meta query writes a marked column encrypted", () => {
  async function configured(): Promise<void> {
    await cp(SCHEMA, join(dir, "encrypted.schema.json"));
    await writeFile(
      join(dir, "manni.config.yaml"),
      "meta:\n  schemas:\n    - ./encrypted.schema.json\n",
      "utf8",
    );
  }

  it("UPDATE encrypts the marked column and prints (encrypted)", async () => {
    await configured();
    await page("a.md", { title: "A", owner: enc("platform") });
    const run = await runQuery({
      sql: "UPDATE docs SET owner = 'billing', title = 'Renamed'",
      inputs: ["a.md"],
      cwd: dir,
      env: withKey,
    });
    const data = frontmatter("a.md");
    expect(decrypts(data.owner)).toBe("billing");
    expect(data.title).toBe("Renamed");
    expect(run.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "owner", from: "(encrypted)", to: "(encrypted)", written: true }),
        expect.objectContaining({ key: "title", from: "A", to: "Renamed", written: true }),
      ]),
    );
    const text = renderQuery(run);
    expect(text).toContain("owner: (encrypted) -> (encrypted)");
    expect(text).not.toContain("billing");
  });

  it("INSERT encrypts the marked column of the file it creates", async () => {
    await configured();
    await page("a.md", { title: "A", owner: enc("platform") });
    const run = await runQuery({
      sql: "INSERT INTO docs (_path, title, owner) VALUES ('new.md', 'New', 'billing')",
      inputs: ["a.md"],
      cwd: dir,
      env: withKey,
    });
    expect(decrypts(frontmatter("new.md").owner)).toBe("billing");
    expect(run.changes).toEqual([
      expect.objectContaining({ file: "new.md", created: true, to: { title: "New", owner: "(encrypted)" } }),
    ]);
  });

  it("resolves a page's own $schema to find the marks", async () => {
    await cp(SCHEMA, join(dir, "encrypted.schema.json"));
    await page("a.md", { $schema: "./encrypted.schema.json", title: "A", owner: "platform" });
    await runQuery({
      sql: "UPDATE docs SET owner = 'billing'",
      inputs: ["a.md"],
      cwd: dir,
      noConfig: true,
      env: withKey,
    });
    expect(decrypts(frontmatter("a.md").owner)).toBe("billing");
  });

  it("with no key and no terminal, refuses and writes nothing", async () => {
    await configured();
    await page("a.md", { title: "A", owner: "platform" });
    const before = await readFile(join(dir, "a.md"), "utf8");
    const run = runQuery({
      sql: "UPDATE docs SET owner = 'billing'",
      inputs: ["a.md"],
      cwd: dir,
      env: noKey,
    });
    await expect(run).rejects.toThrow(REFUSAL);
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe(before);
  });

  it("with no key, a dry run still previews, as (encrypted)", async () => {
    await configured();
    await page("a.md", { title: "A", owner: "platform" });
    const run = await runQuery({
      sql: "UPDATE docs SET owner = 'billing'",
      inputs: ["a.md"],
      cwd: dir,
      env: noKey,
      dryRun: true,
    });
    expect(run.changes).toEqual([
      expect.objectContaining({ key: "owner", from: "platform", to: "(encrypted)", written: false }),
    ]);
  });

  it("with no key and a yes, writes a key and carries on", async () => {
    await configured();
    await page("a.md", { title: "A", owner: "platform" });
    await runQuery({
      sql: "UPDATE docs SET owner = 'billing'",
      inputs: ["a.md"],
      cwd: dir,
      env: noKey,
      confirm: () => Promise.resolve(true),
    });
    const config = await readFile(join(dir, "manni.config.yaml"), "utf8");
    const key = /encryptionKey: (\S+)/.exec(config)?.[1];
    if (key === undefined) throw new Error("no key written");
    expect(decrypts(frontmatter("a.md").owner, key)).toBe("billing");
  });

  it("SELECT returns what the page holds, the ciphertext", async () => {
    await configured();
    const token = enc("platform");
    await page("a.md", { title: "A", owner: token });
    const run = await runQuery({ sql: "SELECT owner FROM docs", inputs: ["a.md"], cwd: dir, env: withKey });
    expect(run.rows).toEqual([{ owner: token }]);
  });
});

describe("an external-metadata join on an encrypted field", () => {
  async function joinRepo(): Promise<void> {
    await cp(join(fixtures, "join"), dir, { recursive: true });
    await page("docs/auth.md", { title: "Auth", owner: enc("platform") });
  }

  it("decrypts the join field before matching when the key is available", async () => {
    await joinRepo();
    const { results } = await runValidate({ inputs: [], cwd: dir, env: withKey });
    expect(results.map((r) => [r.file, r.errors])).toEqual([["docs/auth.md", []]]);
    const run = await runQuery({ sql: "SELECT jira FROM docs", inputs: [], cwd: dir, env: withKey });
    expect(run.rows).toEqual([{ jira: "PLAT-1" }]);
  });

  it("refuses with no key", async () => {
    await joinRepo();
    const message =
      'externalMetadata join field "owner" is encrypted on these pages, and no encryption key is available to match them.';
    await expect(runValidate({ inputs: [], cwd: dir, env: noKey })).rejects.toThrow(message);
    await expect(
      runQuery({ sql: "SELECT jira FROM docs", inputs: [], cwd: dir, env: noKey }),
    ).rejects.toThrow(message);
  });
});

describe("reencryptMetadata", () => {
  const doc = (data: Record<string, unknown>): string => `---\n${stringify(data)}---\n\nBody.\n`;
  const read = (content: string): Record<string, unknown> => {
    const extractor = extractorForExtension(".md");
    if (!extractor) throw new Error("no markdown extractor");
    return extractor.extract(content, "a.md").data;
  };

  it("re-encrypts every value under the new key, at any depth, and leaves citations alone", () => {
    const owner = enc("platform");
    const ticket = enc("PROJ-1");
    const cited = enc("src/secret.ts", KEY);
    const content = doc({
      title: "A",
      owner,
      meta: { ticket, tags: ["x"] },
      citations: [{ src: cited }],
    });
    const result = reencryptMetadata({ file: "a.md", content }, { fromKey: KEY, toKey: OTHER });
    expect(result.skipped).toEqual([]);
    expect(result.rewritten.map((r) => r.pointer)).toEqual(["/owner", "/meta/ticket"]);
    expect(result.rewritten[0]?.from).toBe(owner);
    const data = read(result.content);
    expect(result.rewritten[0]?.to).toBe(data.owner);
    expect(decrypts(data.owner, OTHER)).toBe("platform");
    expect(decrypts((data.meta as { ticket: string }).ticket, OTHER)).toBe("PROJ-1");
    expect((data.meta as { tags: string[] }).tags).toEqual(["x"]);
    expect(data.citations).toEqual([{ src: cited }]);
    expect(data.title).toBe("A");
    expect(result.content).toContain("Body.");
  });

  it("counts a value already under the new key as done", () => {
    const content = doc({ owner: enc("platform", OTHER) });
    const result = reencryptMetadata({ file: "a.md", content }, { fromKey: KEY, toKey: OTHER });
    expect(result).toEqual({ content, rewritten: [], skipped: [] });
  });

  it("skips a value that decrypts under neither key", () => {
    const content = doc({ owner: enc("platform", THIRD) });
    const result = reencryptMetadata({ file: "a.md", content }, { fromKey: KEY, toKey: OTHER });
    expect(result).toEqual({
      content,
      rewritten: [],
      skipped: [{ pointer: "/owner", message: "does not decrypt under the current key" }],
    });
  });

  it("uses format when it is given", () => {
    const content = doc({ owner: enc("platform") });
    const result = reencryptMetadata(
      { file: "a.txt", content, format: "markdown" },
      { fromKey: KEY, toKey: OTHER },
    );
    expect(result.rewritten).toHaveLength(1);
  });

  it("lists a read-only format's values as skipped", () => {
    const markdown = extractorForExtension(".md");
    if (!markdown) throw new Error("no markdown extractor");
    const readOnly: MetadataExtractor = {
      name: "read-only",
      extensions: [".ro"],
      implemented: true,
      extract: markdown.extract,
    };
    const content = doc({ owner: enc("platform"), done: enc("x", OTHER) });
    const result = reencryptWith(readOnly, { file: "a.ro", content }, { fromKey: KEY, toKey: OTHER });
    expect(result).toEqual({
      content,
      rewritten: [],
      skipped: [{ pointer: "/owner", message: "this format cannot be written" }],
    });
  });
});
