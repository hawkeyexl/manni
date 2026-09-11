/**
 * `runAdd` against temp copies of the fixture pages, with `test/fixtures/cite`
 * as the root so `src/limits.ts` is the ladder SOURCE. `commitSha: false`
 * keeps the minted entry deterministic; the one HEAD case runs only where git
 * is. Every refusal is pinned to its exact text, because the CLI prints it as
 * is.
 *
 * The page lines a caller gives are FILE lines, as an editor numbers them.
 * What the entry stores is BODY lines, counted from the first line after the
 * frontmatter, and what the result reports is file lines *after* the append.
 * Those three are different numbers, so each is asserted separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import { decryptSourcePath, encryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { AddOptions, AddResult } from "../../src/cite/types.js";
import { gitAvailable } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
/** A fixed test key; never the developer's environment. */
const KEY = "add-key-0123456789abcdef0123456789abc";

/** Source pins: `src/limits.ts`, whole and by line. */
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
/** Claim pins: the page text, always plain. */
const CLAIM = "The fetch timeout is 10 seconds.";
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const WRAPPED_PIN = "sha256-93f59d1e26513d9a8be099c55aa8ba06c90020f079d7fb16d4a7ca65851f0ec3";
const BLOCK_PIN = "sha256-caadbbaf3c4628bac327f01aea6aa17ff283269e7a8814a1f3ea443da36e90e0";
const NO_COMMIT = "git is not available here, so the citation records no commit.";

const LINE_2 = "export const FETCH_TIMEOUT_MS = 10_000;";
const LINE_3 = "export const RETRIES = 3;";
const LINES_1_3 = ["export const MAX_FILES = 10_000;", LINE_2, LINE_3];
/** Built out of band so the fence never opens a block in this file. */
const TICKS = String.fromCharCode(96, 96, 96);
const OPEN = `${TICKS}ts`;
const CLOSE = TICKS;

let cwd = "";

/** A fresh working directory per case, holding copies of the fixture pages it names. */
function workspace(...pages: string[]): void {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-add-"));
  mkdirSync(join(cwd, "pages"));
  for (const name of pages) copyFileSync(join(PAGES, name), join(cwd, "pages", name));
}
/** Write a page of the test's own into the workspace. */
function write(name: string, lines: string[]): string {
  if (cwd === "" || !existsSync(cwd)) workspace();
  writeFileSync(join(cwd, "pages", name), lines.join("\n") + "\n", "utf8");
  return `pages/${name}`;
}
/** A page whose body is one fenced block, with the lead and tail around it. */
function fenced(name: string, lead: string[], block: string[], tail: string[] = []): string {
  return write(name, ["---", "title: Limits", "---", ...lead, OPEN, ...block, CLOSE, ...tail]);
}
const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function add(over: Partial<AddOptions> & { page: string; src: string }): Promise<AddResult> {
  return runAdd({ cwd, root: ROOT, noConfig: true, commitSha: false, env: {}, ...over });
}

/** What `runCheck` says about the page afterwards: what a CI job would see. */
async function recheck(
  label: string,
  configPath?: string,
): Promise<{ ends: string[]; findings: string[] }> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    gitClient: noGit(),
    env: {},
    inputs: [label],
    ...(configPath === undefined ? { noConfig: true } : { configPath }),
  });
  const page = run.pages[0];
  return {
    ends: page?.citations.map((c) => `${c.claim?.status ?? "none"}/${c.source.status}`) ?? [],
    findings: page?.findings.map((f) => f.rule) ?? [],
  };
}
const CURRENT = { ends: ["current/current"], findings: [] };

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

/** `manni.config.yaml` in the workspace: the given `cite:` body, and the family key when given. */
function tempConfig(cite: string, key?: string): string {
  const path = join(cwd, "manni.config.yaml");
  const family = key === undefined ? "" : `encryptionKey: ${key}\n`;
  writeFileSync(path, `${family}cite:\n${cite.replace(/^/gm, "  ")}\n`, "utf8");
  return path;
}

