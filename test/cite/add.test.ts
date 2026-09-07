/**
 * `runAdd` against temp copies of the fixture pages, with `test/fixtures/cite`
 * as the root so `src/limits.ts` is the ladder SOURCE. `commit: false` keeps
 * the minted entry deterministic; the one HEAD case runs only where git is.
 * Every refusal is pinned to its exact text, because the CLI prints it as is.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import { obfuscatePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { AddOptions, AddResult } from "../../src/cite/types.js";
import { gitAvailable } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SALT = "SALT-FIXTURE";
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
const CLAIM = "The fetch timeout is 10 seconds.";

const LINE_2 = "export const FETCH_TIMEOUT_MS = 10_000;";
const LINES_1_3 = ["export const MAX_FILES = 10_000;", LINE_2, "export const RETRIES = 3;"];

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
const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function add(over: Partial<AddOptions> & { page: string; src: string }): Promise<AddResult> {
  return runAdd({ cwd, root: ROOT, noConfig: true, commit: false, ...over });
}

/** Statuses `runCheck` gives the page afterwards: what a CI job would see. */
async function recheck(label: string, configPath?: string): Promise<string[]> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    git: false,
    inputs: [label],
    ...(configPath === undefined ? { noConfig: true } : { configPath }),
  });
  const findings = run.pages[0]?.findings.map((f) => f.rule) ?? [];
  return [...(run.pages[0]?.citations.map((c) => c.status) ?? []), ...findings.filter((r) => r !== "current")];
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

function tempConfig(cite: string): string {
  const path = join(cwd, "manni.config.yaml");
  writeFileSync(path, `cite:\n${cite.replace(/^/gm, "  ")}\n`, "utf8");
  return path;
}

