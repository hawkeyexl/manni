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
import { addMessage } from "../../src/cite/cli.js";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import { shortPin, shortSrc } from "../../src/cite/core/spell.js";
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
      // Another source than the entry already there: the same lines on the
      // same source would be a duplicate, and refused.
      const result = await add({
        page: "pages/claim-range.md",
        src: "src/limits.ts:3",
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

    /** `count` numbered lines of prose, one paragraph with no blank line inside. */
    const prose = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => `Line ${String(i + 1)} of a long paragraph.`);

    it("refuses a paragraph longer than 5,000 lines, and writes nothing", async () => {
      // Lines 4-5 are the heading and a blank, so the paragraph is 6-5006.
      const label = write("long.md", ["---", "title: Limits", "---", "# Limits", "", ...prose(5001)]);
      const before = onDisk(label);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: 9, end: 9 },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(
        `${label}:9 is in a paragraph at lines 6-5006 that spans 5001 lines, more than 5000. A marker anchors the whole paragraph.`,
      );
      expect(onDisk(label)).toBe(before);
    });

    it("anchors a paragraph of exactly 5,000 lines", async () => {
      const label = write("limit.md", ["---", "title: Limits", "---", "# Limits", "", ...prose(5000)]);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 9, end: 9 },
        marker: true,
        id: "x",
      });
      expect(result.written).toBe(true);
      expect(result.markerLine).toBeDefined();
      const span = result.claimLines;
      expect(span === undefined ? 0 : span.end - span.start + 1).toBe(5000);
    });

    it("refuses a fenced block longer than 5,000 lines, naming it a block", async () => {
      // The fences are lines 6 and 5007, so the block is 5002 lines with them.
      const label = fenced("long-block.md", ["# Limits", ""], prose(5000));
      const before = onDisk(label);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: 7, end: 7 },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(
        `${label}:7 is in a block at lines 6-5007 that spans 5002 lines, more than 5000. A marker anchors the whole block.`,
      );
      expect(onDisk(label)).toBe(before);
    });
  });

  describe("--marker placement", () => {
    /** Two paragraphs: a wrapped one at lines 6-7 and one line at 9. */
    const twoParagraphs = (name: string): string =>
      write(name, [
        "---",
        "title: Limits",
        "---",
        "# Limits",
        "",
        "The fetch timeout is 10 seconds. It is",
        "not configurable.",
        "",
        "Retries default to 3.",
      ]);
    const WRAPPED = "The fetch timeout is 10 seconds. It is";
    /** The 1-based line of the first line of a page that reads `text`. */
    const lineOf = (label: string, text: string): number =>
      onDisk(label).split("\n").indexOf(text) + 1;
    const both = { ends: ["current/current", "current/current"], findings: [] };

    it("joins the second id into the marker already there, on one line", async () => {
      const label = twoParagraphs("stacked.md");
      const first = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "first",
      });
      const at = lineOf(label, WRAPPED);
      const second = await add({
        page: label,
        src: "src/limits.ts:3",
        pageLines: { start: at, end: at },
        marker: true,
        id: "second",
      });
      const text = lineOf(label, WRAPPED);
      expect(onDisk(label).split("\n").slice(text - 2, text)).toEqual([
        "<!-- cite first second -->",
        WRAPPED,
      ]);
      expect(second.markerJoined).toBe(true);
      expect(second.markerLine).toBe(text - 1);
      expect(first.citation.claim).toEqual({ integrity: WRAPPED_PIN });
      expect(await recheck(label)).toEqual(both);
    });

    it("adds no line to the body, so the paragraph keeps its place in it", async () => {
      const label = twoParagraphs("stable.md");
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "first",
      });
      // Body lines, counted from the heading, so the frontmatter the entry
      // grows is out of the picture. Only a marker line would move these.
      const bodyOf = (): string[] => {
        const lines = onDisk(label).split("\n");
        return lines.slice(lines.indexOf("# Limits"));
      };
      const before = bodyOf();
      for (const id of ["second", "third"]) {
        const at = lineOf(label, WRAPPED);
        await add({
          page: label,
          src: "src/limits.ts:3",
          pageLines: { start: at, end: at },
          marker: true,
          id,
        });
        expect(bodyOf().length).toBe(before.length);
      }
      expect(onDisk(label)).toContain(`<!-- cite first second third -->\n${WRAPPED}`);
      expect(await recheck(label)).toEqual({
        ends: ["current/current", "current/current", "current/current"],
        findings: [],
      });
    });

    it("leaves a one-id marker on another paragraph exactly as it was", async () => {
      const label = twoParagraphs("elsewhere.md");
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "first",
      });
      const at = lineOf(label, "Retries default to 3.");
      const result = await add({
        page: label,
        src: "src/limits.ts:3",
        pageLines: { start: at, end: at },
        marker: true,
        id: "second",
      });
      // The other paragraph gets its own marker; the first is untouched.
      expect(result.markerJoined).toBeUndefined();
      expect(onDisk(label)).toContain(`<!-- cite first -->\n${WRAPPED}`);
      expect(onDisk(label)).toContain("<!-- cite second -->\nRetries default to 3.");
      expect(await recheck(label)).toEqual(both);
    });

    it("joins an mdx marker the same way", async () => {
      const label = write("stacked.mdx", ["---", "title: t", "---", "", "# Limits", "", CLAIM]);
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 7, end: 7 },
        marker: true,
        id: "first",
      });
      const at = lineOf(label, CLAIM);
      await add({
        page: label,
        src: "src/limits.ts:3",
        pageLines: { start: at, end: at },
        marker: true,
        id: "second",
      });
      expect(onDisk(label)).toContain(`{/* cite first second */}\n${CLAIM}`);
      expect(await recheck(label)).toEqual(both);
    });

    it("joins a marker above a quoted block, where every id is a quote", async () => {
      const label = fenced("stacked-quote.md", ["# Limits", ""], [LINE_2], ["", "After."]);
      const first = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 8 },
        quote: true,
        marker: true,
        id: "first",
      });
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: first.claimLines ?? { start: 0, end: 0 },
        quote: true,
        marker: true,
        id: "second",
      });
      expect(onDisk(label)).toContain(`<!-- cite first second -->\n${OPEN}`);
      expect(await recheck(label)).toEqual(both);
    });

    it("reports the join, and the claim lines that did not move", async () => {
      const label = twoParagraphs("three.md");
      const at = lineOf(label, "not configurable.");
      const first = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: at, end: at },
        marker: true,
        id: "first",
      });
      const text = lineOf(label, WRAPPED);
      expect(addMessage(first)).toBe(
        `${label}: added first to frontmatter; marker at line ${String(text - 1)}, claim pinned at lines ${String(text)}-${String(text + 1)} (sha256-93f59d1e…; source src/limits.ts:2 "${LINE_2}", sha256-78af1d33…, no commit)`,
      );
      for (const id of ["second", "third"]) {
        const line = lineOf(label, "not configurable.");
        const result = await add({
          page: label,
          src: "src/limits.ts:2",
          pageLines: { start: line, end: line },
          marker: true,
          id,
        });
        const now = lineOf(label, WRAPPED);
        expect(result.markerJoined).toBe(true);
        expect(result.claimLines).toEqual({ start: now, end: now + 1 });
        expect(addMessage(result)).toBe(
          `${label}: added ${id} to frontmatter; joined the marker at line ${String(now - 1)}, claim pinned at lines ${String(now)}-${String(now + 1)} (sha256-93f59d1e…; source src/limits.ts:2 "${LINE_2}", sha256-78af1d33…, no commit)`,
        );
      }
      expect(onDisk(label)).toContain(`<!-- cite first second third -->\n${WRAPPED}`);
    });

    it("writes a new line rather than joining a marker whose delimiters span lines", async () => {
      // A marker can open on one line and close on another, and it parses.
      // Joining it would fold it onto one line, which changes the line count
      // and moves every claim below it, so `add` leaves it alone.
      const label = write("wrapped.md", [
        "---",
        "title: Limits",
        "---",
        "# Limits",
        "",
        "<!-- cite",
        "  first",
        "-->",
        "The fetch timeout is 10 seconds.",
      ]);
      const at = lineOf(label, "The fetch timeout is 10 seconds.");
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: at, end: at },
        marker: true,
        id: "second",
      });
      expect(result.markerJoined).toBeUndefined();
      const after = onDisk(label);
      // The wrapped marker is left exactly as it was, still spanning its
      // three lines, and the new id got a marker of its own.
      expect(after).toContain("<!-- cite\n  first\n-->");
      expect(after).toContain("<!-- cite second -->");
      expect(after).not.toContain("cite first second");
    });

    it("writes a new marker line when the nearest one already holds 25 ids", async () => {
      const label = twoParagraphs("full.md");
      const held = Array.from({ length: 25 }, (_v, n) => `id-${String(n)}`);
      // The marker is put there by hand: minting 25 entries would say nothing
      // about the case, which is the line budget rather than the entries.
      const before = onDisk(label).split("\n");
      before.splice(5, 0, `<!-- cite ${held.join(" ")} -->`);
      writeFileSync(join(cwd, label), before.join("\n"));
      const at = lineOf(label, WRAPPED);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: at, end: at },
        marker: true,
        id: "twenty-sixth",
      });
      expect(result.markerJoined).toBeUndefined();
      const after = onDisk(label).split("\n");
      const text = lineOf(label, WRAPPED);
      expect(after[text - 2]).toBe("<!-- cite twenty-sixth -->");
      expect(after[text - 3]).toBe(`<!-- cite ${held.join(" ")} -->`);
      expect(addMessage(result)).toContain(`; marker at line ${String(text - 1)},`);
    });

    it("refuses a marker line, because a marker there would change its pin", async () => {
      const label = twoParagraphs("on-marker.md");
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "first",
      });
      const at = lineOf(label, WRAPPED) - 1;
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:3",
            pageLines: { start: at, end: at },
            marker: true,
            id: "second",
          }),
        ),
      ).toBe(`${label}:${String(at)} is a marker line. A marker there would change its pin.`);
    });

    it("puts the marker above the paragraph when the lines start inside it", async () => {
      const label = twoParagraphs("inside.md");
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 7, end: 7 },
        marker: true,
        id: "fetch-timeout",
      });
      expect(result.markerLine).toBe(14);
      expect(result.claimLines).toEqual({ start: 15, end: 16 });
      const lines = result.content.split("\n");
      expect(lines[13]).toBe("<!-- cite fetch-timeout -->");
      expect(lines[14]).toBe(WRAPPED);
      expect(addMessage(result)).toBe(
        `${label}: added fetch-timeout to frontmatter; marker at line 14, claim pinned at lines 15-16 (sha256-93f59d1e…; source src/limits.ts:2 "${LINE_2}", sha256-78af1d33…, no commit)`,
      );
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("spells an encrypted source as its ciphertext, never as a path", async () => {
      workspace("no-citations.md");
      const config = tempConfig("", KEY);
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        marker: true,
        id: "timeouts",
        noConfig: false,
        configPath: config,
      });
      const token = encryptSourcePath("src/limits.ts", KEY);
      const message = addMessage(result);
      expect(message).toBe(
        `pages/no-citations.md: added timeouts to frontmatter; marker at line 14, claim pinned at line 15 (${shortPin(CLAIM_PIN)}; source ${shortSrc(`${token}:2`)}, ${shortPin(hashRange(LINE_2, undefined, KEY))}, no commit)`,
      );
      expect(message).not.toContain("limits.ts");
    });

    it("says a marker over a quoted block reproduces its source", async () => {
      const label = fenced("marker-quote.md", ["# Limits", ""], [LINE_2], ["", "After."]);
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 8 },
        quote: true,
        marker: true,
        id: "block",
      });
      const lines = `${String(result.claimLines?.start ?? 0)}-${String(result.claimLines?.end ?? 0)}`;
      expect(addMessage(result)).toBe(
        `${label}: added block to frontmatter; marker at line ${String(result.markerLine ?? 0)}, claim pinned at lines ${lines} (a block that reproduces src/limits.ts:2)`,
      );
    });

    it("refuses lines that run past the paragraph, and writes nothing", async () => {
      const label = twoParagraphs("past.md");
      const before = onDisk(label);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: 7, end: 9 },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(`${label}:7-9 runs past the paragraph at lines 6-7. A marker anchors one paragraph.`);
      expect(onDisk(label)).toBe(before);
    });

    it("refuses lines that run past a fenced block, naming the block", async () => {
      const label = fenced("past-block.md", ["# Limits", ""], [LINE_2], ["", "After."]);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: 6, end: 10 },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(`${label}:6-10 runs past the block at lines 6-8. A marker anchors one paragraph.`);
    });

    it("moves the claim lines of every entry below the marker, in the same write", async () => {
      const label = twoParagraphs("shift.md");
      await add({ page: label, src: "src/limits.ts:2", pageLines: { start: 4, end: 4 }, id: "heading" });
      const row = lineOf(label, "Retries default to 3.");
      await add({ page: label, src: "src/limits.ts:3", pageLines: { start: row, end: row }, id: "row" });
      const para = lineOf(label, WRAPPED);
      const claimLines = (): unknown[] => {
        const doc = parseYaml(onDisk(label).split("---\n")[1] ?? "") as {
          citations: { claim: { lines?: unknown } }[];
        };
        return doc.citations.map((c) => c.claim.lines);
      };
      expect(claimLines()).toEqual([1, 6]);
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: para, end: para },
        marker: true,
        id: "para",
      });
      expect(claimLines()).toEqual([1, 7, undefined]);
      expect(await recheck(label)).toEqual({
        ends: ["current/current", "current/current", "current/current"],
        findings: [],
      });
    });

    it("refuses a marker inside another entry's claim, and writes nothing", async () => {
      const label = twoParagraphs("inside-claim.md");
      const held = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 4, end: 7 },
        id: "fetch-timeout",
      });
      const span = held.claimLines ?? { start: 0, end: 0 };
      const para = lineOf(label, WRAPPED);
      const before = onDisk(label);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: para, end: para },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(
        `${label}:${String(para)} is inside the claim of fetch-timeout (lines ${String(span.start)}-${String(span.end)}). A marker there would change its pin.`,
      );
      expect(onDisk(label)).toBe(before);
    });

    it("names an entry with no id by its lines", async () => {
      const label = twoParagraphs("inside-anon.md");
      const held = await add({ page: label, src: "src/limits.ts:2", pageLines: { start: 5, end: 6 } });
      const span = held.claimLines ?? { start: 0, end: 0 };
      const para = lineOf(label, WRAPPED);
      expect(
        await refusal(
          add({
            page: label,
            src: "src/limits.ts:2",
            pageLines: { start: para, end: para },
            marker: true,
            id: "x",
          }),
        ),
      ).toBe(
        `${label}:${String(para)} is inside the claim at lines ${String(span.start)}-${String(span.end)}. A marker there would change its pin.`,
      );
    });
  });

  describe("--marker indentation", () => {
    /** A page with a title and the given body lines. */
    const page = (name: string, body: string[]): string =>
      write(name, ["---", "title: Steps", "---", ...body]);
    /** The 1-based line of the first line of a page that reads `text`. */
    const lineOf = (label: string, text: string): number =>
      onDisk(label).split("\n").indexOf(text) + 1;
    /** Add a marker for the line reading `text`, and return the page's lines after. */
    async function mark(label: string, text: string, id: string): Promise<string[]> {
      const at = lineOf(label, text);
      expect(at).toBeGreaterThan(0);
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: at, end: at },
        marker: true,
        id,
      });
      return onDisk(label).split("\n");
    }
    /** The line above the one reading `text`. */
    const above = (lines: string[], text: string): string | undefined =>
      lines[lines.indexOf(text) - 1];
    const STEP = "   Paragraph belonging to step 1,";
    const steps = (open: string, close: string): string[] => [
      "# Steps",
      "",
      open,
      "",
      "1. First step.",
      "",
      STEP,
      "   wrapped.",
      "",
      "2. Second step.",
      "",
      close,
    ];

    it("indents an mdx marker to the paragraph in a list item", async () => {
      const label = page("steps.mdx", steps("<Steps>", "</Steps>"));
      const lines = await mark(label, "   wrapped.", "step-one");
      expect(above(lines, STEP)).toBe("   {/* cite step-one */}");
      expect(above(lines, "   {/* cite step-one */}")).toBe("");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("indents a markdown marker the same way", async () => {
      const label = page("steps.md", steps("<ol>", "</ol>"));
      const lines = await mark(label, STEP, "step-one");
      expect(above(lines, STEP)).toBe("   <!-- cite step-one -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("copies tabs as they are", async () => {
      const label = page("tabbed.md", ["- First.", "", "\tIndented with a tab.", "", "- Second."]);
      const lines = await mark(label, "\tIndented with a tab.", "tabbed");
      expect(above(lines, "\tIndented with a tab.")).toBe("\t<!-- cite tabbed -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("joins an indented marker, keeping its indentation", async () => {
      const label = page("stacked-steps.mdx", steps("<Steps>", "</Steps>"));
      await mark(label, STEP, "first");
      const lines = await mark(label, STEP, "second");
      const at = lines.indexOf(STEP);
      expect(lines.slice(at - 2, at + 1)).toEqual([
        "",
        "   {/* cite first second */}",
        STEP,
      ]);
      expect(await recheck(label)).toEqual({
        ends: ["current/current", "current/current"],
        findings: [],
      });
    });

    it("indents a marker above a later list item to the item's text, inside the list", async () => {
      const label = page("later-item.mdx", ["1. First step.", "", "2. Second step."]);
      const lines = await mark(label, "2. Second step.", "second");
      expect(above(lines, "2. Second step.")).toBe("   {/* cite second */}");
      expect(above(lines, "   {/* cite second */}")).toBe("");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("uses the item's own marker width and its tabs for a later item", async () => {
      const label = page("later-bullet.md", ["- a", "", "-\tb", "", "10. c", "", "11. d"]);
      const b = await mark(label, "-\tb", "b");
      expect(above(b, "-\tb")).toBe(" \t<!-- cite b -->");
      const d = await mark(label, "11. d", "d");
      expect(above(d, "11. d")).toBe("    <!-- cite d -->");
      expect(await recheck(label)).toEqual({
        ends: ["current/current", "current/current"],
        findings: [],
      });
    });

    it("keeps a later item in a nested list inside its list", async () => {
      const label = page("nested.md", ["1. Step", "", "   - a", "", "   - b"]);
      const lines = await mark(label, "   - b", "nested");
      expect(above(lines, "   - b")).toBe("     <!-- cite nested -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("treats an item after a lazy continuation line as a later item", async () => {
      const label = page("lazy.md", ["1. First step,", "continued lazily.", "", "2. Second step."]);
      const lines = await mark(label, "2. Second step.", "lazy");
      expect(above(lines, "2. Second step.")).toBe("   <!-- cite lazy -->");
    });

    it("puts the marker before a list at the first item's indentation", async () => {
      const label = page("list-start.md", ["Intro.", "", "10. a", "11. b"]);
      const lines = await mark(label, "11. b", "list");
      expect(above(lines, "10. a")).toBe("<!-- cite list -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("puts the marker before a nested list at that list's indentation", async () => {
      const label = page("nested-start.mdx", ["1. Step", "", "   - a", "   - b"]);
      const lines = await mark(label, "   - b", "nested");
      expect(above(lines, "   - a")).toBe("   {/* cite nested */}");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("anchors a blockquote as one paragraph, with the marker above it", async () => {
      const label = page("quote.md", ["Intro.", "", "> One.", ">", "> Two."]);
      const lines = await mark(label, "> Two.", "quoted");
      expect(above(lines, "> One.")).toBe("<!-- cite quoted -->");
      expect(await recheck(label)).toEqual(CURRENT);
    });

    it("writes an asciidoc marker at column 0, where a comment has to start", async () => {
      const label = page("literal.adoc", ["= Limits", "", "  An indented literal paragraph."]);
      const lines = await mark(label, "  An indented literal paragraph.", "literal");
      expect(above(lines, "  An indented literal paragraph.")).toBe("// (cite literal)");
      expect(await recheck(label)).toEqual(CURRENT);
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

  describe("the claim's text elsewhere on the page", () => {
    /** A page whose one sentence is repeated `copies` times, two lines apart. */
    function repeated(name: string, copies: number): string {
      const body: string[] = [];
      for (let i = 0; i < copies; i++) body.push("", CLAIM);
      return write(name, ["---", "title: Limits", "---", "# Limits", ...body]);
    }

    it("warns, names the other copy, and still writes the entry", async () => {
      const label = repeated("twice.md", 2);
      const notices: string[] = [];
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        id: "fetch-timeout",
        onNotice: (m) => notices.push(m),
      });
      expect(result.written).toBe(true);
      expect(notices).toEqual([
        "fetch-timeout: the claim's text also appears at line 17, so a move would be ambiguous. Use --marker, or pin more lines.",
      ]);
    });

    it("drops the id prefix when the entry has none", async () => {
      const label = repeated("unnamed-twice.md", 2);
      const notices: string[] = [];
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        onNotice: (m) => notices.push(m),
      });
      expect(notices).toEqual([
        "the claim's text also appears at line 16, so a move would be ambiguous. Use --marker, or pin more lines.",
      ]);
    });

    it("names three copies and counts the rest", async () => {
      const label = repeated("many.md", 6);
      const notices: string[] = [];
      await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        onNotice: (m) => notices.push(m),
      });
      expect(notices).toEqual([
        "the claim's text also appears at lines 16, 18, 20 and 2 more, so a move would be ambiguous. Use --marker, or pin more lines.",
      ]);
    });

    it("spells a repeated two-line claim as the range it is", async () => {
      const wrapped = ["The fetch timeout is 10 seconds. It is", "not configurable."];
      const label = write("wrapped-twice.md", [
        "---",
        "title: Limits",
        "---",
        "# Limits",
        "",
        ...wrapped,
        "",
        ...wrapped,
      ]);
      const notices: string[] = [];
      const result = await add({
        page: label,
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 7 },
        onNotice: (m) => notices.push(m),
      });
      expect(result.citation.claim?.lines).toBe("3-4");
      expect(notices).toEqual([
        "the claim's text also appears at lines 17-18, so a move would be ambiguous. Use --marker, or pin more lines.",
      ]);
    });

    it("says nothing when the claim's text appears once", async () => {
      workspace("no-citations.md");
      const notices: string[] = [];
      await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        onNotice: (m) => notices.push(m),
      });
      expect(notices).toEqual([]);
    });
  });

  describe("the pinned source line in the report", () => {
    it("quotes the first pinned line beside the source", async () => {
      workspace("no-citations.md");
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        id: "fetch-timeout",
      });
      expect(result.sourceLine).toBe(LINE_2);
      expect(addMessage(result)).toBe(
        `pages/no-citations.md: added fetch-timeout to frontmatter (claim at line 15, sha256-921b21cc…; source src/limits.ts:2 "${LINE_2}", sha256-78af1d33…, no commit)`,
      );
    });

    it("collapses the line's whitespace and trims a long one to sixty characters", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:6" });
      expect(result.sourceLine).toBe("  return { MAX_FILES, FETCH_TIMEOUT_MS, RETRIES };");
      expect(addMessage(result)).toContain(
        'source src/limits.ts:6 "return { MAX_FILES, FETCH_TIMEOUT_MS, RETRIES };",',
      );
      const long = `  ${"x".repeat(80)}`;
      expect(addMessage({ ...result, sourceLine: long })).toContain(`"${"x".repeat(60)}…"`);
    });

    it("quotes no line for a blank source line, as a whole-file pin does", async () => {
      // src/limits.ts:4 is the blank line between the constants and the
      // function. It collapses to nothing, so the report shows no quote.
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:4" });
      expect(result.sourceLine).toBe("");
      expect(addMessage(result)).toBe(
        "pages/no-citations.md: added a bare pin to frontmatter (source src/limits.ts:4, sha256-e3b0c442…, no commit)",
      );
    });

    it("names no line for a whole-file bare pin", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts" });
      expect(result.sourceLine).toBeUndefined();
      expect(addMessage(result)).toBe(
        "pages/no-citations.md: added a bare pin to frontmatter (source src/limits.ts, sha256-aebba92f…, no commit)",
      );
    });

    it("names no line for an encrypted source", async () => {
      workspace("no-citations.md");
      const config = tempConfig("", KEY);
      const result = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        noConfig: false,
        configPath: config,
      });
      expect(result.sourceLine).toBeUndefined();
      expect(addMessage(result)).not.toContain(LINE_2);
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

    it("refuses a source or page range longer than 5,000 lines, and not one of 5,000", async () => {
      workspace("no-citations.md");
      const page = "pages/no-citations.md";
      expect(await refusal(add({ page, src: "src/limits.ts:2-5002" }))).toBe(
        'Invalid range "src/limits.ts:2-5002": it spans 5001 lines, more than 5000.',
      );
      expect(await refusal(add({ page, src: "src/limits.ts:1-5000" }))).toBe(
        "src/limits.ts has 7 lines; line 5000 is out of range.",
      );
      expect(
        await refusal(add({ page, src: "src/limits.ts:2", pageLines: { start: 1, end: 5001 } })),
      ).toBe('Invalid range "pages/no-citations.md:1-5001": it spans 5001 lines, more than 5000.');
      expect(
        await refusal(add({ page, src: "src/limits.ts:2", pageLines: { start: 1, end: 5000 } })),
      ).toBe("pages/no-citations.md:1-5000 is past the end of the page (6 lines).");
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

    it("refuses an entry the page already has for these lines and this source", async () => {
      workspace("current.md");
      const before = onDisk("pages/current.md");
      expect(
        await refusal(
          add({
            page: "pages/current.md",
            src: "src/limits.ts:2",
            pageLines: { start: 15, end: 15 },
          }),
        ),
      ).toBe(
        "pages/current.md already has an entry for line 15 and src/limits.ts:2 (fetch-timeout).",
      );
      expect(onDisk("pages/current.md")).toBe(before);
    });

    it("names an entry with no id by its pointer, and a range by its range", async () => {
      const label = write("unnamed.md", [
        "---",
        "title: Limits",
        "citations:",
        "  - claim:",
        `      lines: "3-4"`,
        `      integrity: ${WRAPPED_PIN}`,
        "    source:",
        "      file: src/limits.ts",
        "      lines: 2",
        `      integrity: ${PIN_L2}`,
        "---",
        "# Limits",
        "",
        "The fetch timeout is 10 seconds. It is",
        "not configurable.",
      ]);
      expect(
        await refusal(
          add({ page: label, src: "src/limits.ts:2", pageLines: { start: 14, end: 15 } }),
        ),
      ).toBe(`${label} already has an entry for lines 14-15 and src/limits.ts:2 (/citations/0).`);
    });

    it("refuses a second bare pin over the same source", async () => {
      workspace("whole-file.md");
      expect(await refusal(add({ page: "pages/whole-file.md", src: "src/limits.ts" }))).toBe(
        "pages/whole-file.md already has a bare pin for src/limits.ts (/citations/0).",
      );
    });

    it("does not refuse a duplicate when the existing entry is encrypted, because the plain path never matches a ciphertext", async () => {
      // The boundary `duplicateOf` in src/cite/commands/add.ts comments on:
      // the caller's `src` is a plain path, an encrypted entry spells its
      // source as a ciphertext, and the check compares the two as written.
      workspace("no-citations.md");
      const config = tempConfig("", KEY);
      const keyed = { noConfig: false, configPath: config } as const;
      const first = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
        ...keyed,
      });
      // The entry pushed the claim down, so this names the same sentence and
      // stores the same body line: an exact duplicate but for the ciphertext.
      const second = await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 14, end: 14 },
        ...keyed,
      });
      expect(second.written).toBe(true);
      const entries = readPage(second.file, second.content).citations;
      expect(entries).toHaveLength(2);
      expect(entries.map((c) => c.citation.claim?.lines)).toEqual([3, 3]);
      for (const { citation } of entries) {
        expect(decryptSourcePath(citation.source.file, KEY)).toBe("src/limits.ts");
        expect(citation.source.integrity.startsWith("hmac-sha256-")).toBe(true);
      }
      // And the same sequence with no key in sight is refused, so this case
      // goes red the day the comparison starts decrypting.
      workspace("no-citations.md");
      await add({
        page: "pages/no-citations.md",
        src: "src/limits.ts:2",
        pageLines: { start: 6, end: 6 },
      });
      expect(
        await refusal(
          add({
            page: "pages/no-citations.md",
            src: "src/limits.ts:2",
            pageLines: { start: 14, end: 14 },
          }),
        ),
      ).toBe(
        "pages/no-citations.md already has an entry for line 14 and src/limits.ts:2 (/citations/0).",
      );
      // The two entries spell their source identically, because encrypting a
      // path under a key is deterministic. So the miss is about which string
      // the check compares, not about the ciphertexts differing.
      expect(second.citation.source.file).toBe(first.citation.source.file);
      expect(first.citation.source.file).toBe(encryptSourcePath("src/limits.ts", KEY));
    });

    it("allows a second entry for the same lines when the source differs", async () => {
      workspace("current.md");
      const result = await add({
        page: "pages/current.md",
        src: "src/limits.ts:3",
        pageLines: { start: 15, end: 15 },
      });
      expect(result.written).toBe(true);
    });

    it("refuses a claim that is one blank line, or one fence line", async () => {
      workspace("no-citations.md");
      expect(
        await refusal(
          add({
            page: "pages/no-citations.md",
            src: "src/limits.ts:2",
            pageLines: { start: 5, end: 5 },
          }),
        ),
      ).toBe("pages/no-citations.md:5 is blank.");
      const label = fenced("fence.md", ["# Limits", ""], LINES_1_3);
      expect(
        await refusal(add({ page: label, src: "src/limits.ts:1", pageLines: { start: 6, end: 6 } })),
      ).toBe(`${label}:6 is a fence line, not claim text.`);
      expect(
        await refusal(
          add({ page: label, src: "src/limits.ts:1", pageLines: { start: 10, end: 10 } }),
        ),
      ).toBe(`${label}:10 is a fence line, not claim text.`);
    });

    it("refuses a range of nothing but blank and fence lines", async () => {
      const label = fenced("empty-range.md", ["# Limits", ""], LINES_1_3);
      expect(
        await refusal(
          add({ page: label, src: "src/limits.ts:1", pageLines: { start: 5, end: 6 } }),
        ),
      ).toBe(`${label}:5-6 holds no claim text.`);
    });

    it("takes the same fence lines as a quote, because a quote is fences and content", async () => {
      const label = fenced("still-quotable.md", ["# Limits", ""], LINES_1_3);
      const result = await add({
        page: label,
        src: "src/limits.ts:1-3",
        pageLines: { start: 6, end: 10 },
        quote: true,
      });
      expect(result.citation.quote).toBe(true);
      expect(result.claimLines).toEqual({ start: 15, end: 19 });
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

    it("refuses a --root that does not exist, as check does", async () => {
      workspace("no-citations.md");
      const missing = join(cwd, "no-such-dir");
      expect(
        await refusal(add({ page: "pages/no-citations.md", pageLines: { start: 6, end: 6 }, src: "src/limits.ts:2", root: missing })),
      ).toBe(`Root directory not found: ${missing}.`);
      expect(onDisk("pages/no-citations.md")).toBe(readFileSync(join(PAGES, "no-citations.md"), "utf8"));
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

describe("runAdd: a paragraph a misplaced marker splits", () => {
  /** A page whose marker sits inside its one paragraph, as the old `add --marker` left it. */
  function split(): string {
    return write("split.mdx", [
      "---",
      "title: Crawl",
      "citations:",
      "  - id: fresh-context",
      "    claim:",
      `      integrity: ${hashRange("Each URL is loaded fresh.\n", { start: 1, end: 1 })}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "Pages are checked one at a time.",
      "{/* cite fresh-context */}",
      "Each URL is loaded fresh.",
    ]);
  }

  it("refuses --marker into it, and names the command that fixes it", async () => {
    const label = split();
    const before = readFileSync(join(cwd, label), "utf8");
    expect(
      await refusal(
        add({
          page: label,
          pageLines: { start: 14, end: 14 },
          src: "src/limits.ts:3",
          id: "retry-once",
          marker: true,
        }),
      ),
    ).toBe(
      `${label}:14 is in the paragraph at lines 12-14, which the marker at line 13 splits. Run manni cite update first.`,
    );
    expect(readFileSync(join(cwd, label), "utf8")).toBe(before);
  });

  it("refuses claim lines that hold the misplaced marker's line", async () => {
    const label = split();
    expect(
      await refusal(
        add({
          page: label,
          pageLines: { start: 12, end: 14 },
          src: "src/limits.ts:3",
          id: "retry-once",
        }),
      ),
    ).toBe(
      `${label}:12-14 holds the marker at line 13, which splits its paragraph. Run manni cite update first.`,
    );
  });

  it("writes a marker under a heading, never above it", async () => {
    const label = write("heading.md", [
      "---",
      "title: Limits",
      "---",
      "## Crawl scope",
      "Only the start URL's host is crawled.",
    ]);
    const result = await add({
      page: label,
      pageLines: { start: 5, end: 5 },
      src: "src/limits.ts:3",
      id: "host-scope",
      marker: true,
    });
    // The frontmatter gained a `citations:` block, so the body is read by
    // what it says rather than by line number.
    expect(result.content).toContain(
      ["## Crawl scope", "<!-- cite host-scope -->", "Only the start URL's host is crawled.", ""].join("\n"),
    );
    // The pin covers the sentence, not the heading above it.
    expect(result.citation.claim?.integrity).toBe(
      hashRange("Only the start URL's host is crawled.\n", { start: 1, end: 1 }),
    );
  });

  it("lets an add elsewhere on the page through", async () => {
    const label = write("elsewhere.mdx", [
      "---",
      "title: Crawl",
      "citations:",
      "  - id: fresh-context",
      "    claim:",
      `      integrity: ${hashRange("Each URL is loaded fresh.\n", { start: 1, end: 1 })}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "Pages are checked one at a time.",
      "{/* cite fresh-context */}",
      "Each URL is loaded fresh.",
      "",
      "Retries default to 3.",
    ]);
    const result = await add({
      page: label,
      pageLines: { start: 16, end: 16 },
      src: "src/limits.ts:3",
      id: "retries",
      marker: true,
    });
    expect(result.written).toBe(true);
    expect(result.content).toContain(["{/* cite retries */}", "Retries default to 3.", ""].join("\n"));
  });
});