describe("runAdd", () => {
  describe("a bare pin", () => {
    it("writes a source and nothing else", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts" });
      expect(result.placed).toBe("frontmatter");
      expect(result.file).toBe("pages/no-citations.md");
      expect(result.citation).toEqual({ source: { file: "src/limits.ts", integrity: PIN_WHOLE } });
      expect(result.claimLines).toBeUndefined();
      expect(result.markerLine).toBeUndefined();
      expect(result.written).toBe(true);
      expect(onDisk(result.file)).toBe(result.content);
      expect(result.content).not.toContain("cite ");
      expect(await recheck(result.file)).toEqual({ ends: ["none/current"], findings: [] });
    });

    it("names the page in the diff and leaves the body alone", async () => {
      workspace("no-citations.md");
      const before = onDisk("pages/no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2" });
      expect(result.diff.split("\n").slice(0, 2)).toEqual([
        "--- pages/no-citations.md",
        "+++ pages/no-citations.md",
      ]);
      expect(result.diff).toContain("+citations:");
      expect(result.content.slice(result.content.indexOf("# Limits"))).toBe(
        before.slice(before.indexOf("# Limits")),
      );
    });
  });

  describe("a claim", () => {
    it("stores body lines and reports the file line after the write", async () => {
      workspace("no-citations.md");
      // File line 6 is the claim; body line 1 is file line 4, so the entry says 3.
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
      });
      expect(result.citation).toEqual({
        claim: { lines: 3, integrity: CLAIM_PIN },
        source: { file: "src/limits.ts", lines: 2, integrity: PIN_L2 },
      });
      expect(result.claimLines).toEqual({ start: 14, end: 14 });
      expect(result.content.split("\n")[13]).toBe(CLAIM);
      expect(readPage(result.file, result.content).citations[0]?.citation).toEqual(result.citation);
      expect(await recheck(result.file)).toEqual(CURRENT);
    });

    it("writes a range for a claim that spans lines", async () => {
      workspace("claim-range.md");
      const result = await add({
        page: "pages/claim-range.md",
        src: "src/limits.ts:2",
        pageLines: { start: 15, end: 16 },
      });
      expect(result.citation.claim).toEqual({ lines: "3-4", integrity: WRAPPED_PIN });
      expect(result.claimLines).toEqual({ start: 22, end: 23 });
      const lines = result.content.split("\n");
      expect(lines.slice(21, 23)).toEqual([
        "The fetch timeout is 10 seconds. It is",
        "not configurable.",
      ]);
      expect(await recheck(result.file)).toEqual({
        ends: ["current/current", "current/current"],
        findings: [],
      });
    });

    it("orders the entry id, claim, source, quote", async () => {
      const label = fenced("ordered.md", ["# Limits", ""], LINES_1_3);
      const result = await add({
        page: label,
        src: "src/limits.ts:1-3",
        pageLines: { start: 6, end: 10 },
        quote: true,
        id: "header",
      });
      expect(Object.keys(result.citation)).toEqual(["id", "claim", "source", "quote"]);
      expect(Object.keys(result.citation.source)).toEqual(["file", "lines", "integrity"]);
      expect(result.content).toMatch(
        /- id: header\n\s+claim:\n\s+lines: .*\n\s+integrity: .*\n\s+source:\n\s+file: .*\n\s+lines: .*\n\s+integrity: .*\n\s+quote: true\n/,
      );
    });

    it("keeps comments, key order and the body byte-for-byte", async () => {
      const label = write("commented.md", [
        "---",
        "# house rule: description first",
        "description: Limits of the fetcher",
        "title: Limits # shown in the nav",
        "---",
        "# Limits",
        "",
        CLAIM,
      ]);
      const before = onDisk(label);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 8, end: 8 },
      });
      expect(result.content).toContain("# house rule: description first");
      expect(result.content).toContain("title: Limits # shown in the nav");
      expect(result.content.indexOf("description:")).toBeLessThan(result.content.indexOf("title:"));
      expect(result.content.slice(result.content.indexOf("\n# Limits"))).toBe(
        before.slice(before.indexOf("\n# Limits")),
      );
    });

    it("keeps a CRLF page CRLF", async () => {
      workspace("crlf.md");
      const result = await add({
        page: "pages/crlf.md",
        src: "src/limits.ts:3",
        pageLines: { start: 15, end: 15 },
      });
      expect(result.content.replace(/\r\n/g, "")).not.toContain("\n");
      expect(result.content).toContain(`      integrity: ${PIN_L3}\r\n`);
      expect(result.citation.claim).toEqual({ lines: 3, integrity: CLAIM_PIN });
      expect(await recheck(result.file)).toEqual({
        ends: ["current/current", "current/current"],
        findings: [],
      });
    });
  });

  describe("--marker", () => {
    it("writes the marker above the lines and pins what it anchors, with no claim lines", async () => {
      workspace("no-citations.md");
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "fetch-timeout",
      });
      expect(result.citation.claim).toEqual({ integrity: CLAIM_PIN });
      expect(result.citation.claim?.lines).toBeUndefined();
      expect(result.markerLine).toBe(14);
      expect(result.claimLines).toEqual({ start: 15, end: 15 });
      const lines = result.content.split("\n");
      expect(lines[13]).toBe("<!-- cite fetch-timeout -->");
      expect(lines[14]).toBe(CLAIM);
      expect(await recheck(result.file)).toEqual(CURRENT);
    });

    it("pins the whole paragraph the marker anchors, not just the named line", async () => {
      const label = write("wrapped.md", [
        "---",
        "title: Limits",
        "---",
        "# Limits",
        "",
        "The fetch timeout is 10 seconds. It is",
        "not configurable.",
      ]);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "fetch-timeout",
      });
      expect(result.citation.claim).toEqual({ integrity: WRAPPED_PIN });
      expect(result.claimLines).toEqual({ start: 15, end: 16 });
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("uses the format's own comment syntax", async () => {
      const mdx = write("page.mdx", ["---", "title: t", "---", "", "# Limits", "", CLAIM]);
      const result = await add({
        page: mdx,
        src: "src/limits.ts:2",
        pageLines: { start: 7, end: 7 },
        marker: true,
        id: "fetch-timeout",
      });
      expect(result.content).toContain(`{/* cite fetch-timeout */}\n${CLAIM}`);
      expect(result.content).not.toContain("<!--");
      expect(await recheck(mdx)).toEqual(CURRENT);
    });

    it("anchors the fenced block that follows when it is also a quote", async () => {
      const label = fenced("quoted.md", ["# Limits", ""], [LINE_2], ["", "After."]);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 8 },
        quote: true,
        marker: true,
        id: "timeout",
      });
      expect(result.citation.claim?.lines).toBeUndefined();
      expect(result.citation.quote).toBe(true);
      expect(result.markerLine).toBe(15);
      expect(result.claimLines).toEqual({ start: 16, end: 18 });
      expect(result.content.split("\n")[14]).toBe("<!-- cite timeout -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("refuses without page lines and without an id", async () => {
      workspace("no-citations.md");
      const page = "pages/no-citations.md";
      expect(await refusal(add({ page, src: "src/limits.ts:2", marker: true, id: "x" }))).toBe(
        "--marker needs the page lines to anchor: pages/no-citations.md:L.",
      );
      expect(
        await refusal(
          add({ page, src: "src/limits.ts:2", marker: true, pageLines: { start: 6, end: 6 } }),
        ),
      ).toBe("--marker needs --id: the marker names the entry.");
    });

    it("refuses an id the page already marks, naming the marker's line", async () => {
      workspace("marker-orphan.md");
      expect(
        await refusal(
          add({
            page: "pages/marker-orphan.md",
            src: "src/limits.ts:3",
            pageLines: { start: 13, end: 13 },
            marker: true,
            id: "nope",
          }),
        ),
      ).toBe("pages/marker-orphan.md already has a marker nope at line 12.");
    });

    it("refuses lines with nothing for a marker to anchor", async () => {
      const label = write("blank.md", ["---", "title: Limits", "---", "# Limits", "", "", ""]);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: 6, end: 6 },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(`${label}:6 has no paragraph or block for a marker to anchor.`);
    });
  });

  describe("--quote", () => {
    it("pins a fenced block that reproduces the source", async () => {
      const label = fenced("quoted.md", ["# Limits", ""], LINES_1_3);
      const result = await add({
        page: label,
        src: "src/limits.ts:1-3",
        pageLines: { start: 6, end: 10 },
        quote: true,
      });
      expect(result.citation).toEqual({
        claim: { lines: "3-7", integrity: BLOCK_PIN },
        source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
        quote: true,
      });
      expect(result.claimLines).toEqual({ start: 15, end: 19 });
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("refuses without the block's lines", async () => {
      workspace("no-citations.md");
      expect(
        await refusal(add({ page: "pages/no-citations.md", src: "src/limits.ts:2", quote: true })),
      ).toBe("--quote needs the block's lines: pages/no-citations.md:L1-L2.");
    });

    it("refuses lines that are not a fenced block, opener to closing fence", async () => {
      workspace("no-citations.md");
      expect(
        await refusal(
          add({
            page: "pages/no-citations.md",
            src: "src/limits.ts:2",
            pageLines: { start: 6, end: 6 },
            quote: true,
          }),
        ),
      ).toBe("pages/no-citations.md:6 is not a fenced block, so it cannot be a quote.");
      // The opener is right; the range stops one line short of the closing fence.
      const label = fenced("short.md", ["# Limits", ""], LINES_1_3);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:1-3",
            pageLines: { start: 6, end: 9 },
            quote: true,
          }),
        ),
      ).toBe(`${label}:6-9 is not a fenced block, so it cannot be a quote.`);
    });

    it("refuses on a format with no fenced blocks at all", async () => {
      workspace("marker.rst");
      expect(
        await refusal(
          add({
            page: "pages/marker.rst",
            src: "src/limits.ts:3",
            pageLines: { start: 12, end: 13 },
            quote: true,
          }),
        ),
      ).toBe("pages/marker.rst:12-13 is not a fenced block, so it cannot be a quote.");
    });

    it("refuses a block that reproduces something else", async () => {
      const label = fenced("other.md", ["# Limits", ""], [LINE_3]);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:1-3",
            pageLines: { start: 6, end: 8 },
            quote: true,
          }),
        ),
      ).toBe(`The block at ${label}:6-8 does not reproduce src/limits.ts:1-3.`);
    });
  });

  describe("encryption", () => {
    it("encrypts every add once a key is configured, with no flag, and check reads it back", async () => {
      workspace("no-citations.md");
      const config = tempConfig("", KEY);
      const token = encryptSourcePath("src/limits.ts", KEY);
      const byKey = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        noConfig: false,
        configPath: config,
      });
      expect(byKey.citation.source.file).toBe(token);
      expect(byKey.citation.source.integrity).toBe(hashRange(LINE_2, undefined, KEY));
      expect(byKey.citation.source.integrity.startsWith("hmac-sha256-")).toBe(true);
      // A claim is always pinned plain: the page is public.
      expect(byKey.citation.claim?.integrity).toBe(CLAIM_PIN);
      expect(byKey.content).not.toContain("limits.ts");
      expect(await recheck(byKey.file, config)).toEqual(CURRENT);
      // Without the key the page names no file: the citation is missing.
      expect(await recheck(byKey.file)).toEqual({
        ends: ["current/missing"],
        findings: ["source-missing"],
      });
    });

    it("takes the flag beside a key as redundant, and changes nothing", async () => {
      workspace("no-citations.md");
      const config = tempConfig("", KEY);
      const flagged = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:3",
        encrypt: true,
        noConfig: false,
        configPath: config,
      });
      expect(flagged.citation).toEqual({
        source: {
          file: encryptSourcePath("src/limits.ts", KEY),
          lines: 3,
          integrity: hashRange(LINE_3, undefined, KEY),
        },
      });
    });

    it("writes a plain path with no key and no flag", async () => {
      workspace("no-citations.md");
      const plain = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2" });
      expect(plain.citation.source).toEqual({ file: "src/limits.ts", lines: 2, integrity: PIN_L2 });
    });

    it("the environment's key encrypts as a configured one does", async () => {
      workspace("no-citations.md");
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        env: { MANNI_ENCRYPTION_KEY: KEY },
      });
      expect(result.citation.source.file).toBe(encryptSourcePath("src/limits.ts", KEY));
    });
  });

  describe("--encrypt with no key", () => {
    const REFUSAL =
      "src/limits.ts:2 must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.";
    /** What the prompt helper wrote straight to stderr: its confirmation line. */
    let stderr: string[] = [];
    beforeEach(() => {
      stderr = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === "string" ? chunk : "");
        return true;
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });
    const written = (): string => stderr.join("");
    const configOnDisk = (): string => join(cwd, "manni.config.yaml");

    it("asks once, and on a yes writes a key and encrypts with it", async () => {
      workspace("no-citations.md");
      const questions: string[] = [];
      const notices: string[] = [];
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        encrypt: true,
        confirm: (question) => {
          questions.push(question);
          return Promise.resolve(true);
        },
        onNotice: (message) => notices.push(message),
      });
      expect(notices[0]).toBe(
        "src/limits.ts:2 must be encrypted, and no encryption key is available.",
      );
      expect(questions).toEqual(["Generate a key and write it to manni.config.yaml? "]);
      expect(written()).toContain("Created manni.config.yaml with an encryption key.\n");

      const doc = parseYaml(readFileSync(configOnDisk(), "utf8")) as { encryptionKey?: unknown };
      const key = typeof doc.encryptionKey === "string" ? doc.encryptionKey : "";
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(decryptSourcePath(result.citation.source.file, key)).toBe("src/limits.ts");
      expect(result.citation.source.integrity).toBe(hashRange(LINE_2, undefined, key));
      expect(onDisk(result.file)).not.toContain("limits.ts");
      expect(await recheck(result.file, configOnDisk())).toEqual(CURRENT);
    });

    it("writes the key into the config the run found, beside its cite: section", async () => {
      workspace("no-citations.md");
      const config = tempConfig("allowEmpty: true");
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        encrypt: true,
        noConfig: false,
        configPath: config,
        confirm: () => Promise.resolve(true),
      });
      const text = readFileSync(config, "utf8");
      expect(text).toMatch(/^cite:\n {2}allowEmpty: true\n/);
      expect(text).toMatch(/^encryptionKey: [0-9a-f]{64}$/m);
      expect(written()).toContain("Encryption key written to ");
      expect(await recheck(result.file, config)).toEqual({
        ends: ["none/current"],
        findings: [],
      });
    });

    it("on a no, refuses and writes nothing", async () => {
      workspace("no-citations.md");
      const before = onDisk("pages/no-citations.md");
      const message = await refusal(
        add({
          page: "pages/no-citations.md",
          src: "src/limits.ts:2",
          encrypt: true,
          confirm: () => Promise.resolve(false),
        }),
      );
      expect(message).toBe(REFUSAL);
      expect(onDisk("pages/no-citations.md")).toBe(before);
      expect(existsSync(configOnDisk())).toBe(false);
    });

    it("with no way to ask, refuses without a question or a notice", async () => {
      workspace("no-citations.md");
      const notices: string[] = [];
      const message = await refusal(
        add({
          page: "pages/no-citations.md",
          src: "src/limits.ts:2",
          encrypt: true,
          onNotice: (m) => notices.push(m),
        }),
      );
      expect(message).toBe(REFUSAL);
      expect(notices).toEqual([]);
      expect(existsSync(configOnDisk())).toBe(false);
    });

    it("refuses what needs no key before asking for one", async () => {
      workspace("no-citations.md");
      let asked = 0;
      const confirm = (): Promise<boolean> => {
        asked += 1;
        return Promise.resolve(true);
      };
      expect(
        await refusal(
          add({ page: "pages/no-citations.md", src: "src/nope.ts:1", encrypt: true, confirm }),
        ),
      ).toBe("Source not found: src/nope.ts is not a tracked file under the root.");
      expect(
        await refusal(
          add({
            page: "pages/no-citations.md",
            src: "src/limits.ts:2",
            pageLines: { start: 40, end: 40 },
            encrypt: true,
            confirm,
          }),
        ),
      ).toBe("pages/no-citations.md:40 is past the end of the page (6 lines).");
      expect(asked).toBe(0);
      expect(existsSync(configOnDisk())).toBe(false);
    });
  });

  describe("commit-sha", () => {
    it.skipIf(!gitAvailable())("records HEAD unless told not to", async () => {
      workspace("no-citations.md");
      const withHead = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        commitSha: undefined,
      });
      expect(withHead.citation.source["commit-sha"]).toMatch(/^[0-9a-f]{40}$/);
      expect(Object.keys(withHead.citation.source)).toEqual([
        "file",
        "lines",
        "integrity",
        "commit-sha",
      ]);
    });

    it("records none under --no-commit-sha", async () => {
      workspace("no-citations.md");
      const without = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:3",
        commitSha: false,
      });
      expect(without.citation.source["commit-sha"]).toBeUndefined();
      expect(without.content).not.toContain("commit-sha");
    });

    it("without git, records no commit and says so once", async () => {
      workspace("no-citations.md");
      const notices: string[] = [];
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        commitSha: undefined,
        gitClient: noGit(),
        onNotice: (m) => notices.push(m),
      });
      expect(result.citation.source["commit-sha"]).toBeUndefined();
      expect(notices).toEqual([NO_COMMIT]);
    });

    it("says nothing about git when no commit was wanted, or git is there", async () => {
      workspace("no-citations.md");
      const notices: string[] = [];
      const onNotice = (m: string): void => {
        notices.push(m);
      };
      await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        commitSha: false,
        gitClient: noGit(),
        onNotice,
      });
      expect(notices).toEqual([]);
      const there = {
        ...noGit(),
        available: () => Promise.resolve(true),
        lsFiles: () => Promise.resolve(["src/limits.ts"]),
      };
      await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:3",
        commitSha: undefined,
        gitClient: there,
        onNotice,
      });
      expect(notices).toEqual([]);
    });
  });

  describe("outputs", () => {
    it("prints the diff and writes nothing under --dry-run", async () => {
      workspace("no-citations.md");
      const before = onDisk("pages/no-citations.md");
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        dryRun: true,
      });
      expect(result.written).toBe(false);
      expect(result.diff).toContain("+citations:");
      expect(result.content).not.toBe(before);
      expect(onDisk("pages/no-citations.md")).toBe(before);
    });

    it("returns the rewritten page for stdin instead of writing it", async () => {
      workspace();
      const result = await add({
        page: "-",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        as: "markdown",
        stdinContent: readFileSync(join(PAGES, "no-citations.md"), "utf8"),
      });
      expect(result.file).toBe("<stdin>");
      expect(result.written).toBe(false);
      expect(result.content).toContain("citations:");
      expect(result.citation.claim).toEqual({ lines: 3, integrity: CLAIM_PIN });
      expect(result.claimLines).toEqual({ start: 14, end: 14 });
      expect(result.diff.split("\n")[0]).toBe("--- <stdin>");
    });
  });

  describe("refusals", () => {
    it("names the bad range, the short file, and the untracked source", async () => {
      workspace("no-citations.md");
      const page = "pages/no-citations.md";
      expect(await refusal(add({ page, src: "src/limits.ts:9-3" }))).toBe(
        'Invalid range "src/limits.ts:9-3": end line 3 is before start line 9.',
      );
      expect(await refusal(add({ page, src: "src/limits.ts:99" }))).toBe(
        "src/limits.ts has 7 lines; line 99 is out of range.",
      );
      expect(await refusal(add({ page, src: "src/gone.ts" }))).toBe(
        "Source not found: src/gone.ts is not a tracked file under the root.",
      );
    });

    it("refuses page lines past the end of the page", async () => {
      workspace("no-citations.md");
      expect(
        await refusal(
          add({
            page: "pages/no-citations.md",
            src: "src/limits.ts:2",
            pageLines: { start: 40, end: 40 },
          }),
        ),
      ).toBe("pages/no-citations.md:40 is past the end of the page (6 lines).");
    });

    it("refuses page lines that sit in the frontmatter", async () => {
      workspace("claim-range.md");
      expect(
        await refusal(
          add({
            page: "pages/claim-range.md",
            src: "src/limits.ts:2",
            pageLines: { start: 2, end: 2 },
          }),
        ),
      ).toBe("pages/claim-range.md:2 is in the frontmatter. A claim is body text.");
    });

    it("refuses an id the page already cites", async () => {
      workspace("current.md");
      expect(
        await refusal(
          add({
            page: "pages/current.md",
            src: "src/limits.ts:2",
            pageLines: { start: 17, end: 17 },
            id: "fetch-timeout",
          }),
        ),
      ).toBe("pages/current.md already has an entry fetch-timeout.");
    });

    it("refuses a page that has no frontmatter to write to", async () => {
      workspace("marker.html");
      expect(await refusal(add({ page: "pages/marker.html", src: "src/limits.ts:3" }))).toBe(
        "pages/marker.html has no frontmatter to write to; keep its citations in a manifest instead.",
      );
    });

    it("refuses stdin without --as, and a page that is not there", async () => {
      workspace();
      expect(await refusal(add({ page: "-", src: "src/limits.ts:2", stdinContent: "x" }))).toBe(
        "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      );
      expect(await refusal(add({ page: "pages/nope.md", src: "src/limits.ts:2" }))).toBe(
        'File not found: "pages/nope.md".',
      );
    });

    it("refuses an id that is not kebab-case", async () => {
      workspace("no-citations.md");
      expect(
        await refusal(
          add({ page: "pages/no-citations.md", src: "src/limits.ts:2", id: "Fetch Timeout" }),
        ),
      ).toBe(
        'Invalid id "Fetch Timeout": use lowercase letters, digits and hyphens, starting with a letter or digit.',
      );
    });
  });
});
