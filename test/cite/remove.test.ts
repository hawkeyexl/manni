/**
 * `runRemove` against temp copies of the fixture pages.
 *
 * Removal is the inverse of `add`: the entry goes out of the frontmatter or
 * out of the manifest that owns it, every marker naming it goes out of the
 * body, and the claim lines below each removed marker move up one, in the
 * same write. So each case ends by checking the page again: whatever the
 * removal caused has to be gone, and nothing else may have appeared.
 *
 * `remove-shift.md` is the fixture for the shift: a marker-anchored entry
 * above a claim-lines entry, so taking the first out moves the second. The
 * runs inject `noGit()`, as check.test.ts does, and pass their own `env`, so a
 * developer's `MANNI_ENCRYPTION_KEY` is never read.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  copyFileSync,
  cpSync,
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
import { runCheck } from "../../src/cite/commands/check.js";
import { runRemove } from "../../src/cite/commands/remove.js";
import { noGit } from "../../src/cite/core/git.js";
import { CiteError } from "../../src/cite/errors.js";
import { renderRemoveJson } from "../../src/cite/reporters/json.js";
import { renderRemovePretty } from "../../src/cite/reporters/pretty.js";
import type { RemoveOptions, RemoveRun } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SIDECAR = join(here, "..", "fixtures", "cite-sidecar");

let cwd = "";
function workspace(...pages: string[]): void {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-remove-"));
  mkdirSync(join(cwd, "pages"));
  for (const name of pages) copyFileSync(join(PAGES, name), join(cwd, "pages", name));
}
/** A throwaway copy of the sidecar fixture, for the manifest cases. */
function sidecarWorkspace(): void {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-remove-"));
  cpSync(SIDECAR, cwd, { recursive: true });
}
function write(name: string, lines: string[]): string {
  if (cwd === "") workspace();
  writeFileSync(join(cwd, "pages", name), lines.join("\n") + "\n", "utf8");
  return `pages/${name}`;
}
/**
 * A page written byte for byte, for the cases where the bytes are the point:
 * CRLF terminators, and a last line with no terminator at all.
 */
function writeRaw(name: string, content: string): string {
  if (cwd === "") workspace();
  writeFileSync(join(cwd, "pages", name), content, "utf8");
  return `pages/${name}`;
}
const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function remove(over: Partial<RemoveOptions> & { inputs: string[]; only: string[] }): Promise<RemoveRun> {
  return runRemove({ cwd, root: ROOT, noConfig: true, gitClient: noGit(), env: {}, ...over });
}

/** Every finding `check` reports on a page now. */
async function findings(label: string, over: Record<string, unknown> = {}): Promise<string[]> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    gitClient: noGit(),
    env: {},
    inputs: [label],
    noConfig: true,
    ...over,
  });
  return (run.pages[0]?.findings ?? []).map((f) => f.rule);
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

const manifestOf = (rel = "citations.yaml"): Record<string, { citations?: unknown[] }> =>
  parseYaml(readFileSync(join(cwd, rel), "utf8")) as Record<string, { citations?: unknown[] }>;

