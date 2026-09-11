/**
 * `runSaltSet` and `runSaltRotate` against throwaway directories. `set`
 * edits a config in place, so every case reads the file back and asserts
 * what survived. `rotate` mints under one salt with `mintCitation`, rotates
 * to another, and proves the result with `checkCitations` under the new salt.
 * Every refusal is pinned to its exact text, because the CLI prints it as is.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runSaltRotate, runSaltSet } from "../../src/cite/commands/salt.js";
import { checkCitations } from "../../src/cite/core/check-page.js";
import { loadCiteConfig } from "../../src/cite/core/config.js";
import { hashLines, hashRange } from "../../src/cite/core/hash.js";
import { mintCitation } from "../../src/cite/core/mint.js";
import { generateSalt, obfuscatePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { SaltRotateOptions, SaltRotateRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "cite");
const FIXTURE_CONFIG = join(FIXTURES, "config", "manni.config.yaml");
const LIMITS = readFileSync(join(FIXTURES, "src", "limits.ts"), "utf8");
const LINE_2 = "export const FETCH_TIMEOUT_MS = 10_000;";

const OLD = "SALT-OLD";
const NEW = "SALT-NEW";
const HEX32 = /^[0-9a-f]{32}$/;

let cwd = "";

/**
 * A fresh directory per case, with a `.git` directory so config discovery
 * stops at it rather than walking up into whatever the machine has above
 * the temp directory.
 */
function workspace(): string {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-salt-"));
  mkdirSync(join(cwd, ".git"));
  return cwd;
}
const CONFIG = "manni.config.yaml";
function writeConfig(text: string, name = CONFIG): string {
  writeFileSync(join(cwd, name), text, "utf8");
  return join(cwd, name);
}
const readConfig = (name = CONFIG): string => readFileSync(join(cwd, name), "utf8");
const saltIn = (name = CONFIG): unknown => (parseYaml(readConfig(name)) as { cite?: { salt?: unknown } }).cite?.salt;

afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("generateSalt", () => {
  it("is 32 lowercase hex characters, fresh each time", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toMatch(HEX32);
    expect(b).toMatch(HEX32);
    expect(a).not.toBe(b);
  });
});

describe("runSaltSet", () => {
  const DOCUMENTED = [
    "# The family file, documented.",
    "collections:",
    "  - name: pages   # every page",
    '    paths: ["pages/*.md"]',
    "meta:",
    '  schemas: ["./docs.schema.json"]',
    "cite:",
    "  git: false   # no git here",
    "  # the table",
    "  severity:",
    "    moved: error",
    "",
  ].join("\n");

  it("writes cite.salt into the discovered file and keeps its comments and other keys", async () => {
    workspace();
    writeConfig(DOCUMENTED);
    const result = await runSaltSet({ cwd, value: "abc123" });
    expect(result).toEqual({ source: CONFIG, path: join(cwd, CONFIG), written: true });
    const text = readConfig();
    for (const line of ["# The family file, documented.", "  - name: pages # every page", "  git: false # no git here", "  # the table"]) {
      expect(text).toContain(line);
    }
    expect(parseYaml(text)).toEqual({
      collections: [{ name: "pages", paths: ["pages/*.md"] }],
      meta: { schemas: ["./docs.schema.json"] },
      cite: { git: false, severity: { moved: "error" }, salt: "abc123" },
    });
    // What the tool reads back is what was written.
    const loaded = await loadCiteConfig(undefined, cwd);
    expect(loaded?.config.salt).toBe("abc123");
  });

  it("creates the cite: section when the file has none", async () => {
    workspace();
    writeConfig('collections:\n  - name: pages\n    paths: ["pages/*.md"]\n');
    await runSaltSet({ cwd, value: "abc123" });
    expect(readConfig()).toBe('collections:\n  - name: pages\n    paths: [ "pages/*.md" ]\ncite:\n  salt: abc123\n');
  });

  it("generates 32 lowercase hex characters when no value is given, and never returns them", async () => {
    workspace();
    writeConfig("cite:\n  git: false\n");
    const result = await runSaltSet({ cwd });
    expect(Object.keys(result).sort()).toEqual(["path", "source", "written"]);
    expect(saltIn()).toMatch(HEX32);
  });

  it("quotes a salt YAML would otherwise read as a number", async () => {
    workspace();
    writeConfig("cite: {}\n");
    await runSaltSet({ cwd, value: "12345678901234567890123456789012" });
    expect(saltIn()).toBe("12345678901234567890123456789012");
  });

  it("takes -c as the file to edit, and names it as typed", async () => {
    workspace();
    writeConfig("cite:\n  git: false\n", "other.yaml");
    const result = await runSaltSet({ cwd, configPath: "other.yaml", value: "abc123" });
    expect(result.source).toBe("other.yaml");
    expect(saltIn("other.yaml")).toBe("abc123");
  });

  it("refuses when a salt is already configured", async () => {
    workspace();
    copyFileSync(FIXTURE_CONFIG, join(cwd, CONFIG));
    const before = readConfig();
    expect(await refusal(runSaltSet({ cwd, value: "abc123" }))).toBe(
      "A salt is already configured in manni.config.yaml. Run `manni cite salt rotate` to replace it and re-key every obfuscated citation.",
    );
    expect(readConfig()).toBe(before);
  });

  it("refuses when no config file is found", async () => {
    workspace();
    expect(await refusal(runSaltSet({ cwd, value: "abc123" }))).toBe(
      "No manni.config.yaml found. Create one, or name it with -c.",
    );
  });

  it("refuses an empty value", async () => {
    workspace();
    writeConfig("cite: {}\n");
    expect(await refusal(runSaltSet({ cwd, value: "" }))).toBe("The salt must not be empty.");
    expect(readConfig()).toBe("cite: {}\n");
  });

  it("warns when MANNI_CITE_SALT is set, because it wins over the key just written", async () => {
    workspace();
    writeConfig("cite: {}\n");
    const warned: string[] = [];
    await runSaltSet({ cwd, value: "abc123", env: { MANNI_CITE_SALT: "from-env" }, onWarn: (m) => warned.push(m) });
    expect(warned).toEqual(["MANNI_CITE_SALT is set and wins over cite.salt for every run."]);
    expect(saltIn()).toBe("abc123");

    const quiet: string[] = [];
    workspace();
    writeConfig("cite: {}\n");
    await runSaltSet({ cwd, value: "abc123", env: {}, onWarn: (m) => quiet.push(m) });
    expect(quiet).toEqual([]);
  });

  it("--dry-run writes nothing", async () => {
    workspace();
    writeConfig(DOCUMENTED);
    const result = await runSaltSet({ cwd, value: "abc123", dryRun: true });
    expect(result).toEqual({ source: CONFIG, path: join(cwd, CONFIG), written: false });
    expect(readConfig()).toBe(DOCUMENTED);
  });
});

