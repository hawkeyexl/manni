/**
 * `runUpdate` against temp copies of the fixture pages. An entry has two ends
 * and `update` repairs both: `claim-moved.md` splices `claim.lines`,
 * `moved.md` splices `source.lines` (`moved.ts` is the ladder source with two
 * comment lines above it, so every pin holds two lines down). `--accept`
 * re-pins what changed: `claim-changed.md` and `marker-changed.md` on the page
 * side, `source-changed.md` on the source side. The fixture cases inject a git
 * that is not there, as in check.test.ts; the commit splice runs against a
 * throwaway repository.
 */
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashLines, hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { UpdateOptions, UpdateRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SRC = join(ROOT, "src");
/** A fixed test key; never the developer's environment. */
const KEY = "update-key-0123456789abcdef0123456789";
/** `src/limits.ts` line 2, the pin every fixture's source end carries. */
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
/** `src/limits.ts` line 3. */
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";
/** The claim pin `current.md` and friends carry: "The fetch timeout is 10 seconds." */
const CLAIM_10 = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
/** The claim pin a marker-anchored fixture carries: "Retries default to 3." */
const CLAIM_RETRIES = "sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d";

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const CHANGED_L2 = hashRange(source("changed.ts"), { start: 2, end: 2 });
const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no reanchored claims, no diffs, no commit subjects.";
const NO_COMMIT = "git is not available here, so the citation records no commit.";

let cwd = "";
function workspace(...pages: string[]): void {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-update-"));
  mkdirSync(join(cwd, "pages"));
  for (const name of pages) copyFileSync(join(PAGES, name), join(cwd, "pages", name));
}
function write(name: string, lines: string[]): string {
  if (cwd === "") workspace();
  writeFileSync(join(cwd, "pages", name), lines.join("\n") + "\n", "utf8");
  return `pages/${name}`;
}
const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
/** A page written byte for byte, when the terminators are what is under test. */
function writeRaw(name: string, content: string): string {
  if (cwd === "") workspace();
  writeFileSync(join(cwd, "pages", name), content, "utf8");
  return `pages/${name}`;
}
afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function update(over: Partial<UpdateOptions> & { inputs: string[] }): Promise<UpdateRun> {
  return runUpdate({ cwd, root: ROOT, noConfig: true, gitClient: noGit(), env: {}, ...over });
}

/** Both ends of every citation on a page, as `check` reads them now. */
async function ends(label: string, configPath?: string): Promise<(string | null)[][]> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    gitClient: noGit(),
    env: {},
    inputs: [label],
    ...(configPath === undefined ? { noConfig: true } : { configPath }),
  });
  return (run.pages[0]?.citations ?? []).map((c) => [c.claim?.status ?? null, c.source.status]);
}

const UNTERMINATED = (label: string): string =>
  `${label}: Unterminated front matter fence: the opening fence has no matching close, so the page's citations cannot be read. Add a closing fence.`;

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