describe("runRemove: an entry in the page's frontmatter", () => {
  it("removes a claim-lines entry and leaves the body alone", async () => {
    workspace("current.md");
    const before = onDisk("pages/current.md");
    const run = await remove({ inputs: ["pages/current.md"], only: ["fetch-timeout"] });
    expect(run.removed).toBe(1);
    const [page] = run.pages;
    expect(page?.file).toBe("pages/current.md");
    expect(page?.written).toBe(true);
    expect(page?.removed).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        origin: { kind: "frontmatter", file: "pages/current.md", line: 4 },
        markerLines: [],
      },
    ]);
    const after = onDisk("pages/current.md");
    expect(after).not.toContain("citations");
    expect(after).toContain("title: Limits");
    // The body is untouched, byte for byte.
    expect(after.slice(after.indexOf("# Limits"))).toBe(before.slice(before.indexOf("# Limits")));
    expect(await findings("pages/current.md")).toEqual([]);
  });

  it("removes a marker-anchored entry and its marker line", async () => {
    workspace("marker.md");
    const run = await remove({ inputs: ["pages/marker.md"], only: ["retries"] });
    expect(run.removed).toBe(1);
    expect(run.pages[0]?.removed).toEqual([
      {
        id: "retries",
        index: 0,
        origin: { kind: "frontmatter", file: "pages/marker.md", line: 4 },
        markerLines: [18],
      },
    ]);
    const after = onDisk("pages/marker.md");
    expect(after).not.toContain("<!-- cite retries -->");
    expect(after).toContain("Retries default to 3. Really.");
    expect(await findings("pages/marker.md")).toEqual([]);
  });

  /** Two entries under one marker, and a claim-lines entry below them. */
  const shared = (name: string): string =>
    write(name, [
      "---",
      "title: Limits",
      "citations:",
      "  - id: retries",
      "    claim:",
      "      integrity: sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d",
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      "      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3",
      "  - id: backoff",
      "    claim:",
      "      integrity: sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d",
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      "      integrity: sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f",
      "---",
      "# Limits",
      "",
      "<!-- cite retries backoff -->",
      "Retries default to 3.",
    ]);

  it("drops one id out of a marker and leaves the line where it was", async () => {
    const label = shared("shared-marker.md");
    expect(await findings(label)).toEqual([]);
    const run = await remove({ inputs: [label], only: ["retries"] });
    expect(run.removed).toBe(1);
    expect(run.pages[0]?.removed[0]?.markerLines).toEqual([21]);
    const after = onDisk(label);
    expect(after).toContain("<!-- cite backoff -->\nRetries default to 3.");
    expect(after).not.toContain("retries");
    expect(await findings(label)).toEqual([]);
  });

  it("drops the whole line when the last id goes out of the marker", async () => {
    const label = shared("shared-last.md");
    const run = await remove({ inputs: [label], only: ["retries", "backoff"] });
    expect(run.removed).toBe(2);
    const after = onDisk(label);
    expect(after).not.toContain("cite");
    expect(after).toContain("# Limits\n\nRetries default to 3.\n");
    expect(await findings(label)).toEqual([]);
  });

  it("removes a bare pin by its pointer, since it has no id to name", async () => {
    workspace("whole-file.md");
    const run = await remove({ inputs: ["pages/whole-file.md"], only: ["/citations/0"] });
    expect(run.removed).toBe(1);
    expect(run.pages[0]?.removed).toEqual([
      {
        index: 0,
        origin: { kind: "frontmatter", file: "pages/whole-file.md", line: 4 },
        markerLines: [],
      },
    ]);
    expect(onDisk("pages/whole-file.md")).not.toContain("src/limits.ts");
    expect(await findings("pages/whole-file.md")).toEqual([]);
  });

  it("moves the claim lines below a removed marker up one, in the same write", async () => {
    workspace("remove-shift.md");
    expect(await findings("pages/remove-shift.md")).toEqual([]);
    const run = await remove({ inputs: ["pages/remove-shift.md"], only: ["retries"] });
    expect(run.removed).toBe(1);
    const after = onDisk("pages/remove-shift.md");
    expect(after).not.toContain("<!-- cite retries -->");
    // The surviving entry's claim was body line 6 and is now body line 5.
    expect(after).toContain("      lines: 5\n");
    expect(after).toContain("The fetch timeout is 10 seconds.");
    // Nothing the removal caused survives it: the claim still pins its line.
    expect(await findings("pages/remove-shift.md")).toEqual([]);
  });

  it("keeps the other entries when one of several goes", async () => {
    workspace("remove-shift.md");
    const run = await remove({ inputs: ["pages/remove-shift.md"], only: ["fetch-timeout"] });
    expect(run.removed).toBe(1);
    const after = onDisk("pages/remove-shift.md");
    expect(after).toContain("id: retries");
    expect(after).not.toContain("id: fetch-timeout");
    // The marker of the entry that stayed is still there.
    expect(after).toContain("<!-- cite retries -->");
    expect(await findings("pages/remove-shift.md")).toEqual([]);
  });

  it("removes a marker that names no entry, which clears marker-orphan", async () => {
    workspace("marker-orphan.md");
    expect(await findings("pages/marker-orphan.md")).toEqual(["marker-orphan"]);
    const run = await remove({ inputs: ["pages/marker-orphan.md"], only: ["nope"] });
    expect(run.removed).toBe(1);
    expect(run.pages[0]?.removed).toEqual([{ id: "nope", markerLines: [12] }]);
    const after = onDisk("pages/marker-orphan.md");
    expect(after).not.toContain("<!-- cite nope -->");
    expect(after).toContain("id: fetch-timeout");
    expect(await findings("pages/marker-orphan.md")).toEqual([]);
  });

  it("takes several ids across several pages in one run", async () => {
    workspace("current.md", "marker.md");
    const run = await remove({
      inputs: ["pages"],
      only: ["fetch-timeout", "retries"],
    });
    expect(run.removed).toBe(2);
    expect(run.pages.map((p) => [p.file, p.removed.length, p.written])).toEqual([
      ["pages/current.md", 1, true],
      ["pages/marker.md", 1, true],
    ]);
  });

  it("collapses a repeated --only, so one entry is one removal", async () => {
    workspace("marker.md");
    const run = await remove({ inputs: ["pages/marker.md"], only: ["retries", "retries"] });
    expect(run.removed).toBe(1);
    expect(run.pages[0]?.removed).toHaveLength(1);
  });

  it("takes a pointer from the pages that have it and skips the ones that do not", async () => {
    workspace("remove-shift.md", "current.md");
    // remove-shift.md carries two entries; current.md carries one, so
    // `/citations/1` names something on the first page only.
    const run = await remove({ inputs: ["pages"], only: ["/citations/1"] });
    expect(run.removed).toBe(1);
    expect(run.pages.map((p) => [p.file, p.removed.length, p.written])).toEqual([
      ["pages/current.md", 0, false],
      ["pages/remove-shift.md", 1, true],
    ]);
    expect(onDisk("pages/current.md")).toContain("id: fetch-timeout");
    expect(onDisk("pages/remove-shift.md")).not.toContain("id: fetch-timeout");
    expect(await findings("pages/remove-shift.md")).toEqual([]);
    expect(await findings("pages/current.md")).toEqual([]);
  });

  it("--dry-run prints the diff and writes nothing", async () => {
    workspace("marker.md");
    const before = onDisk("pages/marker.md");
    const run = await remove({ inputs: ["pages/marker.md"], only: ["retries"], dryRun: true });
    expect(run.removed).toBe(1);
    const [page] = run.pages;
    expect(page?.written).toBe(false);
    expect(page?.diff).toContain("-<!-- cite retries -->");
    expect(page?.diff).toContain("-  - id: retries");
    expect(onDisk("pages/marker.md")).toBe(before);
  });

  it("hands the rewritten page back for the stdin input, which has no file", async () => {
    workspace();
    const content = readFileSync(join(PAGES, "current.md"), "utf8");
    const run = await remove({
      inputs: ["-"],
      as: "markdown",
      stdinContent: content,
      only: ["fetch-timeout"],
    });
    expect(run.removed).toBe(1);
    const [page] = run.pages;
    expect(page?.file).toBe("<stdin>");
    // Nowhere to write it, so the caller prints what the run made.
    expect(page?.written).toBe(false);
    expect(page?.content).toContain("title: Limits");
    expect(page?.content).not.toContain("citations");
  });
});