describe("runSaltRotate", () => {
  /** A root with the ladder SOURCE, a config carrying `salt`, and a `pages/` directory. */
  function root(config = `cite:\n  salt: ${OLD}\n  git: false\n`): void {
    workspace();
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "pages"));
    writeFileSync(join(cwd, "src", "limits.ts"), LIMITS, "utf8");
    writeConfig(config);
  }
  function page(name: string, lines: string[]): string {
    writeFileSync(join(cwd, "pages", name), lines.join("\n") + "\n", "utf8");
    return `pages/${name}`;
  }
  const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
  const rotate = (over: Partial<SaltRotateOptions> & { inputs: string[] }): Promise<SaltRotateRun> =>
    runSaltRotate({ cwd, root: cwd, git: false, to: NEW, env: {}, ...over });
  async function statuses(label: string, salt: string): Promise<string[]> {
    const report = await checkCitations({ file: label, content: onDisk(label) }, { root: cwd, git: false, salt });
    return report.citations.map((c) => c.status);
  }

  /** A page with one token in each channel and one plain entry, all minted under OLD. */
  async function mintedPage(): Promise<{ label: string; tokenOld: string; tokenNew: string; before: string }> {
    const one = await mintCitation({ root: cwd, src: "src/limits.ts:2", salt: OLD, obfuscate: true, commit: false });
    const three = await mintCitation({ root: cwd, src: "src/limits.ts:1-3", salt: OLD, obfuscate: true, commit: false });
    const plain = await mintCitation({ root: cwd, src: "src/limits.ts:3", commit: false });
    const label = page("limits.md", [
      "---",
      "title: Limits   # kept",
      "citations:",
      "  - id: fetch-timeout",
      `    src: ${one.src}`,
      `    integrity: ${one.integrity}`,
      "    claim: The fetch timeout is 10 seconds.",
      `  - src: ${plain.src}`,
      `    integrity: ${plain.integrity}`,
      "---",
      "# Limits",
      "",
      "The fetch timeout is 10 seconds.",
      "",
      `<!-- cite {"src": "${three.src}", "integrity": "${three.integrity}", "claim": "Three limits."} -->`,
      "Three limits.",
    ]);
    return { label, tokenOld: obfuscatePath("src/limits.ts", OLD), tokenNew: obfuscatePath("src/limits.ts", NEW), before: onDisk(label) };
  }

  it("re-keys a frontmatter token and an inline token, leaves a plain entry alone, and writes the new salt", async () => {
    root();
    const { label, tokenOld, tokenNew, before } = await mintedPage();
    expect(await statuses(label, OLD)).toEqual(["current", "current", "current"]);

    const run = await rotate({ inputs: [label] });
    expect(run).toMatchObject({ rekeyed: 2, skipped: 0, saltWritten: true, saltSource: "config", exitCode: 0, source: CONFIG });
    expect(run.pages).toHaveLength(1);
    expect(run.pages[0]?.written).toBe(true);
    expect(run.pages[0]?.skipped).toEqual([]);
    expect(run.pages[0]?.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 4, from: `${tokenOld}:2`, to: `${tokenNew}:2` },
      { line: 15, from: `${tokenOld}:1-3`, to: `${tokenNew}:1-3` },
    ]);

    const after = onDisk(label);
    expect(after).not.toContain(tokenOld);
    expect(after).toContain(`    src: ${tokenNew}:2\n`);
    expect(after).toContain(`    integrity: ${hashLines(LINE_2, NEW)}\n`);
    expect(after).toContain(`<!-- cite {"src": "${tokenNew}:1-3", "integrity": "${hashRange(LIMITS, { start: 1, end: 3 }, NEW)}", "claim": "Three limits."} -->`);
    // Only the four pinned values changed; the comment, the plain entry and the body are as they were.
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toHaveLength(3);
    expect(after).toContain("title: Limits   # kept");
    expect(after).toContain("  - src: src/limits.ts:3\n");

    expect(saltIn()).toBe(NEW);
    expect(await statuses(label, NEW)).toEqual(["current", "current", "current"]);
    expect(await statuses(label, OLD)).toEqual(["missing", "current", "missing"]);
  });

  it("--dry-run rewrites nothing and writes no salt", async () => {
    root();
    const { label, before } = await mintedPage();
    const run = await rotate({ inputs: [label], dryRun: true });
    expect(run).toMatchObject({ rekeyed: 2, skipped: 0, saltWritten: false, exitCode: 0, dryRun: true });
    expect(run.pages[0]?.written).toBe(false);
    expect(onDisk(label)).toBe(before);
    expect(saltIn()).toBe(OLD);
  });

  it("generates the new salt when --to is absent", async () => {
    root();
    const { label, tokenOld } = await mintedPage();
    const run = await rotate({ inputs: [label], to: undefined });
    expect(run.saltWritten).toBe(true);
    const written = saltIn();
    expect(written).toMatch(HEX32);
    expect(onDisk(label)).not.toContain(tokenOld);
    expect(await statuses(label, written as string)).toEqual(["current", "current", "current"]);
  });

  it("skips a changed entry, and then writes neither the pages nor the salt", async () => {
    root();
    const { label, before } = await mintedPage();
    const stale = page("stale.md", [
      "---",
      "citations:",
      `  - src: ${obfuscatePath("src/limits.ts", OLD)}:2`,
      `    integrity: ${hashLines("something else", OLD)}`,
      "---",
      "Body.",
    ]);
    const run = await rotate({ inputs: [label, stale] });
    expect(run).toMatchObject({ rekeyed: 2, skipped: 1, saltWritten: false, exitCode: 1 });
    expect(run.pages.map((p) => p.written)).toEqual([false, false]);
    expect(run.pages[1]?.skipped).toEqual([
      { index: 0, line: 3, src: `${obfuscatePath("src/limits.ts", OLD)}:2`, reason: "changed; run `manni cite update --accept` before rotating" },
    ]);
    expect(onDisk(label)).toBe(before);
    expect(saltIn()).toBe(OLD);
  });

  it("skips a token that resolves to nothing under the current salt", async () => {
    root();
    const wrong = obfuscatePath("src/limits.ts", "some-other-salt");
    const label = page("wrong.md", [
      "---",
      "citations:",
      `  - id: elsewhere`,
      `    src: ${wrong}:2`,
      `    integrity: ${hashLines(LINE_2, "some-other-salt")}`,
      "---",
      "Body.",
    ]);
    const run = await rotate({ inputs: [label] });
    expect(run).toMatchObject({ rekeyed: 0, skipped: 1, saltWritten: false, exitCode: 1 });
    expect(run.pages[0]?.skipped).toEqual([
      { id: "elsewhere", index: 0, line: 3, src: `${wrong}:2`, reason: "missing (no tracked file matches under the current salt)" },
    ]);
    expect(saltIn()).toBe(OLD);
  });

  it("an environment salt rotates through the environment: --to re-keys, and the config is left byte-identical", async () => {
    root(`cite:\n  salt: not-the-one\n  git: false\n`);
    const { label, tokenOld } = await mintedPage();
    const configBefore = readConfig();
    const run = await rotate({ inputs: [label], env: { MANNI_CITE_SALT: OLD } });
    expect(run).toMatchObject({ rekeyed: 2, skipped: 0, saltWritten: false, saltSource: "env", exitCode: 0, dryRun: false });
    expect(run.pages[0]?.written).toBe(true);
    expect(onDisk(label)).not.toContain(tokenOld);
    expect(readConfig()).toBe(configBefore);
    expect(await statuses(label, NEW)).toEqual(["current", "current", "current"]);
  });

  it("an environment salt needs --to, so the new value never reaches the config", async () => {
    root(`cite:\n  salt: not-the-one\n  git: false\n`);
    const { label, before } = await mintedPage();
    const configBefore = readConfig();
    expect(await refusal(rotate({ inputs: [label], to: undefined, env: { MANNI_CITE_SALT: OLD } }))).toBe(
      "The salt comes from MANNI_CITE_SALT; pass --to <value>, re-key with it, then update the secret. Nothing is written to config.",
    );
    expect(onDisk(label)).toBe(before);
    expect(readConfig()).toBe(configBefore);
  });

  it("refuses when no salt is configured", async () => {
    root("cite:\n  git: false\n");
    const label = page("p.md", ["---", "title: t", "---", "Body."]);
    expect(await refusal(rotate({ inputs: [label] }))).toBe(
      "No salt is configured; nothing to rotate. Run `manni cite salt set` first.",
    );
  });

  it("refuses when no config file is found", async () => {
    workspace();
    mkdirSync(join(cwd, "pages"));
    const label = page("p.md", ["---", "title: t", "---", "Body."]);
    expect(await refusal(rotate({ inputs: [label] }))).toBe(
      "No manni.config.yaml found. Create one, or name it with -c.",
    );
  });

  it("refuses an empty --to", async () => {
    root();
    const label = page("p.md", ["---", "title: t", "---", "Body."]);
    expect(await refusal(rotate({ inputs: [label], to: "" }))).toBe("The salt must not be empty.");
  });

  it("refuses with nothing to rotate", async () => {
    root();
    expect(await refusal(rotate({ inputs: [] }))).toBe(
      "No files to rotate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("refuses stdin: a rotated page has to be written back", async () => {
    root();
    expect(await refusal(rotate({ inputs: ["-"], as: "markdown" }))).toBe(
      "salt rotate cannot read from stdin: a rotated page is written back to its file.",
    );
  });

  it.skipIf(!gitAvailable())("re-keys a changed entry from the lines at its commit when git can show them", async () => {
    workspace();
    const repo = makeTempRepo({
      files: {
        "src/limits.ts": LIMITS,
        "manni.config.yaml": `cite:\n  salt: ${OLD}\n`,
      },
    });
    try {
      const commit = commitAll(repo, "limits");
      const minted = await mintCitation({ root: repo, src: "src/limits.ts:2", salt: OLD, obfuscate: true, commit });
      mkdirSync(join(repo, "pages"));
      const label = "pages/limits.md";
      writeFileSync(
        join(repo, label),
        ["---", "citations:", `  - src: ${minted.src}`, `    integrity: ${minted.integrity}`, `    commit: ${commit}`, "---", "Body.", ""].join("\n"),
        "utf8",
      );
      writeFileSync(join(repo, "src", "limits.ts"), LIMITS.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 30_000"), "utf8");
      commitAll(repo, "raise the timeout");

      const run = await runSaltRotate({ cwd: repo, root: repo, to: NEW, env: {}, inputs: [label] });
      expect(run).toMatchObject({ rekeyed: 1, skipped: 0, saltWritten: true, exitCode: 0 });
      const after = readFileSync(join(repo, label), "utf8");
      // The pin is over the lines as they were at the commit, so the entry is still `changed`, not `never-true`.
      expect(after).toContain(`    integrity: ${hashLines(LINE_2, NEW)}\n`);
      expect(after).toContain(`  - src: ${obfuscatePath("src/limits.ts", NEW)}:2\n`);
      const report = await checkCitations({ file: label, content: after }, { root: repo, salt: NEW });
      expect(report.citations.map((c) => c.status)).toEqual(["changed"]);
    } finally {
      removeTempRepo(repo);
    }
  });
});