describe("runAdd", () => {
  describe("frontmatter placement", () => {
    it("appends a claimed entry and reports the claim's line after the append", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM });
      expect(result.placed).toBe("frontmatter");
      expect(result.file).toBe("pages/no-citations.md");
      expect(result.citation).toEqual({ claim: CLAIM, src: "src/limits.ts:2", integrity: PIN_L2 });
      expect(result.written).toBe(true);
      expect(onDisk(result.file)).toBe(result.content);
      // Four frontmatter lines were added above the sentence, which sat on line 6.
      expect(result.anchorLine).toBe(10);
      expect(result.referenceLine).toBeUndefined();
      expect(result.content.split("\n")[9]).toBe(CLAIM);
      expect(readPage(result.file, result.content).citations.map((c) => c.citation)).toEqual([result.citation]);
      expect(result.diff.split("\n").slice(0, 2)).toEqual(["--- pages/no-citations.md", "+++ pages/no-citations.md"]);
      expect(result.diff).toContain("+citations:");
      expect(await recheck(result.file)).toEqual(["current"]);
    });

    it("writes a reference statement above the paragraph when given an id", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM, id: "fetch-timeout" });
      expect(result.placed).toBe("frontmatter");
      expect(result.citation).toEqual({ id: "fetch-timeout", claim: CLAIM, src: "src/limits.ts:2", integrity: PIN_L2 });
      expect(result.referenceLine).toBe(11);
      expect(result.anchorLine).toBe(12);
      const lines = result.content.split("\n");
      expect(lines[10]).toBe("<!-- cite fetch-timeout -->");
      expect(lines[11]).toBe(CLAIM);
      expect(await recheck(result.file)).toEqual(["current"]);
      const page = readPage(result.file, result.content);
      expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 4, anchorLine: 12 });
    });

    it("adds a bare pin with nothing anchoring it", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts" });
      expect(result.citation).toEqual({
        src: "src/limits.ts",
        integrity: "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023",
      });
      expect(result.anchorLine).toBeUndefined();
      expect(result.content).not.toContain("<!-- cite");
      expect(await recheck(result.file)).toEqual(["current"]);
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
      const result = await add({ page: label, src: "src/limits.ts:2", claim: CLAIM });
      expect(result.content).toContain("# house rule: description first");
      expect(result.content).toContain("title: Limits # shown in the nav");
      expect(result.content.indexOf("description:")).toBeLessThan(result.content.indexOf("title:"));
      expect(result.content.slice(result.content.indexOf("\n# Limits"))).toBe(before.slice(before.indexOf("\n# Limits")));
    });

    it("keeps a CRLF page CRLF", async () => {
      workspace("crlf.md");
      const result = await add({
        page: "pages/crlf.md",
        src: "src/limits.ts:3",
        claim: "It is not configurable.",
        id: "retries",
      });
      expect(result.content.replace(/\r\n/g, "")).not.toContain("\n");
      expect(result.content).toContain("<!-- cite retries -->\r\n");
      expect(result.content).toContain("integrity: " + PIN_L3 + "\r\n");
      expect(await recheck(result.file)).toEqual(["current", "current"]);
    });
  });

  describe("inline placement", () => {
    it("writes a JSON statement above the claim's paragraph and leaves the frontmatter alone", async () => {
      workspace("no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM, inline: true });
      expect(result.placed).toBe("inline");
      expect(result.content).not.toContain("citations:");
      const lines = result.content.split("\n");
      // The statement leads with the pin and ends with the prose, as the proposal spells it.
      expect(lines[5]).toBe(`<!-- cite {"src":"src/limits.ts:2","integrity":"${PIN_L2}","claim":"${CLAIM}"} -->`);
      expect(lines[6]).toBe(CLAIM);
      expect(result.anchorLine).toBe(7);
      expect(result.referenceLine).toBeUndefined();
      expect(await recheck(result.file)).toEqual(["current"]);
    });

    it("uses the format's own statement syntax", async () => {
      const label = write("page.mdx", ["---", "title: Limits", "---", "", CLAIM]);
      const result = await add({ page: label, src: "src/limits.ts:2", claim: CLAIM, inline: true });
      expect(result.content.split("\n")[4]).toMatch(/^<!-- cite \{.*\} -->$/);
      const html = write("page.html", ["<html><body>", "", `<p>${CLAIM}</p>`, "", "</body></html>"]);
      const inHtml = await add({ page: html, src: "src/limits.ts:2", claim: CLAIM, inline: true });
      expect(inHtml.content.split("\n")[2]).toMatch(/^<!-- cite \{.*\} -->$/);
      expect(inHtml.anchorLine).toBe(4);
      expect(await recheck(html)).toEqual(["current"]);
    });
  });

  describe("--quote", () => {
    const fenced = (name: string, lead: string[], block: string[], tail: string[] = []): string =>
      write(name, ["---", "title: Limits", "---", ...lead, "```ts", ...block, "```", ...tail]);

    it("anchors to the one fenced block that reproduces the range", async () => {
      const label = fenced("quoted.md", ["# Limits", ""], LINES_1_3);
      const result = await add({ page: label, src: "src/limits.ts:1-3", quote: true });
      expect(result.placed).toBe("frontmatter");
      expect(result.citation).toEqual({ src: "src/limits.ts:1-3", integrity: PIN_1_3, quote: true });
      // The opener sat on line 6; the frontmatter grew by four lines.
      expect(result.anchorLine).toBe(10);
      expect(await recheck(label)).toEqual(["current"]);
    });

    it("puts an inline statement directly above the block", async () => {
      const label = fenced("quoted.md", ["# Limits", ""], LINES_1_3);
      const result = await add({ page: label, src: "src/limits.ts:1-3", quote: true, inline: true });
      const lines = result.content.split("\n");
      expect(lines[5]).toBe(`<!-- cite {"src":"src/limits.ts:1-3","integrity":"${PIN_1_3}","quote":true} -->`);
      expect(lines[6]).toBe("```ts");
      expect(result.anchorLine).toBe(7);
      expect(await recheck(label)).toEqual(["current"]);
    });

    it("with a claim, anchors the claim and requires the next block to reproduce the range", async () => {
      const label = fenced("quoted.md", ["# Limits", "", CLAIM, ""], [LINE_2]);
      const result = await add({ page: label, src: "src/limits.ts:2", claim: CLAIM, quote: true, id: "fetch-timeout" });
      expect(result.citation).toEqual({ id: "fetch-timeout", claim: CLAIM, src: "src/limits.ts:2", integrity: PIN_L2, quote: true });
      const lines = result.content.split("\n");
      expect(lines[lines.indexOf(CLAIM) - 1]).toBe("<!-- cite fetch-timeout -->");
      expect(await recheck(label)).toEqual(["current"]);
    });

    it("refuses when the block after the claim reproduces something else", async () => {
      const label = fenced("quoted.md", ["# Limits", "", CLAIM, ""], ["export const RETRIES = 3;"]);
      expect(await refusal(add({ page: label, src: "src/limits.ts:2", claim: CLAIM, quote: true }))).toBe(
        `The fenced block after the claim in ${label} does not reproduce src/limits.ts:2.`,
      );
      const bare = write("bare.md", ["---", "title: Limits", "---", CLAIM]);
      expect(await refusal(add({ page: bare, src: "src/limits.ts:2", claim: CLAIM, quote: true }))).toBe(
        `No fenced block follows the claim in ${bare}.`,
      );
    });

    it("refuses when no block, or more than one, reproduces the range", async () => {
      const none = fenced("none.md", [], ["export const RETRIES = 3;"]);
      expect(await refusal(add({ page: none, src: "src/limits.ts:1-3", quote: true }))).toBe(
        `No fenced block in ${none} reproduces src/limits.ts:1-3.`,
      );
      const twice = fenced("twice.md", [], LINES_1_3, ["", "~~~", ...LINES_1_3, "~~~"]);
      expect(await refusal(add({ page: twice, src: "src/limits.ts:1-3", quote: true }))).toBe(
        `2 fenced blocks in ${twice} reproduce src/limits.ts:1-3 (lines 4, 10); add --claim to say which sentence introduces it.`,
      );
    });

    it("refuses on a format with no fenced blocks", async () => {
      workspace("inline.html", "inline.rst");
      expect(await refusal(add({ page: "pages/inline.html", src: "src/limits.ts:2", quote: true }))).toBe(
        "--quote needs a format with fenced blocks; pages/inline.html is html.",
      );
      expect(await refusal(add({ page: "pages/inline.rst", src: "src/limits.ts:2", quote: true }))).toBe(
        "--quote needs a format with fenced blocks; pages/inline.rst is rst.",
      );
    });
  });

  describe("a repeated claim", () => {
    it("refuses without an id, naming the lines and the statement to add", async () => {
      workspace("claim-ambiguous.md");
      expect(await refusal(add({ page: "pages/claim-ambiguous.md", src: "src/limits.ts:3", claim: "Retries default to 3." }))).toBe(
        "Claim occurs 2 times in pages/claim-ambiguous.md (lines 10, 14). Give it an --id and put `<!-- cite <id> -->` above the intended paragraph.",
      );
      const adoc = write("twice.adoc", ["= Limits", "", "Retries default to 3.", "", "Retries default to 3. Really."]);
      expect(await refusal(add({ page: adoc, src: "src/limits.ts:3", claim: "Retries default to 3." }))).toBe(
        `Claim occurs 2 times in ${adoc} (lines 3, 5). Give it an --id and put \`// (cite <id>)\` above the intended paragraph.`,
      );
    });

    it("takes the paragraph a reference statement with that id already marks", async () => {
      const label = write("marked.md", [
        "---",
        "title: Limits",
        "---",
        "# Limits",
        "",
        "Retries default to 3.",
        "",
        "<!-- cite retries -->",
        "Retries default to 3. Really.",
      ]);
      const result = await add({ page: label, src: "src/limits.ts:3", claim: "Retries default to 3.", id: "retries" });
      expect(result.content.match(/cite retries/g)).toHaveLength(1);
      expect(result.referenceLine).toBe(13);
      expect(result.anchorLine).toBe(14);
      expect(await recheck(label)).toEqual(["current"]);
    });
  });

  describe("minting", () => {
    it("obfuscates from the flag or the config, keyed with the configured salt", async () => {
      workspace("no-citations.md");
      const config = tempConfig(`salt: ${SALT}`);
      const token = obfuscatePath("src/limits.ts", SALT);
      const keyed = hashRange(LINE_2, undefined, SALT);
      const flagged = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM, obfuscate: true, noConfig: false, configPath: config });
      expect(flagged.citation).toEqual({ claim: CLAIM, src: `${token}:2`, integrity: keyed });
      expect(flagged.content).not.toContain("limits.ts");
      expect(await recheck(flagged.file, config)).toEqual(["current"]);

      workspace("no-citations.md");
      const configured = tempConfig(`salt: ${SALT}\nobfuscate: true`);
      const byConfig = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", noConfig: false, configPath: configured });
      expect(byConfig.citation.src).toBe(`${token}:2`);
      const plain = await add({ page: "pages/no-citations.md", src: "src/limits.ts:3", obfuscate: false, noConfig: false, configPath: configured });
      expect(plain.citation.src).toBe("src/limits.ts:3");
    });

    it.skipIf(!gitAvailable())("records HEAD unless told not to", async () => {
      workspace("no-citations.md");
      const withHead = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", commit: undefined });
      expect(withHead.citation.commit).toMatch(/^[0-9a-f]{40}$/);
      const without = await add({ page: "pages/no-citations.md", src: "src/limits.ts:3", commit: false });
      expect(without.citation.commit).toBeUndefined();
    });
  });

  describe("outputs", () => {
    it("prints the diff and writes nothing under --dry-run", async () => {
      workspace("no-citations.md");
      const before = onDisk("pages/no-citations.md");
      const result = await add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM, dryRun: true });
      expect(result.written).toBe(false);
      expect(result.diff).toContain("+citations:");
      expect(result.content).not.toBe(before);
      expect(onDisk("pages/no-citations.md")).toBe(before);
    });

    it("returns the rewritten page for stdin instead of writing it", async () => {
      workspace();
      const result = await add({ page: "-", src: "src/limits.ts:2", claim: CLAIM, as: "markdown", stdinContent: readFileSync(join(PAGES, "no-citations.md"), "utf8") });
      expect(result.file).toBe("<stdin>");
      expect(result.written).toBe(false);
      expect(result.content).toContain("citations:");
      expect(result.anchorLine).toBe(10);
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

    it("refuses a claim the page does not carry", async () => {
      workspace("no-citations.md");
      expect(await refusal(add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: "The fetch timeout is 9 seconds." }))).toBe(
        'Claim not found in pages/no-citations.md: "The fetch timeout is 9 seconds.". Add the sentence first, or omit --claim.',
      );
    });

    it("refuses an id the page already cites, in either channel", async () => {
      workspace("current.md", "inline.mdx");
      expect(await refusal(add({ page: "pages/current.md", src: "src/limits.ts:2", claim: CLAIM, id: "fetch-timeout" }))).toBe(
        'Id "fetch-timeout" is already cited in pages/current.md.',
      );
      const inline = write("inline-id.md", ["---", "title: Limits", "---", `<!-- cite {"id":"retries","src":"src/limits.ts:3","integrity":"${PIN_L3}"} -->`, "Retries default to 3.", "", CLAIM]);
      expect(await refusal(add({ page: inline, src: "src/limits.ts:2", claim: CLAIM, id: "retries" }))).toBe(
        `Id "retries" is already cited in ${inline}.`,
      );
    });

    it("refuses --inline and --id with nothing to anchor", async () => {
      workspace("no-citations.md");
      expect(await refusal(add({ page: "pages/no-citations.md", src: "src/limits.ts:2", inline: true }))).toBe(
        "--inline needs --claim or --quote: an inline statement anchors the paragraph or block that follows it.",
      );
      expect(await refusal(add({ page: "pages/no-citations.md", src: "src/limits.ts:2", id: "fetch-timeout" }))).toBe(
        "--id needs --claim or --quote: nothing would reference it.",
      );
    });

    it("refuses a page that has no frontmatter to write to", async () => {
      workspace("inline.html");
      expect(await refusal(add({ page: "pages/inline.html", src: "src/limits.ts:3", claim: CLAIM }))).toBe(
        "pages/inline.html has no frontmatter to write to. Use --inline.",
      );
    });

    it("refuses stdin without --as, and a page that is not there", async () => {
      workspace();
      expect(await refusal(add({ page: "-", src: "src/limits.ts:2", stdinContent: "x" }))).toBe(
        "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      );
      expect(await refusal(add({ page: "pages/nope.md", src: "src/limits.ts:2" }))).toBe('File not found: "pages/nope.md".');
    });

    it("refuses an id that is not kebab-case", async () => {
      workspace("no-citations.md");
      expect(await refusal(add({ page: "pages/no-citations.md", src: "src/limits.ts:2", claim: CLAIM, id: "Fetch Timeout" }))).toBe(
        'Invalid id "Fetch Timeout": use lowercase letters, digits and hyphens, starting with a letter or digit.',
      );
    });
  });
});