/**
 * A marker line is deleted whole, terminator included, and a CRLF page has
 * two bytes of terminator rather than one. The pages here are written byte
 * for byte rather than from a fixture, because the bytes are what is under
 * test: the three positions a marker can sit in, and a last line with no
 * terminator after it.
 */
describe("runRemove: a marker line on a CRLF page", () => {
  /** An orphan marker at the top, the middle and the end of one body. */
  const lines = ["# Limits", "", "Retries default to 3.", "", "<!-- cite nope -->"];

  it("takes the whole terminator above it when the marker is the last line", async () => {
    const label = writeRaw("crlf-last.md", lines.join("\r\n"));
    const run = await remove({ inputs: [label], only: ["nope"] });
    expect(run.removed).toBe(1);
    // A last line with no terminator of its own takes the terminator above
    // it instead, both bytes of it. No orphaned CR is left behind, and the
    // page reads as it did before the marker was ever added.
    expect(onDisk(label)).toBe("# Limits\r\n\r\nRetries default to 3.\r\n");
  });

  it("does the same on an LF page, which is where the rule comes from", async () => {
    const label = writeRaw("lf-last.md", lines.join("\n"));
    const run = await remove({ inputs: [label], only: ["nope"] });
    expect(run.removed).toBe(1);
    expect(onDisk(label)).toBe("# Limits\n\nRetries default to 3.\n");
  });

  it("takes the terminator with it when the marker is the first line", async () => {
    const label = writeRaw("crlf-first.md", ["<!-- cite nope -->", ...lines.slice(0, 3)].join("\r\n") + "\r\n");
    const run = await remove({ inputs: [label], only: ["nope"] });
    expect(run.removed).toBe(1);
    expect(onDisk(label)).toBe("# Limits\r\n\r\nRetries default to 3.\r\n");
  });

  it("takes the terminator with it when the marker is in the middle", async () => {
    const label = writeRaw(
      "crlf-middle.md",
      ["# Limits", "", "<!-- cite nope -->", "Retries default to 3.", ""].join("\r\n"),
    );
    const run = await remove({ inputs: [label], only: ["nope"] });
    expect(run.removed).toBe(1);
    expect(onDisk(label)).toBe("# Limits\r\n\r\nRetries default to 3.\r\n");
  });
});

