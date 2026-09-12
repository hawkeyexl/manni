/**
 * `manni key …` against the built `dist/cli.js`: the grammar, every refusal
 * with its exact stderr line and exit code, and the deterministic rungs of the
 * ladder. Each run works in a throwaway directory with a hand-made `.git`, so
 * discovery stops there and the source root is the directory, and no git
 * command answers for it. The developer's key never reaches a run.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { encryptValue } from "../../src/shared/encryption.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");

/** Fixed test keys. Never real ones. */
const OLD = "cli-old-key-0123456789abcdef0123456789";
const NEW = "cli-new-key-0123456789abcdef0123456789";
const STRANGER = "cli-stranger-0123456789abcdef012345678";
const SOURCE = "export const RETRIES = 3;\nexport const FETCH_TIMEOUT_MS = 10_000;\n";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Run {
  const r = spawnSync("node", [manni, ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    // An empty MANNI_ENCRYPTION_KEY counts as unset; a case that wants a key
    // passes its own.
    env: { ...process.env, NO_COLOR: "1", MANNI_ENCRYPTION_KEY: "", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

let work: string;
const key = (args: string[], env?: Record<string, string>): Run =>
  run(["key", ...args], { cwd: work, env });

function write(files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(work, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
}

const readConfig = (): Record<string, unknown> =>
  parse(readFileSync(join(work, "manni.config.yaml"), "utf8")) as Record<string, unknown>;

/** A family under OLD: a collection of two pages, one with an owner, one citing. */
function family(opts: { key?: boolean; extra?: Record<string, string> } = {}): void {
  write({
    "manni.config.yaml": `${opts.key === false ? "" : `encryptionKey: ${OLD}\n`}collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n`,
    "src/limits.ts": SOURCE,
    "docs/auth.md": `---\ntitle: Auth\nowner: ${encryptValue("platform", OLD, "meta")}\n---\n`,
    "docs/limits.md": [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    source:",
      `      file: ${encryptSourcePath("src/limits.ts", OLD)}`,
      "      lines: 2",
      `      integrity: ${hashRange(SOURCE, { start: 2, end: 2 }, OLD)}`,
      "---",
      "Body.",
      "",
    ].join("\n"),
    ...opts.extra,
  });
}

const refused = (r: Run, message: string): void => {
  expect(r.stderr).toBe(`manni: ${message}\n`);
  expect(r.status).toBe(2);
};

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-key-"));
  mkdirSync(join(work, ".git"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni key (grammar)", () => {
  it("bare, prints usage on stderr and exits 2: there is no default subcommand", () => {
    const r = run(["key"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage: manni key \[options\] \[command\]/m);
  });

  it("--help lists set and rotate, and nothing else", () => {
    const r = run(["key", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\s+set \[options\] \[value\]/m);
    expect(r.stdout).toMatch(/^\s+rotate \[options\] \[paths\.\.\.\]/m);
    expect(r.stdout).toContain("--no-color");
  });

  it("is listed by the umbrella", () => {
    const r = run(["--help"]);
    // Commander wraps a long description at the terminal width, so only its
    // start is on the command's line.
    expect(r.stdout).toMatch(/^\s+key \[options\]\s+Set and rotate the family key/m);
  });

  it("shows the full path in each verb's usage line", () => {
    expect(run(["key", "set", "--help"]).stdout).toMatch(/^Usage: manni key set /m);
    expect(run(["key", "rotate", "--help"]).stdout).toMatch(/^Usage: manni key rotate /m);
  });
});

describe("manni key set", () => {
  it("writes a generated key, names the file, and never prints the key", () => {
    const r = key(["set"]);
    expect(r).toMatchObject({ stdout: "Encryption key written to manni.config.yaml.\n", stderr: "", status: 0 });
    const written = readConfig().encryptionKey;
    expect(written).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stdout + r.stderr).not.toContain(String(written));
  });

  it("--dry-run says what it would write, and writes nothing", () => {
    const r = key(["set", "--dry-run"]);
    expect(r).toMatchObject({ stdout: "Would write encryptionKey to manni.config.yaml.\n", status: 0 });
    expect(existsSync(join(work, "manni.config.yaml"))).toBe(false);
  });

  it("-c writes the named file", () => {
    write({ "ops/manni.config.yaml": "meta: {}\n" });
    const r = key(["set", "-c", "ops/manni.config.yaml", "0123456789abcdef0123456789abcdef"]);
    expect(r).toMatchObject({ stdout: "Encryption key written to ops/manni.config.yaml.\n", status: 0 });
  });

  it("refuses when a key is already configured", () => {
    write({ "manni.config.yaml": `encryptionKey: ${OLD}\n` });
    refused(
      key(["set"]),
      "An encryption key is already configured in manni.config.yaml. Run `manni key rotate` to replace it and re-encrypt every value.",
    );
  });

  it("refuses a value of the wrong shape", () => {
    refused(
      key(["set", "tooshort"]),
      "The key must be at least 32 hex or base64url characters. Run `manni key set` with no value to generate one.",
    );
  });

  it("refuses while MANNI_ENCRYPTION_KEY is set", () => {
    refused(
      key(["set"], { MANNI_ENCRYPTION_KEY: OLD }),
      "MANNI_ENCRYPTION_KEY is set, so a key written to config would never be read. Unset it, or keep the key in the secret.",
    );
  });

  it("refuses to create manni.config.yaml beside a legacy docmeta.config.yaml", () => {
    write({ "docmeta.config.yaml": "allowEmpty: true\n" });
    refused(
      key(["set"]),
      "docmeta.config.yaml is a single-tool config; a manni.config.yaml beside it would hide it. Move its keys under meta: in manni.config.yaml first.",
    );
    expect(existsSync(join(work, "manni.config.yaml"))).toBe(false);
  });

  it("refuses while a rotation is unfinished", () => {
    write({ "manni.config.yaml": `encryptionKey: ${NEW}\nencryptionKeyPrevious: ${OLD}\n` });
    refused(
      key(["set"]),
      "A rotation is unfinished in manni.config.yaml. Run `manni key rotate` with no --to to finish it.",
    );
  });
});

describe("manni key rotate", () => {
  it("a whole run re-encrypts every value and writes the key last", () => {
    family();
    const r = key(["rotate"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^docs\/auth\.md: \/owner {2}~[A-Za-z0-9_-]{4}… {2}-> ~[A-Za-z0-9_-]{4}…$/);
    expect(lines[1]).toMatch(/^docs\/limits\.md: fetch-timeout {2}~[A-Za-z0-9_-]{4}…:2 -> ~[A-Za-z0-9_-]{4}…:2$/);
    expect(lines.slice(2)).toEqual([
      "2 values re-encrypted in 2 files, 0 skipped",
      "Encryption key written to manni.config.yaml.",
    ]);
    expect(readConfig()).not.toHaveProperty("encryptionKeyPrevious");
    expect(readConfig().encryptionKey).not.toBe(OLD);
  });

  it("leaves the citation reading current under the new key", () => {
    family();
    expect(key(["rotate"]).status).toBe(0);
    // Both halves of the source end moved, and the pin is still keyed.
    const page = readFileSync(join(work, "docs", "limits.md"), "utf8");
    expect(page).toMatch(/^ {6}file: ~[A-Za-z0-9_-]{82,}$/m);
    expect(page).toMatch(/^ {6}integrity: hmac-sha256-[0-9a-f]{64}$/m);
    expect(page).not.toContain(encryptSourcePath("src/limits.ts", OLD));

    const r = run(["cite", "check", "docs/limits.md"], { cwd: work });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe(
      "1 file checked, 1 passed, 0 failed, 0 findings",
    );
  });

  it("--no-git is gone, with no alias", () => {
    family();
    const r = key(["rotate", "--no-git"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown option '--no-git'/);
  });

  it("-f json carries full ciphertexts in the plan's shape", () => {
    family();
    const r = key(["rotate", "--to", NEW, "-f", "json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as {
      pages: { file: string; rewritten: { kind: string }[]; written: boolean }[];
      reencrypted: number;
      skipped: number;
      keyWritten: boolean;
    };
    expect(json).toMatchObject({ reencrypted: 2, skipped: 0, keyWritten: true });
    expect(json.pages.map((p) => [p.file, p.rewritten.map((w) => w.kind), p.written])).toEqual([
      ["docs/auth.md", ["metadata"], true],
      ["docs/limits.md", ["citation"], true],
    ]);
    expect(r.stdout).not.toContain(NEW);
    expect(readConfig().encryptionKey).toBe(NEW);
  });

  it("a skipped value exits 1 and writes nothing", () => {
    family({
      extra: { "docs/stray.md": `---\nowner: ${encryptValue("platform", STRANGER, "meta")}\n---\n` },
    });
    const config = readFileSync(join(work, "manni.config.yaml"), "utf8");
    const r = key(["rotate"]);
    expect(r.status).toBe(1);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines).toContain("docs/stray.md: /owner  skipped: does not decrypt under the current key");
    expect(lines.at(-1)).toBe("Key not written: 1 value could not be re-encrypted. Fix it and rotate again.");
    expect(readFileSync(join(work, "manni.config.yaml"), "utf8")).toBe(config);
  });

  it("refuses with no key available", () => {
    family({ key: false });
    refused(
      key(["rotate"]),
      "No encryption key is available, so nothing can be re-encrypted. Run `manni key set` first.",
    );
  });

  it("refuses a key from the environment without --to", () => {
    family({ key: false });
    refused(
      key(["rotate"], { MANNI_ENCRYPTION_KEY: OLD }),
      "The key comes from MANNI_ENCRYPTION_KEY; pass --to <value>, re-encrypt with it, then update the secret. Nothing is written to config.",
    );
  });

  it("refuses a narrowed run without --to", () => {
    family();
    refused(key(["rotate", "docs/"]), "A run over part of the family needs --to, and never writes the key.");
  });

  it("a narrowed run with --to says how to finish", () => {
    family();
    const r = key(["rotate", "--collection", "site", "--to", NEW]);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe(
      "Key not written: this run covered part of the family. Finish with a whole run under the same key: `manni key rotate --to <the same value>`.",
    );
    expect(readConfig().encryptionKey).toBe(OLD);
  });

  it("refuses another --to while a rotation is unfinished", () => {
    family();
    write({ "manni.config.yaml": `encryptionKey: ${NEW}\nencryptionKeyPrevious: ${OLD}\ncollections:\n  - name: site\n    paths: ["docs/**/*.md"]\n` });
    refused(
      key(["rotate", "--to", STRANGER]),
      "A rotation is unfinished in manni.config.yaml. Run `manni key rotate` with no --to to finish it.",
    );
  });

  it("finishes an unfinished rotation and says so", () => {
    family();
    write({ "manni.config.yaml": `encryptionKey: ${NEW}\nencryptionKeyPrevious: ${OLD}\ncollections:\n  - name: site\n    paths: ["docs/**/*.md"]\n` });
    const r = key(["rotate"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split("\n").slice(-2)).toEqual([
      "Finished the interrupted rotation in manni.config.yaml.",
      "2 values re-encrypted in 2 files, 0 skipped",
    ]);
    expect(readConfig()).not.toHaveProperty("encryptionKeyPrevious");
  });

  it("refuses a --to of the wrong shape", () => {
    family();
    refused(key(["rotate", "--to", "tooshort"]), "--to must be at least 32 hex or base64url characters.");
  });

  it("refuses an unknown --format", () => {
    family();
    refused(key(["rotate", "-f", "sarif"]), 'Unknown --format "sarif". Use pretty or json.');
  });

  it("refuses stdin: it reads and writes files", () => {
    family();
    refused(
      key(["rotate", "-", "--to", NEW]),
      "key rotate reads and writes files, so it takes no stdin (`-`). Name the files instead.",
    );
  });
});