describe("runUpdate: the claim end", () => {
  it("splices a moved claim's lines and leaves the rest of the page alone", async () => {
    workspace("claim-moved.md");
    const before = onDisk("pages/claim-moved.md");
    const run = await update({ inputs: ["pages/claim-moved.md"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    const [page] = run.pages;
    expect(page?.file).toBe("pages/claim-moved.md");
    expect(page?.written).toBe(true);
    expect(page?.skipped).toEqual([]);
    expect(page?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "claim",
        reason: "moved",
        status: "moved",
        from: "15",
        to: "17",
        fromLines: "15",
        toLines: "17",
      },
    ]);
    const after = onDisk("pages/claim-moved.md");
    expect(after).toContain("      lines: 5\n");
    // Only that one line differs: the pin, the source and the body are untouched.
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toEqual(["      lines: 5"]);
    expect(page?.diff).toContain("-      lines: 3");
    expect(page?.diff).toContain("+      lines: 5");
    expect(await ends("pages/claim-moved.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-pins a changed claim over the paragraph now at its line, and says what it took", async () => {
    workspace("claim-changed.md");
    const declined = await update({ inputs: ["pages/claim-changed.md"] });
    // claim-changed is a warning, so leaving it behind is not work undone.
    expect(declined).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(declined.pages[0]?.skipped.map((f) => [f.rule, f.severity, f.line])).toEqual([
      ["claim-changed", "warning", 15],
    ]);

    workspace("claim-changed.md");
    const pin = hashLines("The fetch timeout is 30 seconds.");
    const run = await update({ inputs: ["pages/claim-changed.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_10,
        to: pin,
        fromPin: CLAIM_10,
        toPin: pin,
        at: 15,
        text: "The fetch timeout is 30 seconds.",
      },
    ]);
    const after = onDisk("pages/claim-changed.md");
    expect(after).toContain(`      integrity: ${pin}\n`);
    // The claim still covers its one recorded line, so `lines:` is left alone.
    expect(after).toContain("      lines: 3\n");
    expect(await ends("pages/claim-changed.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-pins a marker-anchored claim in place, with no lines to splice", async () => {
    workspace("marker-changed.md");
    const pin = hashLines("Retries default to 5.");
    const run = await update({ inputs: ["pages/marker-changed.md"], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "retries",
        index: 0,
        line: 4,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_RETRIES,
        to: pin,
        fromPin: CLAIM_RETRIES,
        toPin: pin,
        at: 15,
        markerLine: 14,
        text: "Retries default to 5.",
      },
    ]);
    const after = onDisk("pages/marker-changed.md");
    expect(after).toContain(`      integrity: ${pin}\n`);
    expect(after).not.toContain("lines:\n");
    expect(after).toContain("<!-- cite retries -->\n");
    expect(await ends("pages/marker-changed.md")).toEqual([["current", "current"]]);
  });

  it("--accept skips a marker paragraph longer than 5,000 lines, and says why", async () => {
    // Frontmatter is lines 1-11, the heading 12, the marker 14: the paragraph is 15-5015.
    const label = write("long.md", [
      "---",
      "title: Limits",
      "citations:",
      "  - id: retries",
      "    claim:",
      `      integrity: ${CLAIM_RETRIES}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "# Limits",
      "",
      "<!-- cite retries -->",
      ...Array.from({ length: 5001 }, (_, i) => `Line ${String(i + 1)} of a long paragraph.`),
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => [f.rule, f.message])).toEqual([
      [
        "claim-changed",
        "retries: the claim at lines 15-5015 has changed since it was pinned. Not re-pinned: the paragraph spans 5001 lines, more than 5000.",
      ],
    ]);
    expect(onDisk(label)).toBe(before);
  });

  it("--accept skips a claim-lines paragraph that has grown past 5,000 lines", async () => {
    // No marker: the unit is the paragraph at the claim's own first line,
    // body line 1, which is file line 13 under this frontmatter.
    const label = write("grown.md", [
      "---",
      "title: Limits",
      "citations:",
      "  - id: grown",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("A sentence nobody kept.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      ...Array.from({ length: 5001 }, (_, i) => `Line ${String(i + 1)} of a long paragraph.`),
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => [f.rule, f.message])).toEqual([
      [
        "claim-changed",
        "grown: the claim at line 13 has changed since it was pinned. Not re-pinned: the paragraph spans 5001 lines, more than 5000.",
      ],
    ]);
    expect(onDisk(label)).toBe(before);
  });

  it("--accept re-pins stacked markers over the paragraph, never the marker lines", async () => {
    const entry = (id: string): string[] => [
      `  - id: ${id}`,
      "    claim:",
      `      integrity: ${CLAIM_RETRIES}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
    ];
    const label = write("stacked.md", [
      "---",
      "title: Limits",
      "citations:",
      ...entry("first"),
      ...entry("second"),
      "---",
      "# Limits",
      "",
      "<!-- cite first -->",
      "<!-- cite second -->",
      "Retries default to 5.",
    ]);
    const pin = hashLines("Retries default to 5.");
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["first", 23, "Retries default to 5.", pin],
      ["second", 23, "Retries default to 5.", pin],
    ]);
    expect(await ends(label)).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  it("--accept re-pins indented markers stacked in a list item", async () => {
    const entry = (id: string): string[] => [
      `  - id: ${id}`,
      "    claim:",
      `      integrity: ${CLAIM_RETRIES}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
    ];
    const label = write("stacked-item.md", [
      "---",
      "title: Limits",
      "citations:",
      ...entry("first"),
      ...entry("second"),
      "---",
      "# Limits",
      "",
      "1. Set the retries.",
      "",
      "   <!-- cite first -->",
      "   <!-- cite second -->",
      "   Retries default to 5.",
      "",
      "2. Run it.",
    ]);
    const pin = hashLines("   Retries default to 5.");
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["first", 25, "Retries default to 5.", pin],
      ["second", 25, "Retries default to 5.", pin],
    ]);
    expect(await ends(label)).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  it("--accept re-pins a paragraph that grew, moving the claim's last line with it", async () => {
    workspace();
    const label = write("grown.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    claim:",
      "      lines: 1",
      `      integrity: ${CLAIM_10}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "The fetch timeout is 30 seconds. It is",
      "not configurable either.",
    ]);
    const pin = hashLines("The fetch timeout is 30 seconds. It is\nnot configurable either.");
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 3,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_10,
        to: pin,
        fromPin: CLAIM_10,
        toPin: pin,
        // The re-pin covers a line the old one did not, so the row names both
        // spans (proposal 0053, section 7).
        fromLines: "12",
        toLines: "12-13",
        at: 12,
        // The report collapses the whitespace, so a two-line claim reads as one.
        text: "The fetch timeout is 30 seconds. It is not configurable either.",
      },
    ]);
    expect(onDisk(label)).toContain("      lines: 1-2\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("skips a changed claim whose line is now blank", async () => {
    workspace();
    const label = write("blank.md", [
      "---",
      "citations:",
      "  - id: gone",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("A sentence nobody kept.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "",
      "Something else entirely.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain("Not re-pinned: the line is blank.");
    expect(onDisk(label)).toBe(before);
  });

  it("re-pins a changed claim over the lines it held inside a fenced block", async () => {
    workspace();
    const label = write("fenced.md", [
      "---",
      "citations:",
      "  - id: buried",
      "    claim:",
      "      lines: 5",
      `      integrity: ${hashLines("const b = 1;")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "Before.",
      "",
      "```ts",
      "const a = 1;",
      "const b = 2;",
      "```",
    ]);
    const run = await update({ inputs: [label], accept: true });
    // The claim was minted over one line inside the block, so the re-pin
    // covers that line and not the block around it.
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["buried", 16, "const b = 2;", hashLines("const b = 2;")],
    ]);
    expect(onDisk(label)).toContain("      lines: 5\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("says a changed claim's lines run out of the fenced block they start in", async () => {
    workspace();
    const label = write("crossing.md", [
      "---",
      "citations:",
      "  - id: spilling",
      "    claim:",
      "      lines: 4-6",
      `      integrity: ${hashLines("const a = 0;\n```\nAfter.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "Before.",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "After.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: the claim's lines are not all inside one fenced block.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("re-pins a changed claim on a fence's opening line over the whole block", async () => {
    workspace();
    const label = write("whole-block.md", [
      "---",
      "citations:",
      "  - id: opener",
      "    claim:",
      "      lines: 3-5",
      `      integrity: ${hashLines("```ts\nconst a = 0;\n```")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "Before.",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ]);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["opener", 14, "```ts const a = 1; ```", hashLines("```ts\nconst a = 1;\n```")],
    ]);
    expect(onDisk(label)).toContain("      lines: 3-5\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("says a changed claim's line no longer starts a paragraph", async () => {
    workspace();
    const label = write("adorned.md", [
      "---",
      "citations:",
      "  - id: underlined",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("A sentence nobody kept.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "----",
      "",
      "Something else entirely.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: the line does not start a paragraph.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("says a changed claim's line is outside the page body", async () => {
    workspace();
    const label = write("short.md", [
      "---",
      "citations:",
      "  - id: past-the-end",
      "    claim:",
      "      lines: 40",
      `      integrity: ${hashLines("A sentence nobody kept.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "Something else entirely.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: the line is outside the page body.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("--accept re-pins a table row alone, leaving the rows under it", async () => {
    workspace("table-row.md");
    const label = "pages/table-row.md";
    const row = "| `--retries` | 5 | How many times a request is retried. |";
    const pin = hashLines(row);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["retries-row", 17, row, pin],
    ]);
    const after = onDisk(label);
    // The claim still spans one line, and the rows under it keep their text.
    expect(after).toContain("      lines: 5\n");
    expect(after).toContain(`      integrity: ${pin}\n`);
    expect(after).toContain("| `--timeout` | 10 | Seconds a request waits before it is given up. |\n");
    expect(after).toContain("| `--max-files` | 10000 | Files one run reads at most. |\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("--accept keeps the span of a claim pinned over several rows", async () => {
    workspace("table-span.md");
    const label = "pages/table-span.md";
    const rows = [
      "| `claim-changed` | error |",
      "| `claim-moved` | warning |",
      "| `source-moved` | warning |",
    ];
    const pin = hashLines(rows.join("\n"));
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.to])).toEqual([
      ["severity-rows", 17, pin],
    ]);
    const after = onDisk(label);
    // The author chose three rows, so the re-mint covers three rows.
    expect(after).toContain("      lines: 5-7\n");
    expect(after).toContain(`      integrity: ${pin}\n`);
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("refuses a multi-row claim whose table shrank under it", async () => {
    workspace();
    const label = write("shrank.md", [
      "---",
      "citations:",
      "  - id: shrank",
      "    claim:",
      "      lines: 1-3",
      `      integrity: ${hashLines("| a | b |\n|---|---|\n| c | d |")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "| a | b |",
      "|---|---|",
      "Prose replaced the row.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: the table no longer holds every row the claim covers.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("--accept re-pins a header row alone", async () => {
    workspace();
    const header = "| Flag | Default |";
    const label = write("header-row.md", [
      "---",
      "citations:",
      "  - id: header",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("| Option | Default |")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      header,
      "|---|---|",
      "| `--timeout` | 10 |",
    ]);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["header", 12, header, hashLines(header)],
    ]);
    expect(onDisk(label)).toContain("      lines: 1\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("--accept keeps the prose under a table out of a row's re-pin", async () => {
    workspace();
    const row = "| 1 | 2 |";
    const label = write("table-then-prose.md", [
      "---",
      "citations:",
      "  - id: last-row",
      "    claim:",
      "      lines: 3",
      `      integrity: ${hashLines("| 1 | 3 |")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "| a | b |",
      "|---|---|",
      row,
      "Prose right after.",
    ]);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["last-row", 14, row, hashLines(row)],
    ]);
    expect(onDisk(label)).toContain("      lines: 3\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("--accept re-pins the one row of a one-row table", async () => {
    workspace();
    const row = "| only | 2 |";
    const label = write("one-row.md", [
      "---",
      "citations:",
      "  - id: only-row",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("| only | 1 |")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      row,
    ]);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.at, r.text, r.to])).toEqual([
      ["only-row", 12, row, hashLines(row)],
    ]);
    expect(onDisk(label)).toContain("      lines: 1\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("skips a changed quote whose claim lines are no longer a fenced block", async () => {
    workspace();
    const label = write("unfenced.md", [
      "---",
      "citations:",
      "  - id: header",
      "    claim:",
      "      lines: 1-3",
      `      integrity: ${hashLines("```ts\nexport const FETCH_TIMEOUT_MS = 10_000;\n```")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "    quote: true",
      "---",
      "The fetch timeout is documented here.",
      "It used to be a fenced block.",
      "Now it is prose.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    // The claim is left for a fresh `cite add`, and the anchor is an error, so
    // the run reports work undone.
    expect(run.pages[0]?.skipped.map((f) => f.rule).sort()).toEqual([
      "anchor-invalid",
      "claim-changed",
    ]);
    expect(run.exitCode).toBe(1);
    expect(onDisk(label)).toBe(before);
  });

  it("leaves a claim that moved to two places for a person to settle", async () => {
    workspace("claim-moved-ambiguous.md");
    const before = onDisk("pages/claim-moved-ambiguous.md");
    const run = await update({ inputs: ["pages/claim-moved-ambiguous.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => [f.rule, f.severity])).toEqual([
      ["claim-moved-ambiguous", "warning"],
    ]);
    expect(onDisk("pages/claim-moved-ambiguous.md")).toBe(before);
  });
});

describe("runUpdate: --accept over text that is no claim", () => {
  const MARKER_PAGE = (): string[] => [
    "---",
    "citations:",
    "  - id: gone",
    "    claim:",
    "      lines: 1",
    `      integrity: ${hashLines("A sentence nobody kept.")}`,
    "    source:",
    "      file: src/limits.ts",
    "      lines: 2",
    `      integrity: ${PIN_L2}`,
    "  - id: anchored",
    "    claim:",
    `      integrity: ${hashLines("Something else entirely.")}`,
    "    source:",
    "      file: src/limits.ts",
    "      lines: 2",
    `      integrity: ${PIN_L2}`,
    "---",
    "<!-- cite anchored -->",
    "Something else entirely.",
  ];

  const RULE_PAGE = (lines: string, pinned: string): string[] => [
    "---",
    "citations:",
    "  - id: rule",
    "    claim:",
    `      lines: ${lines}`,
    `      integrity: ${hashLines(pinned)}`,
    "    source:",
    "      file: src/limits.ts",
    "      lines: 2",
    `      integrity: ${PIN_L2}`,
    "---",
    "| Flag | Default |",
    "|---|---|",
    "| `--retries` | 5 |",
  ];

  it("refuses a claim whose line now holds a cite marker", async () => {
    workspace();
    const label = write("marker-line.md", MARKER_PAGE());
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: that line now holds a cite marker, not claim text.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("re-pins the marker line once --only names the entry", async () => {
    workspace();
    const label = write("marker-line.md", MARKER_PAGE());
    const whole = hashLines("<!-- cite anchored -->\nSomething else entirely.");
    const run = await update({ inputs: [label], accept: true, only: ["gone"] });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.to])).toEqual([["claim", whole]]);
    expect(onDisk(label)).toContain(`      integrity: ${whole}\n`);
    expect(onDisk(label)).toContain("      lines: 1-2\n");
  });

  it("refuses a claim whose line is now a table rule", async () => {
    workspace();
    const label = write("rule-line.md", RULE_PAGE("2", "| gone | row |"));
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: that line is a table rule, not claim text.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("re-pins the table rule once --only names the entry", async () => {
    workspace();
    const label = write("rule-line.md", RULE_PAGE("2", "| gone | row |"));
    const rule = hashLines("|---|---|");
    const run = await update({ inputs: [label], accept: true, only: ["rule"] });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.to])).toEqual([["claim", rule]]);
    expect(onDisk(label)).toContain(`      integrity: ${rule}\n`);
  });

  const DUP_PAGE = (): string[] => [
    "---",
    "citations:",
    "  - id: dup",
    "    claim:",
    "      lines: 1",
    `      integrity: ${hashLines("A sentence nobody kept.")}`,
    "    source:",
    "      file: src/limits.ts",
    "      lines: 2",
    `      integrity: ${PIN_L2}`,
    "---",
    "Repeated line.",
    "",
    "Other text.",
    "",
    "Repeated line.",
  ];

  it("refuses a claim whose line now holds text the page repeats", async () => {
    workspace();
    const label = write("repeated.md", DUP_PAGE());
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(run.pages[0]?.skipped[0]?.message).toContain(
      "Not re-pinned: the text there also appears at line 16, so a pin cannot identify it. Re-run with --only dup to accept it anyway.",
    );
    expect(onDisk(label)).toBe(before);
  });

  it("re-pins the repeated text once --only names the entry", async () => {
    workspace();
    const label = write("repeated.md", DUP_PAGE());
    const pin = hashLines("Repeated line.");
    const run = await update({ inputs: [label], accept: true, only: ["dup"] });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.to])).toEqual([["claim", pin]]);
    expect(onDisk(label)).toContain(`      integrity: ${pin}\n`);
  });

  it("re-pins a claim that covers a header, its rule and a body row", async () => {
    workspace();
    const label = write(
      "rule-span.md",
      RULE_PAGE("1-3", "| gone | row |\n|---|---|\n| old | row |"),
    );
    const whole = hashLines("| Flag | Default |\n|---|---|\n| `--retries` | 5 |");
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.to])).toEqual([["claim", whole]]);
    expect(onDisk(label)).toContain(`      integrity: ${whole}\n`);
  });
});

describe("runUpdate: the source end", () => {
  it("splices a moved source's lines", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "source",
        reason: "moved",
        status: "moved",
        from: "src/moved.ts:2",
        to: "src/moved.ts:4",
      },
    ]);
    const after = onDisk("pages/moved.md");
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toEqual(["      lines: 4"]);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(await ends("pages/moved.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-mints a changed source, recording no commit where the entry records none", async () => {
    workspace("source-changed.md");
    const before = onDisk("pages/source-changed.md");
    const declined = await update({ inputs: ["pages/source-changed.md"] });
    expect(declined).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
    expect(declined.pages[0]?.skipped.map((f) => [f.rule, f.severity])).toEqual([
      ["source-changed", "error"],
    ]);
    expect(onDisk("pages/source-changed.md")).toBe(before);

    const run = await update({ inputs: ["pages/source-changed.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "source",
        reason: "accepted",
        status: "changed",
        from: PIN_L2,
        to: CHANGED_L2,
        fromPin: PIN_L2,
        toPin: CHANGED_L2,
        src: "src/changed.ts:2",
      },
    ]);
    const after = onDisk("pages/source-changed.md");
    expect(after).toContain(`      integrity: ${CHANGED_L2}\n`);
    expect(after).not.toContain("commit-sha");
    expect(after.replace(CHANGED_L2, PIN_L2)).toBe(before);
    expect(await ends("pages/source-changed.md")).toEqual([["current", "current"]]);
  });

  it("keeps an encrypted source encrypted across a move", async () => {
    workspace();
    const config = tempConfig("", KEY);
    const token = encryptSourcePath("src/moved.ts", KEY);
    const label = write("token.md", [
      "---",
      "citations:",
      "  - source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY)}`,
      "---",
      "Body.",
    ]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        index: 0,
        line: 3,
        end: "source",
        reason: "moved",
        status: "moved",
        from: `${token}:2`,
        to: `${token}:4`,
      },
    ]);
    const after = onDisk(label);
    expect(after).toContain("      lines: 4\n");
    expect(after).not.toContain("moved.ts");
    expect(await ends(label, config)).toEqual([[null, "current"]]);
  });

  it("--accept re-mints an encrypted entry in its own form: encrypted, under the current key", async () => {
    workspace();
    const config = tempConfig("", KEY);
    const token = encryptSourcePath("src/changed.ts", KEY);
    const before = hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY);
    const label = write("token.md", [
      "---",
      "citations:",
      "  - source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${before}`,
      "---",
      "Body.",
    ]);
    expect(await ends(label, config)).toEqual([[null, "changed"]]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config, accept: true });
    const reminted = hashRange(source("changed.ts"), { start: 2, end: 2 }, KEY);
    expect(run.pages[0]?.rewritten).toEqual([
      {
        index: 0,
        line: 3,
        end: "source",
        reason: "accepted",
        status: "changed",
        from: before,
        to: reminted,
        fromPin: before,
        toPin: reminted,
        src: `${token}:2`,
      },
    ]);
    const after = onDisk(label);
    expect(after).toContain(`      file: ${token}\n`);
    expect(after).toContain(`      integrity: ${reminted}\n`);
    expect(after).not.toContain("changed.ts");
    expect(await ends(label, config)).toEqual([[null, "current"]]);
  });

  it("--accept keeps a plain entry plain, even with a key available", async () => {
    workspace("source-changed.md");
    const config = tempConfig("", KEY);
    const run = await update({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: config,
      accept: true,
    });
    expect(run.pages[0]?.rewritten.map((r) => r.to)).toEqual([CHANGED_L2]);
    expect(onDisk("pages/source-changed.md")).not.toMatch(/file: ~/);
  });
});

describe("runUpdate: both ends, and what is left", () => {
  it("repairs a moved claim and a moved source on one page, in one pass", async () => {
    workspace();
    const label = write("both.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    claim:",
      "      lines: 1",
      `      integrity: ${CLAIM_10}`,
      "    source:",
      "      file: src/moved.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "A paragraph someone added above it.",
      "",
      "The fetch timeout is 10 seconds.",
    ]);
    const run = await update({ inputs: [label] });
    expect(run).toMatchObject({ rewritten: 2, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.from, r.to])).toEqual([
      ["claim", "12", "14"],
      ["source", "src/moved.ts:2", "src/moved.ts:4"],
    ]);
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("limits the work to the ids named by --only", async () => {
    workspace();
    const label = write("two.md", [
      "---",
      "citations:",
      "  - id: one",
      "    source:",
      "      file: src/moved.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "  - id: two",
      "    source:",
      "      file: src/moved.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "Body.",
    ]);
    const run = await update({ inputs: [label], only: ["one"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.to])).toEqual([["one", "src/moved.ts:4"]]);
    expect(await ends(label)).toEqual([
      [null, "current"],
      [null, "moved"],
    ]);
    // An id nothing carries: nothing to do, and nothing skipped either.
    const none = await update({ inputs: [label], only: ["nope"] });
    expect(none).toMatchObject({ rewritten: 0, skipped: 0, exitCode: 0 });
    expect(none.pages[0]?.written).toBe(false);
  });

  it("prints the diff and writes nothing under --dry-run", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"], dryRun: true });
    expect(run.rewritten).toBe(1);
    expect(run.pages[0]?.written).toBe(false);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(onDisk("pages/moved.md")).toBe(before);
  });

  it("reports what it could not fix and exits 1 for an error left behind", async () => {
    workspace("missing.md", "current.md");
    const run = await update({ inputs: ["pages/current.md", "pages/missing.md"], accept: true });
    expect(
      run.pages.map((p) => [p.file, p.rewritten.length, p.skipped.map((f) => f.rule), p.written]),
    ).toEqual([
      ["pages/current.md", 0, [], false],
      ["pages/missing.md", 0, ["source-missing"], false],
    ]);
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
  });

  it("does not report as skipped the finding a rewrite settled", async () => {
    workspace("moved.md");
    const run = await update({ inputs: ["pages/moved.md"] });
    expect(run.pages[0]?.skipped).toEqual([]);
    // A marker repeated on the page is about the entry, not an end: it stays.
    workspace("marker-repeated.md");
    const repeated = await update({ inputs: ["pages/marker-repeated.md"], accept: true });
    expect(repeated.pages[0]?.skipped.map((f) => f.rule)).toEqual(["marker-repeated"]);
    expect(repeated.exitCode).toBe(0);
  });

  it("refuses to run without the sources, and with nothing to update", async () => {
    workspace("moved.md");
    const message = "update needs the sources: drop --no-check-sources (or `checkSources: false`).";
    expect(await refusal(update({ inputs: ["pages/moved.md"], checkSources: false }))).toBe(message);
    expect(
      await refusal(
        update({
          inputs: ["pages/moved.md"],
          noConfig: false,
          configPath: tempConfig("checkSources: false"),
        }),
      ),
    ).toBe(message);
    expect(await refusal(update({ inputs: [] }))).toBe(
      "No files to update. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("refuses a page whose frontmatter fence never closes, as check does, and writes nothing", async () => {
    workspace();
    mkdirSync(join(cwd, "broken"));
    copyFileSync(
      join(ROOT, "broken", "unterminated-fence.mdx"),
      join(cwd, "broken", "unterminated-fence.mdx"),
    );
    const label = "broken/unterminated-fence.mdx";
    const before = onDisk(label);
    expect(await refusal(update({ inputs: [label] }))).toBe(UNTERMINATED(label));
    expect(onDisk(label)).toBe(before);

    // A markdown page with a moved entry would otherwise report nothing at all.
    const moved = readFileSync(join(PAGES, "moved.md"), "utf8").split("\n");
    const md = write("unterminated.md", moved.filter((line, i) => !(line === "---" && i > 0)));
    expect(await refusal(update({ inputs: [md] }))).toBe(UNTERMINATED(md));
  });

  it("refuses a --root that does not exist, as check does", async () => {
    workspace("moved.md");
    const missing = join(cwd, "no-such-dir");
    expect(await refusal(update({ inputs: ["pages/moved.md"], root: missing }))).toBe(
      `Root directory not found: ${missing}.`,
    );
  });

  it("says once, under --accept, that a re-mint without git records no commit", async () => {
    workspace("source-changed.md");
    const notices: string[] = [];
    const run = await update({
      inputs: ["pages/source-changed.md"],
      accept: true,
      onNotice: (m) => notices.push(m),
    });
    expect(run.rewritten).toBe(1);
    expect(notices).toEqual([NO_COMMIT]);
  });

  it("says nothing about git when nothing needed it", async () => {
    workspace("moved.md");
    const notices: string[] = [];
    await update({
      inputs: ["pages/moved.md"],
      accept: true,
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([]);
  });

  it("says history is off for a changed claim, which wants the page's past", async () => {
    workspace("claim-changed.md");
    const notices: string[] = [];
    await update({
      inputs: ["pages/claim-changed.md"],
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([NO_HISTORY]);
  });

  it("says history is off for a citation with a commit, then that the re-mint records none", async () => {
    workspace();
    const label = write("commit.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    source:",
      "      file: src/changed.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "      commit-sha: fc09aeff7891fcbedfe7d127393fc662fd3ddf7a",
      "---",
      "Body.",
    ]);
    const notices: string[] = [];
    const run = await update({ inputs: [label], accept: true, onNotice: (m) => notices.push(m) });
    expect(run.rewritten).toBe(1);
    expect(notices).toEqual([NO_HISTORY, NO_COMMIT]);
  });

  it("falls back to the configured collections when no paths are given", async () => {
    workspace("moved.md");
    const config = join(cwd, "manni.config.yaml");
    writeFileSync(config, "collections:\n  - name: pages\n    paths: ['pages/*.md']\n", "utf8");
    const run = await update({ inputs: [], noConfig: false, configPath: config });
    expect(run.pages.map((p) => [p.file, p.written])).toEqual([["pages/moved.md", true]]);
    expect(run.rewritten).toBe(1);
    expect(await ends("pages/moved.md", config)).toEqual([["current", "current"]]);
  });

  it("takes stdin, returning the rewritten page without writing", async () => {
    workspace();
    const run = await update({
      inputs: ["-"],
      as: "markdown",
      stdinContent: readFileSync(join(PAGES, "moved.md"), "utf8"),
    });
    expect(run.pages[0]).toMatchObject({ file: "<stdin>", written: false });
    expect(run.pages[0]?.rewritten).toHaveLength(1);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(run.pages[0]?.content).toContain("      lines: 4\n");
  });

  describe.skipIf(!gitAvailable())("with git", () => {
    let repo: string | undefined;
    afterEach(() => {
      removeTempRepo(repo);
      repo = undefined;
    });

    it("re-mints at HEAD, writing a commit-sha only where the entry records one", async () => {
      repo = makeTempRepo({ files: { "src/limits.ts": source("limits.ts") } });
      const first = commitAll(repo, "add limits");
      writeFileSync(join(repo, "src", "limits.ts"), source("changed.ts"), "utf8");
      const second = commitAll(repo, "raise fetch timeout to 30s");
      mkdirSync(join(repo, "docs"));
      const page = join(repo, "docs", "limits.md");
      writeFileSync(
        page,
        [
          "---",
          "citations:",
          "  - id: pinned",
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
          `      commit-sha: ${first} # minted by hand`,
          "  - id: loose",
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
          "---",
          "Body.",
          "",
        ].join("\n"),
        "utf8",
      );
      const run = await runUpdate({
        cwd: repo,
        inputs: ["docs/limits.md"],
        noConfig: true,
        accept: true,
        env: {},
      });
      expect(run.pages[0]?.rewritten).toEqual([
        {
          id: "pinned",
          index: 0,
          line: 3,
          end: "source",
          reason: "accepted",
          status: "changed",
          from: PIN_L2,
          to: CHANGED_L2,
          fromPin: PIN_L2,
          toPin: CHANGED_L2,
          src: "src/limits.ts:2",
          commitSha: second,
        },
        {
          id: "loose",
          index: 1,
          line: 9,
          end: "source",
          reason: "accepted",
          status: "changed",
          from: PIN_L2,
          to: CHANGED_L2,
          fromPin: PIN_L2,
          toPin: CHANGED_L2,
          src: "src/limits.ts:2",
        },
      ]);
      const after = readFileSync(page, "utf8");
      expect(after).toContain(`      commit-sha: ${second} # minted by hand\n`);
      // The entry that recorded no commit gains none: the splice replaces a
      // scalar, it does not add a key.
      expect(after.match(/commit-sha/g)).toHaveLength(1);
      const check = await runCheck({ cwd: repo, inputs: ["docs/limits.md"], noConfig: true, env: {} });
      expect(check.pages[0]?.citations.map((c) => c.source.status)).toEqual(["current", "current"]);
    });

    // The uniqueness refusal and the baseline refusal both stop a re-pin, and
    // a claim can trip both at once. This is that claim: its line drifted onto
    // text the page repeats, *and* the text shares no sentence with what the
    // claim said at the baseline. The baseline refusal has to win, because it
    // exits 1 and the uniqueness one exits 0. A repeated line must not turn a
    // failing `--accept` green. It lives here rather than beside the other
    // uniqueness cases because a baseline needs real history to read.
    it("keeps the exit-1 refusal for a claim that is both replaced and repeated", async () => {
      repo = makeTempRepo({ files: { "src/limits.ts": source("limits.ts") } });
      mkdirSync(join(repo, "docs"));
      const page = join(repo, "docs", "limits.md");
      const frontmatter = [
        "---",
        "citations:",
        "  - id: dup",
        "    claim:",
        "      lines: 1",
        `      integrity: ${CLAIM_10}`,
        "    source:",
        "      file: src/limits.ts",
        "      lines: 2",
        `      integrity: ${PIN_L2}`,
        "---",
      ];
      const body = (first: string): string =>
        [...frontmatter, first, "", "Other text.", "", "Repeated line.", ""].join("\n");
      writeFileSync(page, body("The fetch timeout is 10 seconds."), "utf8");
      const first = commitAll(repo, "docs: add limits");
      // The claim's line now holds text that already sits further down the
      // page, and says nothing the claim said.
      const after = body("Repeated line.");
      writeFileSync(page, after, "utf8");
      commitAll(repo, "docs: swap the cited line out");

      const run = await runUpdate({
        cwd: repo,
        inputs: ["docs/limits.md"],
        noConfig: true,
        accept: true,
        env: {},
      });
      expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
      expect(run.pages[0]?.refused.map((r) => [r.end, r.reason, r.commitSha])).toEqual([
        ["claim", "replaced", first],
      ]);
      expect(run.pages[0]?.skipped).toEqual([]);
      // Nothing was written: the pin still stands.
      expect(readFileSync(page, "utf8")).toBe(after);
    });
  });
});

describe("runUpdate: a marker inside a paragraph", () => {
  const MISPLACED = join(ROOT, "misplaced");
  /** A workspace holding copies of the named `misplaced/` fixtures. */
  function misplaced(...pages: string[]): void {
    workspace();
    mkdirSync(join(cwd, "misplaced"));
    for (const name of pages) copyFileSync(join(MISPLACED, name), join(cwd, "misplaced", name));
  }
  const label = (name: string): string => `misplaced/${name}`;
  const bodyOf = (name: string): string[] => onDisk(label(name)).split("\n");

  const HEAD_ONE = "Pages are checked one at a time, in the order the crawl found them.";
  const HEAD_TWO = "A page that fails to load is reported, and the crawl moves on.";
  const TAIL_ONE = "Each URL is loaded in a fresh browser context, so no state carries over";
  const TAIL_TWO = "from one page to the next.";
  const ONE_LINE = "Each URL is loaded in a fresh browser context.";

  it("moves a misplaced marker and re-pins its claim over the unit, with no flag", async () => {
    misplaced("mid-paragraph.mdx");
    const held = hashLines([TAIL_ONE, TAIL_TWO].join("\n"));
    const whole = hashLines([HEAD_ONE, HEAD_TWO, TAIL_ONE, TAIL_TWO].join("\n"));
    const run = await update({ inputs: [label("mid-paragraph.mdx")] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fresh-context",
        index: 0,
        line: 4,
        end: "marker",
        reason: "re-anchored",
        status: "misplaced",
        from: "16",
        to: "14",
        fromLines: "16",
        toLines: "14",
      },
      {
        id: "fresh-context",
        index: 0,
        line: 4,
        end: "claim",
        reason: "re-anchored",
        status: "moved",
        from: held,
        to: whole,
        fromPin: held,
        toPin: whole,
        lines: "17-18",
        newLines: "15-18",
      },
    ]);
    // The marker now sits above the paragraph, which reads whole again.
    expect(bodyOf("mid-paragraph.mdx").slice(13, 18)).toEqual([
      "{/* cite fresh-context */}",
      HEAD_ONE,
      HEAD_TWO,
      TAIL_ONE,
      TAIL_TWO,
    ]);
    expect(onDisk(label("mid-paragraph.mdx"))).toContain(`      integrity: ${whole}\n`);
    expect(await ends(label("mid-paragraph.mdx"))).toEqual([["current", "current"]]);
  });

  it("splits a stacked run, writing the page once, and says why the other marker stays", async () => {
    misplaced("stacked-run.mdx");
    const run = await update({ inputs: [label("stacked-run.mdx")] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 2, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.from, r.to])).toEqual([
      ["marker", "22", "21"],
      ["claim", hashLines(ONE_LINE), hashLines([HEAD_ONE].join("\n"))],
    ]);
    expect(run.pages[0]?.skipped.map((f) => [f.rule, f.message])).toEqual([
      [
        "marker-misplaced",
        "robots: the marker at line 23 stays, because its claim changed since it was pinned. update --accept moves it and re-pins.",
      ],
      ["claim-changed", "robots: the claim at line 24 has changed since it was pinned."],
    ]);
    // One write: the movable marker moved and the other did not, in one page.
    expect(bodyOf("stacked-run.mdx").slice(20, 24)).toEqual([
      "{/* cite one-at-a-time */}",
      HEAD_ONE,
      "{/* cite robots */}",
      ONE_LINE,
    ]);
    expect(await ends(label("stacked-run.mdx"))).toEqual([
      ["current", "current"],
      ["changed", "current"],
    ]);
  });

  it("--accept moves the marker whose claim holds nowhere and re-pins it", async () => {
    misplaced("stacked-run.mdx");
    const run = await update({ inputs: [label("stacked-run.mdx")], accept: true });
    expect(run).toMatchObject({ rewritten: 2, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.end, r.reason, r.status])).toEqual([
      ["one-at-a-time", "marker", "re-anchored", "misplaced"],
      ["one-at-a-time", "claim", "re-anchored", "moved"],
      ["robots", "marker", "re-anchored", "misplaced"],
      ["robots", "claim", "accepted", "changed"],
    ]);
    // The claim row reads at the line the move left the marker on, so the
    // two rows about `robots` name one line rather than two.
    const rows = run.pages[0]?.rewritten ?? [];
    expect(rows.find((r) => r.id === "robots" && r.end === "marker")?.to).toBe("22");
    expect(rows.find((r) => r.id === "robots" && r.end === "claim")?.markerLine).toBe(22);
    expect(bodyOf("stacked-run.mdx").slice(20, 24)).toEqual([
      "{/* cite one-at-a-time */}",
      "{/* cite robots */}",
      HEAD_ONE,
      ONE_LINE,
    ]);
    expect(await ends(label("stacked-run.mdx"))).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  it("--only moves one marker of a run and reports nothing about the other", async () => {
    misplaced("stacked-run.mdx");
    const run = await update({
      inputs: [label("stacked-run.mdx")],
      only: ["one-at-a-time"],
    });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(bodyOf("stacked-run.mdx")[20]).toBe("{/* cite one-at-a-time */}");
  });

  it("--only still shifts a claim-lines entry the named marker's move pushes down", async () => {
    misplaced("shift.md");
    const run = await update({ inputs: [label("shift.md")], only: ["timeouts"] });
    // The shift is a consequence of the move, not a repair `--only` selects,
    // so the page needs no second run.
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.end, r.reason])).toEqual([
      ["timeouts", "marker", "re-anchored"],
      ["timeouts", "claim", "re-anchored"],
      ["page-order", "claim", "shifted"],
    ]);
    expect(onDisk(label("shift.md"))).toContain("      lines: 4\n");
    expect(await ends(label("shift.md"))).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  /**
   * A move permutes the page's lines and assigns each position the terminator
   * that position already had. On a CRLF page every line must still end
   * `\r\n` afterwards, and a page that ended without a terminator must still
   * end without one, whichever line the move left last.
   */
  it("keeps every CRLF terminator, and the missing one at the end", async () => {
    const body = [
      "# Limits",
      "",
      "The fetch timeout is 10 seconds.",
      "<!-- cite timeouts -->",
      "Retries default to 3.",
    ];
    const label = writeRaw(
      "crlf-move.md",
      [
        "---",
        "title: Limits",
        "citations:",
        "  - id: timeouts",
        "    claim:",
        `      integrity: ${CLAIM_RETRIES}`,
        "    source:",
        "      file: src/limits.ts",
        "      lines: 3",
        `      integrity: ${PIN_L3}`,
        "---",
        ...body,
      ].join("\r\n"),
    );
    const run = await update({ inputs: [label] });
    expect(run).toMatchObject({ skipped: 0, exitCode: 0 });
    const after = onDisk(label);
    // The marker moved above the paragraph it anchors.
    expect(after.split("\r\n").slice(11, 15)).toEqual([
      "# Limits",
      "",
      "<!-- cite timeouts -->",
      "The fetch timeout is 10 seconds.",
    ]);
    // No bare LF survived the permutation, and no terminator was invented.
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(after.endsWith("Retries default to 3.")).toBe(true);
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  /**
   * A page mixing terminators has the endings of the two swapped positions
   * trade places, because content travels and terminators do not. What must
   * hold either way is asserted here: no terminator is gained, lost or
   * invented, and the page still ends as it began.
   */
  it("gains and loses no terminator on a page that mixes them", async () => {
    const label = writeRaw(
      "mixed-move.md",
      [
        "---",
        "title: Limits",
        "citations:",
        "  - id: timeouts",
        "    claim:",
        `      integrity: ${CLAIM_RETRIES}`,
        "    source:",
        "      file: src/limits.ts",
        "      lines: 3",
        `      integrity: ${PIN_L3}`,
        "---",
        "# Limits",
        "",
      ].join("\r\n") +
        // The paragraph the marker splits ends its lines with a bare LF.
        "\r\n" +
        ["The fetch timeout is 10 seconds.", "<!-- cite timeouts -->", "Retries default to 3."].join(
          "\n",
        ),
    );
    const before = onDisk(label);
    const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
    const run = await update({ inputs: [label] });
    expect(run.pages[0]?.written).toBe(true);
    const after = onDisk(label);
    expect(count(after, /\r\n/g)).toBe(count(before, /\r\n/g));
    expect(count(after.replace(/\r\n/g, ""), /\n/g)).toBe(count(before.replace(/\r\n/g, ""), /\n/g));
    // No terminator was invented at the end, and none was left dangling.
    expect(after.endsWith("Retries default to 3.")).toBe(true);
    expect(after).not.toContain("\r\r");
  });

  it("leaves a claim-lines entry whose text moved to the claim-moved repair", async () => {
    // `retries` records body line 3, which the marker's move pushes to 4,
    // but its pinned text sits at body 5. Shifting it to 4 would point its
    // lines at a sentence it never cited, so only `claim-moved` may repair
    // it, and that needs a run which names it.
    const label = write("moved-below.md", [
      "---",
      "title: Limits",
      "citations:",
      "  - id: timeouts",
      "    claim:",
      `      integrity: ${CLAIM_RETRIES}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "  - id: retries",
      "    claim:",
      "      lines: 3",
      `      integrity: ${hashLines("Retries default to 3.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "# Limits",
      "",
      "The fetch timeout is 10 seconds.",
      "<!-- cite timeouts -->",
      "Retries default to 3.",
    ]);
    const run = await update({ inputs: [label], only: ["timeouts"] });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.end, r.reason])).toEqual([
      ["timeouts", "marker", "re-anchored"],
      ["timeouts", "claim", "re-anchored"],
    ]);
    // Its own lines are untouched, waiting for a run that names it.
    expect(onDisk(label)).toContain("      lines: 3\n");
  });

  it("shifts a claim-lines entry the move pushes down, in the same write", async () => {
    misplaced("shift.md");
    const run = await update({ inputs: [label("shift.md")] });
    expect(run).toMatchObject({ rewritten: 2, skipped: 0, exitCode: 0 });
    expect(
      run.pages[0]?.rewritten.map((r) => [r.id, r.end, r.reason, r.from, r.to]),
    ).toEqual([
      ["timeouts", "marker", "re-anchored", "23", "22"],
      [
        "timeouts",
        "claim",
        "re-anchored",
        hashLines("Retries default to 3."),
        hashLines("The fetch timeout is 10 seconds.\nRetries default to 3."),
      ],
      ["page-order", "claim", "shifted", "22", "23"],
    ]);
    expect(onDisk(label("shift.md"))).toContain("      lines: 4\n");
    expect(await ends(label("shift.md"))).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  it("keeps a marker whose move would change another entry's claim", async () => {
    misplaced("claim-across.md");
    const before = onDisk(label("claim-across.md"));
    const run = await update({ inputs: [label("claim-across.md")] });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => f.message)).toEqual([
      "timeouts: the marker at line 23 stays, because moving it would change the claim of retries (lines 22-24).",
    ]);
    expect(onDisk(label("claim-across.md"))).toBe(before);
  });

  it("moves a quote marker down to its block and leaves its pin alone", async () => {
    misplaced("quote-mid.md");
    const before = onDisk(label("quote-mid.md"));
    const run = await update({ inputs: [label("quote-mid.md")] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.from, r.to])).toEqual([
      ["marker", "16", "18"],
    ]);
    const lines = bodyOf("quote-mid.md");
    expect(lines.slice(14, 19)).toEqual([
      "Retries are configured once.",
      "The value lives in the source.",
      "",
      "<!-- cite retries-block -->",
      "```ts",
    ]);
    // The claim pin is the block's, and the block did not move.
    expect(onDisk(label("quote-mid.md")).split("\n")[6]).toBe(before.split("\n")[6]);
    expect(await ends(label("quote-mid.md"))).toEqual([["current", "current"]]);
  });

  it("re-pins a marker in place whose pin covered a sibling marker line", async () => {
    misplaced("pre-43-sibling-pin.mdx");
    const run = await update({ inputs: [label("pre-43-sibling-pin.mdx")] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "host-scope",
        index: 0,
        line: 4,
        end: "claim",
        reason: "re-anchored",
        status: "moved",
        from: hashLines("{/* cite host-list */}\nOnly the start URL's host is crawled."),
        to: hashLines("Only the start URL's host is crawled."),
        fromPin: hashLines("{/* cite host-list */}\nOnly the start URL's host is crawled."),
        toPin: hashLines("Only the start URL's host is crawled."),
        lines: "22-23",
        newLines: "23",
      },
    ]);
    // The markers stay where they are: they were never misplaced.
    expect(bodyOf("pre-43-sibling-pin.mdx").slice(20, 23)).toEqual([
      "{/* cite host-scope */}",
      "{/* cite host-list */}",
      "Only the start URL's host is crawled.",
    ]);
    expect(await ends(label("pre-43-sibling-pin.mdx"))).toEqual([
      ["current", "current"],
      ["current", "current"],
    ]);
  });

  it("keeps an orphan marker in a run, and an anchor-invalid entry's marker", async () => {
    const orphan = write("orphan-run.md", [
      "---",
      "title: Limits",
      "---",
      "The fetch timeout is 10 seconds.",
      "<!-- cite nobody -->",
      "Retries default to 3.",
    ]);
    const orphanRun = await update({ inputs: [orphan] });
    expect(orphanRun.pages[0]?.skipped.map((f) => [f.rule, f.message])).toEqual([
      ["marker-orphan", 'no entry has id "nobody"'],
      [
        "marker-misplaced",
        "the marker at line 5 stays, because it names no entry update can check.",
      ],
    ]);
    expect(orphanRun.exitCode).toBe(1);

    const both = write("anchor-both-run.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    claim:",
      "      lines: 1",
      `      integrity: ${CLAIM_10}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "The fetch timeout is 10 seconds.",
      "<!-- cite fetch-timeout -->",
      "Retries default to 3.",
    ]);
    const bothRun = await update({ inputs: [both] });
    expect(bothRun.pages[0]?.skipped.map((f) => [f.rule, f.message])).toEqual([
      ["anchor-invalid", "fetch-timeout has claim lines and a marker. Keep one."],
      [
        "marker-misplaced",
        "fetch-timeout: the marker at line 13 stays, because the entry also has claim lines. Keep one.",
      ],
    ]);
  });

  it("writes the page and the manifest that owns the entry, each once", async () => {
    workspace();
    mkdirSync(join(cwd, "docs"));
    const held = hashLines("Retries default to 3.");
    writeFileSync(
      join(cwd, "manni.config.yaml"),
      [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./citations.yaml",
        "        keys: [citations]",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "citations.yaml"),
      [
        "docs/limits.md:",
        "  citations:",
        "    - id: retries",
        "      claim:",
        `        integrity: ${held}`,
        "      source:",
        "        file: src/limits.ts",
        "        lines: 3",
        `        integrity: ${PIN_L3}`,
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "docs", "limits.md"),
      [
        "---",
        "title: Limits",
        "---",
        "The fetch timeout is 10 seconds.",
        "<!-- cite retries -->",
        "Retries default to 3.",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = join(cwd, "manni.config.yaml");
    const run = await update({ inputs: [], noConfig: false, configPath: config });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.manifests?.map((m) => [m.file, m.written])).toEqual([["citations.yaml", true]]);
    expect(onDisk("docs/limits.md").split("\n").slice(3, 6)).toEqual([
      "<!-- cite retries -->",
      "The fetch timeout is 10 seconds.",
      "Retries default to 3.",
    ]);
    expect(onDisk("citations.yaml")).toContain(
      hashLines("The fetch timeout is 10 seconds.\nRetries default to 3."),
    );
    expect(await ends("docs/limits.md", config)).toEqual([["current", "current"]]);
  });

  it("prints a stdin page with its markers moved, and writes nothing", async () => {
    workspace();
    const run = await update({
      inputs: ["-"],
      as: "mdx",
      stdinContent: readFileSync(join(MISPLACED, "mid-paragraph.mdx"), "utf8"),
    });
    expect(run.pages[0]).toMatchObject({ file: "<stdin>", written: false });
    expect(run.pages[0]?.content?.split("\n")[13]).toBe("{/* cite fresh-context */}");
  });

  it("shows every move in the diff under --dry-run and writes nothing", async () => {
    misplaced("mid-paragraph.mdx");
    const before = onDisk(label("mid-paragraph.mdx"));
    const run = await update({ inputs: [label("mid-paragraph.mdx")], dryRun: true });
    expect(run.pages[0]?.written).toBe(false);
    expect(run.pages[0]?.diff).toContain("+{/* cite fresh-context */}");
    expect(run.pages[0]?.diff).toContain("-{/* cite fresh-context */}");
    expect(onDisk(label("mid-paragraph.mdx"))).toBe(before);
  });
});

describe("runUpdate: a write that fails halfway", () => {
  /**
   * A family whose manifest cannot be written: the file is read-only, which
   * stops the rename on Windows, and its directory is too, which stops it on
   * Linux and macOS.
   */
  function locked(): { config: string; manifest: string; dir: string } {
    workspace();
    mkdirSync(join(cwd, "docs"));
    mkdirSync(join(cwd, "meta"));
    writeFileSync(
      join(cwd, "manni.config.yaml"),
      [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./meta/citations.yaml",
        "        keys: [citations]",
        "",
      ].join("\n"),
      "utf8",
    );
    const manifest = join(cwd, "meta", "citations.yaml");
    writeFileSync(
      manifest,
      [
        "docs/limits.md:",
        "  citations:",
        "    - id: retries",
        "      claim:",
        `        integrity: ${hashLines("Retries default to 3.")}`,
        "      source:",
        "        file: src/limits.ts",
        "        lines: 3",
        `        integrity: ${PIN_L3}`,
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(cwd, "docs", "limits.md"),
      [
        "---",
        "title: Limits",
        "---",
        "The fetch timeout is 10 seconds.",
        "<!-- cite retries -->",
        "Retries default to 3.",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(manifest, 0o444);
    chmodSync(join(cwd, "meta"), 0o555);
    return { config: join(cwd, "manni.config.yaml"), manifest, dir: join(cwd, "meta") };
  }

  /**
   * Two collections, a manifest each, a misplaced-marker page each. Only the
   * second manifest is locked, so the run writes the first one and then
   * fails: the state a restore has to undo on both.
   */
  function twoCollections(): { config: string; manifest: string; dir: string } {
    workspace();
    const lines = [
      "collections:",
      ...["one", "two"].flatMap((name) => [
        `  - name: ${name}`,
        `    paths: ["${name}/**/*.md"]`,
        "    externalMetadata:",
        `      - file: ./meta-${name}/citations.yaml`,
        "        keys: [citations]",
      ]),
      "",
    ];
    writeFileSync(join(cwd, "manni.config.yaml"), lines.join("\n"), "utf8");
    for (const name of ["one", "two"]) {
      mkdirSync(join(cwd, name));
      mkdirSync(join(cwd, `meta-${name}`));
      writeFileSync(
        join(cwd, `meta-${name}`, "citations.yaml"),
        [
          `${name}/limits.md:`,
          "  citations:",
          "    - id: retries",
          "      claim:",
          `        integrity: ${hashLines("Retries default to 3.")}`,
          "      source:",
          "        file: src/limits.ts",
          "        lines: 3",
          `        integrity: ${PIN_L3}`,
          "",
        ].join("\n"),
        "utf8",
      );
      // The marker splits the paragraph, so the run moves it and re-pins the
      // claim over the whole paragraph, writing the page and the manifest.
      writeFileSync(
        join(cwd, name, "limits.md"),
        [
          "---",
          "title: Limits",
          "---",
          "The fetch timeout is 10 seconds.",
          "<!-- cite retries -->",
          "Retries default to 3.",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    const manifest = join(cwd, "meta-two", "citations.yaml");
    chmodSync(manifest, 0o444);
    chmodSync(join(cwd, "meta-two"), 0o555);
    return { config: join(cwd, "manni.config.yaml"), manifest, dir: join(cwd, "meta-two") };
  }

  it("restores the manifest it already wrote, not only the pages", async () => {
    const { config, manifest, dir } = twoCollections();
    const before = {
      one: onDisk("meta-one/citations.yaml"),
      two: onDisk("meta-two/citations.yaml"),
      pageOne: onDisk("one/limits.md"),
      pageTwo: onDisk("two/limits.md"),
    };
    try {
      const message = await refusal(update({ inputs: [], noConfig: false, configPath: config }));
      expect(message).toContain("meta-two/citations.yaml could not be written");
      expect(message).toContain("meta-one/citations.yaml");
      // Nothing is left pinned to text no page holds any more.
      expect(onDisk("meta-one/citations.yaml")).toBe(before.one);
      expect(onDisk("meta-two/citations.yaml")).toBe(before.two);
      expect(onDisk("one/limits.md")).toBe(before.pageOne);
      expect(onDisk("two/limits.md")).toBe(before.pageTwo);
    } finally {
      chmodSync(dir, 0o755);
      chmodSync(manifest, 0o644);
    }
  });

  it("restores the page it already wrote, and names the file that failed", async () => {
    const { config, manifest, dir } = locked();
    const before = onDisk("docs/limits.md");
    try {
      const message = await refusal(update({ inputs: [], noConfig: false, configPath: config }));
      expect(message).toContain("meta/citations.yaml could not be written");
      expect(message).toContain("docs/limits.md was restored.");
      // The marker is back where it was, so the pin in the manifest still holds.
      expect(onDisk("docs/limits.md")).toBe(before);
    } finally {
      chmodSync(dir, 0o755);
      chmodSync(manifest, 0o644);
    }
  });
});