describe("runRemove: an entry in the manifest that owns it", () => {
  it("removes it there, and leaves the page byte for byte", async () => {
    sidecarWorkspace();
    const before = readFileSync(join(cwd, "pages", "limits.md"), "utf8");
    const run = await runRemove({
      cwd,
      inputs: ["pages/limits.md"],
      only: ["fetch-timeout"],
      gitClient: noGit(),
      env: {},
    });
    expect(run.removed).toBe(1);
    const [page] = run.pages;
    expect(page?.removed).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        origin: { kind: "manifest", file: "citations.yaml", line: 5 },
        markerLines: [],
      },
    ]);
    // The page never held the entry, so there was nothing to write to it.
    expect(page?.written).toBe(false);
    expect(readFileSync(join(cwd, "pages", "limits.md"), "utf8")).toBe(before);
    expect(manifestOf()["pages/limits.md"]).toBeUndefined();
    // The other pages' entries, and the manifest's comments, are untouched.
    const text = readFileSync(join(cwd, "citations.yaml"), "utf8");
    expect(text).toContain("pages/moved.md:");
    expect(text).toContain("# The site collection's citations, keyed by page path");
    expect(run.manifests).toEqual([
      { file: "citations.yaml", diff: expect.any(String), written: true },
    ]);
  });

  it("--dry-run leaves the manifest alone", async () => {
    sidecarWorkspace();
    const before = readFileSync(join(cwd, "citations.yaml"), "utf8");
    const run = await runRemove({
      cwd,
      inputs: ["pages/limits.md"],
      only: ["fetch-timeout"],
      dryRun: true,
      gitClient: noGit(),
      env: {},
    });
    expect(run.removed).toBe(1);
    expect(run.manifests?.[0]?.written).toBe(false);
    expect(run.manifests?.[0]?.diff).toContain("-    - id: fetch-timeout");
    expect(readFileSync(join(cwd, "citations.yaml"), "utf8")).toBe(before);
  });
});

