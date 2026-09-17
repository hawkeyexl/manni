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
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";
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
    expect(onDisk(label)).toBe(before);
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
    workspace("moved.md", "claim-changed.md");
    const notices: string[] = [];
    await update({
      inputs: ["pages/moved.md", "pages/claim-changed.md"],
      accept: true,
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([]);
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
