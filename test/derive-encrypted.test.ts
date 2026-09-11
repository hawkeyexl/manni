/**
 * The derived channel over a managed field its schema marks `x-manni-encrypt`
 * (proposals 0040 and 0045).
 *
 * `test/fixtures/derive/encrypted/` manages one field, `owner`, which the
 * schema also marks. `derive` must stamp it encrypted and read its own stamp
 * back as current; `validate` must compare the plaintext, not the ciphertext;
 * and no report may print the value. Every run is handed `env`, so the
 * developer's own `MANNI_ENCRYPTION_KEY` is never read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDerive } from "../src/meta/commands/derive.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { decryptValue, encryptValue, isEncryptedValue } from "../src/shared/encryption.js";
import { ENCRYPTION_KEY_ENV } from "../src/shared/encryption-key.js";
import { commit, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

// Every case spawns git, and a Windows runner under load takes longer than
// vitest's 5 s default for a single spawn chain.
vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures", "derive", "encrypted");

/** A fixed test key: never the developer's. */
const KEY = "0123456789abcdef0123456789abcdef";
const withKey = { [ENCRYPTION_KEY_ENV]: KEY };
const OWNER = "@platform-docs";
const PAGE = "docs/page.md";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** The fixture in a committed temp repository, with one page carrying `frontmatter`. */
function stage(frontmatter = "title: Page\n"): string {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  writeFile(dir, PAGE, `---\n${frontmatter}---\n\n# Page\n`);
  commit(dir, "add docs", { authorDate: "2026-08-20T10:00:00+00:00" });
  return dir;
}

/** An `owner:` line holding `value` encrypted under `KEY`. */
const sealedOwner = (value: unknown): string =>
  `owner: ${JSON.stringify(encryptValue(value, KEY, "meta"))}\n`;

const raw = (dir: string): string => readFileSync(join(dir, PAGE), "utf8");
const ownerOf = (dir: string): unknown =>
  markdownExtractor.extract(raw(dir), PAGE).data.owner;

describe("derive over a managed field marked x-manni-encrypt", () => {
  it("stamps the field encrypted, and reports it as (encrypted)", async () => {
    const dir = stage();
    const run = await runDerive({ inputs: [], cwd: dir, env: withKey });
    const result = run.results[0];
    expect(result?.changed).toBe(true);
    expect(result?.fields).toEqual([
      expect.objectContaining({
        field: "owner",
        derived: "(encrypted)",
        status: "unset",
        written: true,
      }),
    ]);
    const held = ownerOf(dir);
    expect(isEncryptedValue(held)).toBe(true);
    if (typeof held !== "string") throw new Error("owner is not a ciphertext string");
    expect(decryptValue(held, KEY, "meta")).toMatchObject({ ok: true, value: [OWNER] });
    expect(raw(dir)).not.toContain(OWNER);
    expect(JSON.stringify(run.results)).not.toContain(OWNER);
  });

  it("reads its own stamp back as current, and writes nothing the second time", async () => {
    const dir = stage();
    await runDerive({ inputs: [], cwd: dir, env: withKey });
    const stamped = raw(dir);
    const again = await runDerive({ inputs: [], cwd: dir, env: withKey });
    expect(again.results[0]?.fields.map((f) => f.status)).toEqual(["current"]);
    expect(again.results[0]?.changed).toBe(false);
    expect(raw(dir)).toBe(stamped);
  });

  it("judges a stale ciphertext by its plaintext, and names neither value", async () => {
    const dir = stage(`title: Page\n${sealedOwner(["@someone-else"])}`);
    const run = await runDerive({ inputs: [], cwd: dir, env: withKey, check: true });
    const result = run.results[0];
    expect(result?.fields).toEqual([
      expect.objectContaining({
        field: "owner",
        asserted: "(encrypted)",
        derived: "(encrypted)",
        status: "stale",
      }),
    ]);
    const messages = (result?.findings ?? []).map((f) => f.message).join("\n");
    expect(messages).toContain("(encrypted)");
    expect(messages).not.toContain(OWNER);
    expect(messages).not.toContain("@someone-else");
  });

  it("a dry run with no key reports (encrypted), and neither asks nor writes", async () => {
    const dir = stage();
    const before = raw(dir);
    const run = await runDerive({ inputs: [], cwd: dir, env: {}, dryRun: true });
    expect(run.results[0]?.changed).toBe(true);
    expect(run.results[0]?.fields).toEqual([
      expect.objectContaining({ derived: "(encrypted)", written: false }),
    ]);
    expect(raw(dir)).toBe(before);
  });

  it("refuses to stamp with no key rather than write the value in plain", async () => {
    const dir = stage();
    const before = raw(dir);
    await expect(runDerive({ inputs: [], cwd: dir, env: {} })).rejects.toThrow(
      "/owner must be encrypted, and no encryption key is available",
    );
    expect(raw(dir)).toBe(before);
  });

  it("an encrypted stamp no key can read is the file's error, not a guess", async () => {
    const dir = stage(`title: Page\n${sealedOwner([OWNER])}`);
    const before = raw(dir);
    const run = await runDerive({ inputs: [], cwd: dir, env: {} });
    expect(run.results[0]?.error).toContain("/owner is encrypted");
    expect(run.summary.errors).toBe(1);
    expect(raw(dir)).toBe(before);
  });
});

describe("validate's derived comparison over a marked field", () => {
  it("finds an encrypted stamp current by its plaintext", async () => {
    const dir = stage(`title: Page\n${sealedOwner([OWNER])}`);
    const { results } = await runValidate({ inputs: [], cwd: dir, env: withKey });
    expect(results[0]?.errors).toEqual([]);
  });

  it("files a stale encrypted stamp without printing either value", async () => {
    const dir = stage(`title: Page\n${sealedOwner(["@someone-else"])}`);
    const { results } = await runValidate({ inputs: [], cwd: dir, env: withKey });
    const stale = results[0]?.errors.filter((e) => e.schema === "derived:stale") ?? [];
    expect(stale).toHaveLength(1);
    expect(stale[0]?.message).toContain("(encrypted)");
    expect(stale[0]?.message).not.toContain(OWNER);
    expect(stale[0]?.message).not.toContain("@someone-else");
  });

  it("with no key, leaves an encrypted stamp uncompared rather than stale", async () => {
    const dir = stage(`title: Page\n${sealedOwner([OWNER])}`);
    const notices: string[] = [];
    const { results } = await runValidate({
      inputs: [],
      cwd: dir,
      env: {},
      onNotice: (m) => notices.push(m),
    });
    expect(results[0]?.errors.filter((e) => e.schema === "derived:stale")).toEqual([]);
    expect(notices.join("\n")).toContain("1 encrypted value was not verified");
  });
});
