/**
 * The family encryption key (proposal 0045): where it comes from, where it is
 * written, and the one question a write asks when there is none.
 *
 * Repositories are built at runtime (`makeTempRepo`): a `.git` directory
 * bounds discovery and decides what `git check-ignore` says, and neither can
 * be committed as a fixture.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigFile,
  readFamilyConfigFile,
  type ConfigFile,
  type ConfigFileOptions,
} from "../src/shared/config-file.js";
import {
  ENCRYPTION_KEY_ENV,
  ENCRYPTION_KEY_FIELD,
  committedKeyWarning,
  findFamilyConfigFile,
  isIgnoredByGit,
  resolveEncryptionKey,
  writeEncryptionKey,
} from "../src/shared/encryption-key.js";
import {
  ensureEncryptionKey,
  readlineConfirm,
  terminalConfirm,
  type Confirm,
} from "../src/shared/prompt.js";
import { resetWarnings } from "../src/shared/warn.js";
import { gitAvailable, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

const KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
// Not all decimal digits: YAML would read such a key as a number.
const OTHER = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

class KeyError extends Error {}
const toError = (m: string): Error => new KeyError(m);

const CITE: ConfigFileOptions = { section: "cite", legacyNames: [], toError };
const META: ConfigFileOptions = {
  section: "meta",
  legacyNames: ["docmeta.config.yaml"],
  toError,
};

const hasGit = gitAvailable();

let dir: string | undefined;
let stderr: string[];

beforeEach(() => {
  stderr = [];
  resetWarnings();
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempRepo(dir);
  dir = undefined;
});

function repo(files: Record<string, string>, init = true): string {
  dir = makeTempRepo({ files, init });
  // makeTempRepo with init: false leaves no boundary; mark one by hand so the
  // walk still stops here, without git answering for the directory.
  if (!init) mkdirSync(join(dir, ".git"));
  return dir;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("resolveEncryptionKey", () => {
  const file = { encryptionKey: KEY } as ConfigFile;

  it("the environment wins over the config", () => {
    expect(
      resolveEncryptionKey({ env: { [ENCRYPTION_KEY_ENV]: OTHER }, file, toError }),
    ).toEqual({ key: OTHER, source: "env" });
  });

  it("falls back to the config's encryptionKey", () => {
    expect(resolveEncryptionKey({ env: {}, file, toError })).toEqual({
      key: KEY,
      source: "config",
    });
  });

  it("is none when neither has one", () => {
    expect(resolveEncryptionKey({ env: {}, file: null, toError })).toEqual({
      key: undefined,
      source: "none",
    });
    expect(
      resolveEncryptionKey({ env: {}, file: {} as ConfigFile, toError }),
    ).toEqual({ key: undefined, source: "none" });
  });

  it("an empty environment variable is unset, as an absent CI secret expands", () => {
    expect(
      resolveEncryptionKey({ env: { [ENCRYPTION_KEY_ENV]: "" }, file, toError }),
    ).toEqual({ key: KEY, source: "config" });
  });

  it("an invalid environment value is refused without echoing it", () => {
    const run = (): unknown =>
      resolveEncryptionKey({
        env: { [ENCRYPTION_KEY_ENV]: "hunter2" },
        file,
        toError,
      });
    expect(run).toThrow(KeyError);
    expect(run).toThrow(
      "MANNI_ENCRYPTION_KEY must be at least 32 hex or base64url characters.",
    );
    expect(run).not.toThrow(/hunter2/);
  });

  it("reads process.env when no env is passed", () => {
    vi.stubEnv(ENCRYPTION_KEY_ENV, OTHER);
    try {
      expect(resolveEncryptionKey({ file: null, toError }).key).toBe(OTHER);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("findFamilyConfigFile", () => {
  it("finds the nearest family file whatever it carries", async () => {
    const root = repo({
      "manni.config.yaml": "meta:\n  allowEmpty: true\n",
      "docs/manni.config.yaml": "docevals:\n  version: 1\n",
      "docs/api/.keep": "",
    });
    const found = await findFamilyConfigFile(join(root, "docs", "api"), toError);
    expect(found?.path).toBe(join(root, "docs", "manni.config.yaml"));
    expect(found?.source).toBe("../manni.config.yaml");
    expect(found?.wrapped).toBe(true);
    expect(found?.value).toBeNull();
    expect(found?.encryptionKey).toBeUndefined();
  });

  it("carries the file's key", async () => {
    const root = repo({ "manni.config.yaml": `encryptionKey: ${KEY}\n` });
    expect((await findFamilyConfigFile(root, toError))?.encryptionKey).toBe(KEY);
  });

  it("an invalid key is not an error here: replacing it is what the caller is for", async () => {
    const root = repo({ "manni.config.yaml": "encryptionKey: short\n" });
    const found = await findFamilyConfigFile(root, toError);
    expect(found?.path).toBe(join(root, "manni.config.yaml"));
    expect(found?.encryptionKey).toBeUndefined();
  });

  it("reads a moose.config.yaml too, with the rename warning, so a new file never shadows it", async () => {
    const root = repo({ "moose.config.yaml": "docevals:\n  version: 1\n" });
    const found = await findFamilyConfigFile(root, toError);
    expect(found?.kind).toBe("moose");
    expect(stderr.join("")).toContain('"moose.config.yaml" is the pre-rename name');
  });

  it("never reads a legacy per-tool file, and is null when there is no family file", async () => {
    const root = repo({ "docmeta.config.yaml": "paths: [docs]\n" });
    expect(await findFamilyConfigFile(root, toError)).toBeNull();
  });

  it("invalid YAML is an error in the caller's class", async () => {
    const root = repo({ "manni.config.yaml": "meta: [oops\n" });
    await expect(findFamilyConfigFile(root, toError)).rejects.toBeInstanceOf(KeyError);
  });
});

describe("writeEncryptionKey", () => {
  it("sets a top-level encryptionKey, keeping comments and the other keys", async () => {
    const text =
      "# The family config.\ncollections:\n  - name: site # the docs\n    paths: [docs]\ncite:\n  sources: [src]\n";
    const root = repo({ "manni.config.yaml": text });
    const file = await findConfigFile(root, CITE);
    const result = await writeEncryptionKey({ file, key: KEY, cwd: root, toError });
    expect(result).toEqual({
      path: join(root, "manni.config.yaml"),
      source: "manni.config.yaml",
      created: false,
    });
    const after = read(join(root, "manni.config.yaml"));
    expect(after).toContain("# The family config.");
    expect(after).toContain("# the docs");
    expect(after).toContain(`${ENCRYPTION_KEY_FIELD}: ${KEY}`);
    expect(after.indexOf("collections:")).toBeLessThan(after.indexOf("cite:"));
    const reread = await findConfigFile(root, CITE);
    expect(reread?.encryptionKey).toBe(KEY);
    expect(reread?.value).toEqual({ sources: ["src"] });
    expect(reread?.collections.map((c) => c.name)).toEqual(["site"]);
  });

  it("replaces an existing key in place", async () => {
    const root = repo({
      "manni.config.yaml": `cite: {}\nencryptionKey: ${OTHER}\nmeta: {}\n`,
    });
    const file = await findConfigFile(root, CITE);
    await writeEncryptionKey({ file, key: KEY, cwd: root, toError });
    expect(read(join(root, "manni.config.yaml"))).toBe(
      `cite: {}\nencryptionKey: ${KEY}\nmeta: {}\n`,
    );
  });

  it("with no file, creates manni.config.yaml at the git root holding only the key", async () => {
    const root = repo({ "docs/api/.keep": "" });
    const cwd = join(root, "docs", "api");
    const result = await writeEncryptionKey({ file: null, key: KEY, cwd, toError });
    expect(result).toEqual({
      path: join(root, "manni.config.yaml"),
      source: "../../manni.config.yaml",
      created: true,
    });
    expect(read(join(root, "manni.config.yaml"))).toBe(`encryptionKey: ${KEY}\n`);
    expect((await findConfigFile(cwd, CITE))?.encryptionKey).toBe(KEY);
  });

  it("with no file and no git root, creates the file in the working directory", async () => {
    dir = makeTempRepo({ files: {}, init: false });
    const result = await writeEncryptionKey({ file: null, key: KEY, cwd: dir, toError });
    expect(result.path).toBe(join(dir, "manni.config.yaml"));
    expect(result.created).toBe(true);
  });

  it("with no file, edits a sibling's family file at the root rather than overwrite it", async () => {
    const root = repo({ "manni.config.yaml": "docevals:\n  version: 1\n" });
    const result = await writeEncryptionKey({ file: null, key: KEY, cwd: root, toError });
    expect(result.created).toBe(false);
    const after = read(join(root, "manni.config.yaml"));
    expect(after).toContain("docevals:\n  version: 1");
    expect(after).toContain(`encryptionKey: ${KEY}`);
  });

  it("dryRun reports the target and writes nothing", async () => {
    const root = repo({});
    const result = await writeEncryptionKey({
      file: null,
      key: KEY,
      cwd: root,
      toError,
      dryRun: true,
    });
    expect(result).toEqual({
      path: join(root, "manni.config.yaml"),
      source: "manni.config.yaml",
      created: true,
    });
    expect(existsSync(join(root, "manni.config.yaml"))).toBe(false);
  });

  it("refuses a single-tool file, whose whole document is one tool's section", async () => {
    const root = repo({ "docmeta.config.yaml": "paths: [docs]\n" });
    const file = await findConfigFile(root, META);
    expect(file?.kind).toBe("legacy");
    await expect(
      writeEncryptionKey({ file, key: KEY, cwd: root, toError }),
    ).rejects.toThrow(
      "docmeta.config.yaml is a single-tool config file, which cannot hold the family encryptionKey. Move its keys under the tool's section in manni.config.yaml, or set MANNI_ENCRYPTION_KEY.",
    );
    expect(read(join(root, "docmeta.config.yaml"))).toBe("paths: [docs]\n");
  });

  it("refuses a key that is not key-shaped", async () => {
    const root = repo({});
    await expect(
      writeEncryptionKey({ file: null, key: "short", cwd: root, toError }),
    ).rejects.toBeInstanceOf(KeyError);
    expect(existsSync(join(root, "manni.config.yaml"))).toBe(false);
  });

  it("previous sets encryptionKeyPrevious beside the key in one write, and null removes it", async () => {
    const root = repo({ "manni.config.yaml": `meta: {}\nencryptionKey: ${OTHER}\n` });
    const path = join(root, "manni.config.yaml");
    const file = await findConfigFile(root, CITE);
    await writeEncryptionKey({ file, key: KEY, previous: OTHER, cwd: root, toError });
    expect(read(path)).toBe(`meta: {}\nencryptionKey: ${KEY}\nencryptionKeyPrevious: ${OTHER}\n`);
    const during = await findConfigFile(root, CITE);
    expect(during?.encryptionKeyPrevious).toBe(OTHER);

    // Omitted, an existing previous key is left where it is.
    await writeEncryptionKey({ file: during, key: KEY, cwd: root, toError });
    expect(read(path)).toBe(`meta: {}\nencryptionKey: ${KEY}\nencryptionKeyPrevious: ${OTHER}\n`);

    await writeEncryptionKey({ file: during, key: KEY, previous: null, cwd: root, toError });
    expect(read(path)).toBe(`meta: {}\nencryptionKey: ${KEY}\n`);
  });

  it("refuses a previous key that is not key-shaped, without echoing it", async () => {
    const root = repo({ "manni.config.yaml": "meta: {}\n" });
    const file = await findConfigFile(root, CITE);
    const run = writeEncryptionKey({ file, key: KEY, previous: "hunter2", cwd: root, toError });
    await expect(run).rejects.toBeInstanceOf(KeyError);
    await expect(run).rejects.not.toThrow(/hunter2/);
    expect(read(join(root, "manni.config.yaml"))).toBe("meta: {}\n");
  });
});

describe("readFamilyConfigFile", () => {
  it("reads an explicit family file whatever sections it carries, as a family file", async () => {
    const root = repo({ "ops/manni.config.yaml": "meta:\n  allowEmpty: true\n" });
    const file = await readFamilyConfigFile("ops/manni.config.yaml", root, toError);
    expect(file).toMatchObject({
      path: join(root, "ops", "manni.config.yaml"),
      source: "ops/manni.config.yaml",
      kind: "explicit",
      wrapped: true,
      value: null,
    });
    await writeEncryptionKey({ file, key: KEY, cwd: root, toError });
    expect(read(join(root, "ops", "manni.config.yaml"))).toBe(
      `meta:\n  allowEmpty: true\nencryptionKey: ${KEY}\n`,
    );
  });

  it("reads any file carrying a family key, or an empty one, as a family file", async () => {
    const root = repo({ "a.yaml": `encryptionKey: ${KEY}\n`, "b.yaml": "" });
    expect((await readFamilyConfigFile("a.yaml", root, toError)).wrapped).toBe(true);
    expect((await readFamilyConfigFile("b.yaml", root, toError)).wrapped).toBe(true);
  });

  it("reads a single-tool file whole, so a key write refuses it", async () => {
    const root = repo({ "docmeta.config.yaml": "allowEmpty: true\n" });
    const file = await readFamilyConfigFile("docmeta.config.yaml", root, toError);
    expect(file.wrapped).toBe(false);
    await expect(writeEncryptionKey({ file, key: KEY, cwd: root, toError })).rejects.toThrow(
      /^docmeta\.config\.yaml is a single-tool config file/,
    );
  });

  it("carries the file's keys, and tolerates a malformed one, as findFamilyConfigFile does", async () => {
    const root = repo({
      "good.yaml": `encryptionKey: ${KEY}\nencryptionKeyPrevious: ${OTHER}\n`,
      "bad.yaml": "encryptionKey: hunter2\n",
    });
    const good = await readFamilyConfigFile("good.yaml", root, toError);
    expect(good.encryptionKey).toBe(KEY);
    expect(good.encryptionKeyPrevious).toBe(OTHER);
    expect((await readFamilyConfigFile("bad.yaml", root, toError)).encryptionKey).toBeUndefined();
  });

  it("is an error when the file is missing", async () => {
    const root = repo({});
    await expect(readFamilyConfigFile("nope.yaml", root, toError)).rejects.toThrow(
      'Config file not found: "nope.yaml".',
    );
  });
});

describe.skipIf(!hasGit)("isIgnoredByGit", () => {
  it("is true for an ignored path, even one that does not exist yet", () => {
    const root = repo({ ".gitignore": "manni.config.yaml\n" });
    expect(isIgnoredByGit(join(root, "manni.config.yaml"))).toBe(true);
  });

  it("is false for a path git would track", () => {
    const root = repo({ "manni.config.yaml": "cite: {}\n" });
    expect(isIgnoredByGit(join(root, "manni.config.yaml"))).toBe(false);
  });

  it("is undefined outside a repository", () => {
    dir = makeTempRepo({ files: {}, init: false });
    expect(isIgnoredByGit(join(dir, "manni.config.yaml"))).toBeUndefined();
  });
});

describe("committedKeyWarning", () => {
  it("names the file and the safer alternative", () => {
    expect(committedKeyWarning("manni.config.yaml")).toBe(
      "manni.config.yaml is not ignored by git: once committed, anyone who can read the repository can decrypt every encrypted value. Prefer MANNI_ENCRYPTION_KEY for a shared repository.",
    );
  });
});

describe("ensureEncryptionKey", () => {
  const REFUSAL =
    "/owner must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.";
  const NO_KEY = "/owner must be encrypted, and no encryption key is available.";

  function answering(answer: boolean): { confirm: Confirm; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      confirm: (question) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
    };
  }

  it("returns the environment's key without asking", async () => {
    const { confirm, asked } = answering(true);
    const notices: string[] = [];
    const result = await ensureEncryptionKey({
      subject: "/owner",
      cwd: repo({}),
      file: null,
      env: { [ENCRYPTION_KEY_ENV]: KEY },
      confirm,
      notice: (m) => notices.push(m),
      toError,
    });
    expect(result).toEqual({ key: KEY });
    expect(asked).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("returns the config's key without asking", async () => {
    const root = repo({ "manni.config.yaml": `encryptionKey: ${KEY}\n` });
    const { confirm, asked } = answering(true);
    const result = await ensureEncryptionKey({
      subject: "/owner",
      cwd: root,
      file: await findConfigFile(root, CITE),
      env: {},
      confirm,
      notice: () => undefined,
      toError,
    });
    expect(result).toEqual({ key: KEY });
    expect(asked).toEqual([]);
  });

  it("with no config, asks, then creates manni.config.yaml at the git root", async () => {
    const root = repo({ ".gitignore": "manni.config.yaml\n" });
    const { confirm, asked } = answering(true);
    const notices: string[] = [];
    const result = await ensureEncryptionKey({
      subject: "/owner",
      cwd: root,
      file: null,
      env: {},
      confirm,
      notice: (m) => notices.push(m),
      toError,
    });
    expect(result.key).toMatch(/^[0-9a-f]{64}$/);
    expect(result.written).toEqual({ source: "manni.config.yaml", created: true });
    expect(asked).toEqual(["Generate a key and write it to manni.config.yaml? "]);
    // Ignored by git, so no warning; and with no git, none either.
    expect(notices).toEqual([NO_KEY]);
    expect(stderr).toEqual(["Created manni.config.yaml with an encryption key.\n"]);
    expect(read(join(root, "manni.config.yaml"))).toBe(`encryptionKey: ${result.key}\n`);
  });

  it("with a config, writes the key into it and says so", async () => {
    const root = repo({
      ".gitignore": "manni.config.yaml\n",
      "manni.config.yaml": "cite:\n  sources: [src]\n",
    });
    const { confirm, asked } = answering(true);
    const result = await ensureEncryptionKey({
      subject: "src/limits.ts:2",
      cwd: root,
      file: await findConfigFile(root, CITE),
      env: {},
      confirm,
      notice: () => undefined,
      toError,
    });
    expect(result.written).toEqual({ source: "manni.config.yaml", created: false });
    expect(asked).toEqual(["Generate a key and write it to manni.config.yaml? "]);
    expect(stderr).toEqual(["Encryption key written to manni.config.yaml.\n"]);
    expect((await findConfigFile(root, CITE))?.encryptionKey).toBe(result.key);
  });

  it.skipIf(!hasGit)("warns before asking when the file is not ignored by git", async () => {
    const root = repo({ "manni.config.yaml": "cite: {}\n" });
    const { confirm } = answering(true);
    const notices: string[] = [];
    await ensureEncryptionKey({
      subject: "/owner",
      cwd: root,
      file: await findConfigFile(root, CITE),
      env: {},
      confirm,
      notice: (m) => notices.push(m),
      toError,
    });
    expect(notices).toEqual([NO_KEY, committedKeyWarning("manni.config.yaml")]);
  });

  it("says nothing about git when there is no repository", async () => {
    const root = repo({}, false);
    const { confirm } = answering(true);
    const notices: string[] = [];
    await ensureEncryptionKey({
      subject: "/owner",
      cwd: root,
      file: null,
      env: {},
      confirm,
      notice: (m) => notices.push(m),
      toError,
    });
    expect(notices).toEqual([NO_KEY]);
  });

  it("a declined question stops the command and writes nothing", async () => {
    const root = repo({ "manni.config.yaml": "cite: {}\n" });
    const { confirm, asked } = answering(false);
    await expect(
      ensureEncryptionKey({
        subject: "/owner",
        cwd: root,
        file: await findConfigFile(root, CITE),
        env: {},
        confirm,
        notice: () => undefined,
        toError,
      }),
    ).rejects.toThrow(new KeyError(REFUSAL));
    expect(asked).toHaveLength(1);
    expect(read(join(root, "manni.config.yaml"))).toBe("cite: {}\n");
    expect(stderr).toEqual([]);
  });

  it("off a terminal, refuses with the one line and asks nothing", async () => {
    const root = repo({});
    const notices: string[] = [];
    await expect(
      ensureEncryptionKey({
        subject: "/owner",
        cwd: root,
        file: null,
        env: {},
        notice: (m) => notices.push(m),
        toError,
      }),
    ).rejects.toThrow(new KeyError(REFUSAL));
    expect(notices).toEqual([]);
    expect(existsSync(join(root, "manni.config.yaml"))).toBe(false);
  });

  it("does not offer to write into a single-tool file", async () => {
    const root = repo({ "docmeta.config.yaml": "paths: [docs]\n" });
    const { confirm, asked } = answering(true);
    await expect(
      ensureEncryptionKey({
        subject: "/owner",
        cwd: root,
        file: await findConfigFile(root, META),
        env: {},
        confirm,
        notice: () => undefined,
        toError,
      }),
    ).rejects.toThrow(/docmeta\.config\.yaml is a single-tool config file/);
    expect(asked).toEqual([]);
    expect(read(join(root, "docmeta.config.yaml"))).toBe("paths: [docs]\n");
  });
});

describe("the question itself", () => {
  async function ask(input: string | null): Promise<{ answer: boolean; shown: string }> {
    const stdin = new PassThrough();
    const out = new PassThrough();
    let shown = "";
    out.on("data", (chunk: Buffer) => {
      shown += chunk.toString("utf8");
    });
    const pending = readlineConfirm(stdin, out)("Generate a key? ");
    if (input === null) stdin.end();
    else stdin.write(input);
    const answer = await pending;
    return { answer, shown };
  }

  it.each([
    ["y\n", true],
    ["Y\n", true],
    ["yes\n", true],
    [" YES \n", true],
    ["\n", false],
    ["n\n", false],
    ["no\n", false],
    ["yep\n", false],
  ])("%j answers %s", async (input, expected) => {
    const { answer, shown } = await ask(input);
    expect(answer).toBe(expected);
    expect(shown).toContain("Generate a key? [y/N] ");
  });

  it("end of input is no, and ends the prompt's line", async () => {
    const { answer, shown } = await ask(null);
    expect(answer).toBe(false);
    expect(shown).toBe("Generate a key? [y/N] \n");
  });

  it("is not offered unless stdin and stderr are both terminals", () => {
    const stdinTTY = process.stdin.isTTY;
    const stderrTTY = process.stderr.isTTY;
    try {
      process.stdin.isTTY = false;
      process.stderr.isTTY = true;
      expect(terminalConfirm()).toBeUndefined();
      process.stdin.isTTY = true;
      process.stderr.isTTY = false;
      expect(terminalConfirm()).toBeUndefined();
      process.stdin.isTTY = true;
      process.stderr.isTTY = true;
      expect(typeof terminalConfirm()).toBe("function");
    } finally {
      process.stdin.isTTY = stdinTTY;
      process.stderr.isTTY = stderrTTY;
    }
  });
});
