/**
 * Evidence-pinned personas (proposal 0108), against the built `dist/cli.js`:
 * a persona schema that requires `citations`, a pain pinned by pointer into a
 * research folder with no git, and what each command says as the record and
 * the evidence change.
 *
 * Every run works in a throwaway copy of `test/fixtures/strategy/evidence`, in
 * the temp directory and outside any git work tree. The steps run in order,
 * each on the state the one before it left.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURE = resolve(root, "test", "fixtures", "strategy", "evidence");
const THEO = "records/personas/theo.md";
const SIDECAR = "records/personas/theo.citations.yaml";
/** The note, as the research checkout names it, and as a path from the fixture root. */
const NOTE_SRC = "notes/2026-09-12-contributor.md";
const NOTE = `research/${NOTE_SRC}`;
/** A sentinel key, never a real one. */
const KEY = "evidence-test-key-0123456789abcdef0123";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

let work = "";

function run(args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const base: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...env };
  if (env.MANNI_ENCRYPTION_KEY === undefined) delete base.MANNI_ENCRYPTION_KEY;
  const r = spawnSync(process.execPath, [manni, ...args], { cwd: work, encoding: "utf8", env: base });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

const read = (rel: string): string => readFileSync(join(work, rel), "utf8");
const write = (rel: string, text: string): void => {
  writeFileSync(join(work, rel), text, "utf8");
};

/** The `N records` the strategy check counts. */
const recordCount = (out: string): string | undefined => /(\d+) records?/.exec(out)?.[1];

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  work = mkdtempSync(join(tmpdir(), "manni-strategy-evidence-"));
  cpSync(FIXTURE, work, { recursive: true });
}, 180000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("a persona that rests on evidence", () => {
  let records: string | undefined;

  it("1. fails meta validate with no citations, and says what the key is for", () => {
    records = recordCount(run(["strategy", "check"]).stdout);
    const r = run(["meta", "validate", "records/"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("(root)  must have required property 'citations'");
    expect(r.stdout).toContain("citations: The evidence the record's claims rest on.");
  });

  it("2. cite add pins a pain by pointer into the record's sidecar, and says the research folder has no git", () => {
    const r = run(["cite", "add", `${THEO}#/pains/0`, `research:${NOTE_SRC}:3`, "--id", "terse-messages"]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain(`${THEO}: added terse-messages to ${SIDECAR}:`);
    expect(r.stdout).toContain("(claim at /pains/0, sha256-");
    expect(r.stderr.match(/research: git is not available here/g)).toHaveLength(1);
    expect(read(SIDECAR)).toContain("pointer: /pains/0");
  });

  it("3. passes meta validate for that record", () => {
    const r = run(["meta", "validate", THEO]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
  });

  it("4. reads #/pains/0 current under cite check", () => {
    const r = run(["cite", "check", "--collection", "strategy"]);
    expect(r.stdout).toMatch(/✓ terse-messages\s+#\/pains\/0 current\s+research:notes\/2026-09-12-contributor\.md:3 current/);
    expect(r.status, r.stderr + r.stdout).toBe(0);
  });

  it("5. leaves strategy check clean, with its record count unchanged", () => {
    const r = run(["strategy", "check"]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(recordCount(r.stdout)).toBe(records);
  });

  it("6. reads a reordered pain claim-moved, and cite update rewrites the pointer", () => {
    write(THEO, read(THEO).replace(
      "  - Error messages are terse with no remediation hint.\n  - He does not know which schema fired.",
      "  - He does not know which schema fired.\n  - Error messages are terse with no remediation hint.",
    ));
    const check = run(["cite", "check", THEO]);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("#/pains/0 moved -> #/pains/1");
    expect(check.stdout).toContain("manni:cite claim-moved: The pinned metadata value sits at another pointer.");
    const update = run(["cite", "update", THEO]);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain(`${THEO}: terse-messages claim #/pains/0 -> #/pains/1 (moved)`);
    expect(read(SIDECAR)).toContain("pointer: /pains/1");
  });

  it("7. reads an edited evidence line source-changed, and exits 1", () => {
    const note = read(NOTE);
    write(NOTE, note.replace("said nothing about the fix", "said little about the fix"));
    const r = run(["cite", "check", THEO]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("manni:cite source-changed:");
    write(NOTE, note);
  });

  it("8. reads a deleted evidence file source-missing, and exits 1", () => {
    const note = read(NOTE);
    rmSync(join(work, NOTE));
    const r = run(["cite", "check", THEO]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("manni:cite source-missing:");
    write(NOTE, note);
  });

  it("9. refuses a pain's frontmatter line, naming its pointer", () => {
    const line = read(THEO).split("\n").findIndex((l) => l === "  - He does not know which schema fired.") + 1;
    const r = run(["cite", "add", `${THEO}:${String(line)}`, `research:${NOTE_SRC}:4`]);
    expect(r.status).toBe(2);
    // After the root notice a run outside git says first.
    expect(r.stderr.split("\n")).toContain(
      `manni: ${THEO}:${String(line)} is in the frontmatter. Cite the value there as ${THEO}#/pains/0.`,
    );
  });

  it("10. under --encrypt, writes an encrypted path and a keyed pin, and names neither the path nor the key", () => {
    const r = run(["cite", "add", `${THEO}#/pains/0`, `research:${NOTE_SRC}:4`, "--id", "unknown-schema", "--encrypt"], {
      MANNI_ENCRYPTION_KEY: KEY,
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    // The entry this run wrote. The one step 2 wrote is plain, as it was minted.
    const sidecar = read(SIDECAR);
    const entry = sidecar.slice(sidecar.indexOf("- id: unknown-schema"));
    expect(entry).toMatch(/file: ~[A-Za-z0-9_-]{82,}/);
    expect(entry).toContain("integrity: hmac-sha256-");
    const json = run(["cite", "check", THEO, "-f", "json"], { MANNI_ENCRYPTION_KEY: KEY });
    const pages = (JSON.parse(json.stdout) as { pages: { citations: { id?: string }[] }[] }).pages;
    const row = JSON.stringify(pages[0]?.citations.find((c) => c.id === "unknown-schema"));
    for (const text of [entry, row]) {
      expect(text).not.toContain("2026-09-12-contributor");
      expect(text).not.toContain(KEY);
    }
    expect(sidecar).not.toContain(KEY);
    expect(json.stdout).not.toContain(KEY);
  });
});