describe("runRemove: refusals", () => {
  it("refuses a run with no --only", async () => {
    workspace("current.md");
    expect(await refusal(remove({ inputs: ["pages/current.md"], only: [] }))).toBe(
      "remove needs --only <id>; it never removes every citation on a page.",
    );
    expect(onDisk("pages/current.md")).toContain("id: fetch-timeout");
  });

  it("refuses an id no page carries, and writes nothing", async () => {
    workspace("current.md");
    expect(
      await refusal(remove({ inputs: ["pages/current.md"], only: ["retries"] })),
    ).toBe("pages/current.md has no entry or marker retries.");
    expect(onDisk("pages/current.md")).toContain("id: fetch-timeout");
  });

  it("names the page count when the run covered several", async () => {
    workspace("current.md", "marker.md");
    expect(await refusal(remove({ inputs: ["pages"], only: ["page-size"] }))).toBe(
      "none of 2 pages has an entry or marker page-size.",
    );
  });

  it("refuses a pointer past the last entry", async () => {
    workspace("current.md");
    expect(
      await refusal(remove({ inputs: ["pages/current.md"], only: ["/citations/9"] })),
    ).toBe('"/citations/9" is past the last entry of pages/current.md (1 entry).');
  });

  it("refuses a marker whose line carries text as well", async () => {
    const label = write("inline.md", [
      "---",
      "title: Limits",
      "citations:",
      "  - id: retries",
      "    claim:",
      "      integrity: sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d",
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      "      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3",
      "---",
      "# Limits",
      "",
      "<!-- cite retries --> Retries default to 3.",
    ]);
    expect(await refusal(remove({ inputs: [label], only: ["retries"] }))).toBe(
      "the marker retries at pages/inline.md:14 shares its line with text; remove it by hand.",
    );
    expect(onDisk(label)).toContain("<!-- cite retries --> Retries default to 3.");
  });

  it("refuses a marker line inside another entry's claim", async () => {
    const label = write("straddle.md", [
      "---",
      "title: Limits",
      "citations:",
      "  - id: retries",
      "    claim:",
      "      integrity: sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d",
      "    source:",
      "      file: src/limits.ts",
      "      lines: 3",
      "      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3",
      "  - id: block",
      "    claim:",
      "      lines: 2-5",
      "      integrity: sha256-0000000000000000000000000000000000000000000000000000000000000000",
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      "      integrity: sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f",
      "---",
      "# Limits",
      "",
      "<!-- cite retries -->",
      "Retries default to 3.",
    ]);
    expect(await refusal(remove({ inputs: [label], only: ["retries"] }))).toBe(
      "pages/straddle.md:22 is inside the claim of block (lines 21-24). Removing the marker there would change its pin.",
    );
    expect(onDisk(label)).toContain("<!-- cite retries -->");
  });

  it("refuses a run with no inputs and no config", async () => {
    workspace("current.md");
    expect(await refusal(remove({ inputs: [], only: ["fetch-timeout"] }))).toBe(
      "No files to remove. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });
});

describe("remove reporters", () => {
  it("pretty names the entry, where it was kept, and its marker", async () => {
    workspace("marker.md");
    const run = await remove({ inputs: ["pages/marker.md"], only: ["retries"] });
    expect(renderRemovePretty(run, { color: false })).toBe(
      [
        "pages/marker.md: removed retries from frontmatter, and its marker at line 18",
        "1 citation removed from 1 file",
      ].join("\n"),
    );
  });

  it("pretty says when a marker named no entry", async () => {
    workspace("marker-orphan.md");
    const run = await remove({ inputs: ["pages/marker-orphan.md"], only: ["nope"] });
    expect(renderRemovePretty(run, { color: false })).toContain(
      "pages/marker-orphan.md: removed the marker nope at line 12, which named no entry",
    );
  });

  it("pretty says a dry run would remove, and prints the diff", async () => {
    workspace("current.md", "marker.md");
    const run = await remove({ inputs: ["pages"], only: ["fetch-timeout", "retries"], dryRun: true });
    const text = renderRemovePretty(run, { color: false, showDiff: true, dryRun: true });
    expect(text).toContain("--- pages/current.md");
    expect(text).toMatch(/^2 citations would be removed from 2 files$/m);
  });

  it("json prints the pages, each removal, and the total", async () => {
    workspace("marker.md");
    const run = await remove({ inputs: ["pages/marker.md"], only: ["retries"] });
    const parsed = JSON.parse(renderRemoveJson(run)) as {
      removed: number;
      pages: { file: string; written: boolean; removed: { id?: string; markerLines: number[] }[] }[];
    };
    expect(parsed.removed).toBe(1);
    expect(parsed.pages[0]?.file).toBe("pages/marker.md");
    expect(parsed.pages[0]?.written).toBe(true);
    expect(parsed.pages[0]?.removed[0]).toEqual({
      id: "retries",
      index: 0,
      origin: { kind: "frontmatter", file: "pages/marker.md", line: 4 },
      markerLines: [18],
    });
  });
});

/**
 * Proposal 0056 widened the marker payload to a list. The corpus already
 * holds thousands of one-id markers written under 0044, and none of them may
 * change meaning, move, or be rewritten into the new form. This is the bar
 * the proposal calls its acceptance test.
 */
describe("a marker written under proposal 0044", () => {
  it("still checks clean, byte for byte as the page holds it", async () => {
    workspace("marker.md");
    const before = onDisk("pages/marker.md");
    expect(await findings("pages/marker.md")).toEqual([]);
    expect(before).toContain("<!-- cite retries -->");
    // A check writes nothing, so the one-id spelling is still on the page.
    expect(onDisk("pages/marker.md")).toBe(before);
  });

  it("still goes out whole when its entry is removed, with the claim below it moving up", async () => {
    workspace("remove-shift.md");
    const before = onDisk("pages/remove-shift.md").split("\n");
    expect(before.filter((line) => line.includes("cite retries"))).toEqual([
      "<!-- cite retries -->",
    ]);
    const run = await remove({ inputs: ["pages/remove-shift.md"], only: ["retries"] });
    expect(run.removed).toBe(1);
    const after = onDisk("pages/remove-shift.md").split("\n");
    // One line fewer in the body, and the surviving claim moved up with it.
    // Seven lines of entry, and the marker line.
    expect(after.length).toBe(before.length - 8);
    expect(after).not.toContain("<!-- cite retries -->");
    expect(onDisk("pages/remove-shift.md")).toContain("      lines: 5\n");
    expect(await findings("pages/remove-shift.md")).toEqual([]);
  });


});
