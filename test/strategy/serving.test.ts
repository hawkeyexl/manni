/**
 * Whom each page serves, and the impact roll-up built over findings on those
 * pages (proposal 0105). The lookup reads the cite impact fixture; the
 * roll-up and its printed lines are tested on sets built inline.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StrategyError,
  impactLines,
  impactNotice,
  impactOf,
  loadServing,
  servesSentence,
  type ImpactEntry,
  type ServingSet,
  type StrategyRecord,
} from "../../src/strategy/index.js";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "cite", "impact");

function record(type: StrategyRecord["type"], id: string, extra: Partial<StrategyRecord> = {}): StrategyRecord {
  return { id, type, file: `strategy/${id}.md`, line: 1, parents: [], data: {}, ...extra };
}

const ids = (records: readonly StrategyRecord[] | undefined): string[] => (records ?? []).map((r) => r.id);

let tmp: string | undefined;
afterEach(async () => {
  if (tmp !== undefined) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("loadServing", () => {
  it("keys each page by absolute path, personas first, values without a record left out", async () => {
    const serving = await loadServing({ cwd: FIXTURE, configPath: join(FIXTURE, "manni.config.yaml") });
    if (serving === undefined) throw new Error("expected a serving set");
    const stale = serving.pages.get(join(FIXTURE, "pages", "stale.md"));
    // M5 groups with m5 ignoring case; m99 names no record.
    expect(ids(stale)).toEqual(["maya", "m5"]);
    expect(serving.pages.has(join(FIXTURE, "pages", "unnamed.md"))).toBe(false);
    expect(ids(serving.pages.get(join(FIXTURE, "pages", "clean.md")))).toEqual(["maya", "m6"]);
    // A record's own fields name nobody.
    expect(serving.pages.has(join(FIXTURE, "strategy", "m5.md"))).toBe(false);
  });

  it("maps each named page's {page} manifest to the page, so a finding there counts on it (0109)", async () => {
    const serving = await loadServing({ cwd: FIXTURE, configPath: join(FIXTURE, "manni.config.yaml") });
    expect(serving?.manifests.get(join(FIXTURE, "pages", "stale.meta.yaml"))).toBe(join(FIXTURE, "pages", "stale.md"));
    // A page that names nobody has no manifest to map, and a record file is no page.
    expect(serving?.manifests.has(join(FIXTURE, "pages", "unnamed.meta.yaml"))).toBe(false);
    expect(serving?.manifests.has(join(FIXTURE, "strategy", "m5.md"))).toBe(false);
  });

  it("counts journeys: only when a journey record exists", async () => {
    const serving = await loadServing({ cwd: FIXTURE, configPath: join(FIXTURE, "manni.personas-only.yaml") });
    expect(ids(serving?.pages.get(join(FIXTURE, "pages", "stale.md")))).toEqual(["maya"]);
  });

  it("returns nothing when no collection is declared, or none holds a persona or journey", async () => {
    tmp = await mkdtemp(join(tmpdir(), "manni-serving-"));
    await writeFile(join(tmp, "manni.config.yaml"), "tools:\n  vale:\n    config: .vale.ini\n");
    expect(await loadServing({ cwd: tmp, configPath: join(tmp, "manni.config.yaml") })).toBeUndefined();
    await writeFile(join(tmp, "manni.config.yaml"), 'collections:\n  - name: site\n    paths: ["*.md"]\n');
    await writeFile(join(tmp, "a.md"), "---\ntype: audience\n---\n");
    await writeFile(join(tmp, "b.md"), "---\ntitle: B\naudiences: [a]\n---\n");
    expect(await loadServing({ cwd: tmp, configPath: join(tmp, "manni.config.yaml") })).toBeUndefined();
  });

  it("throws strategy's own error when its section is broken", async () => {
    await expect(loadServing({ cwd: FIXTURE, configPath: join(FIXTURE, "manni.bad-strategy.yaml") })).rejects.toThrow(
      StrategyError,
    );
    await expect(
      loadServing({ cwd: FIXTURE, configPath: join(FIXTURE, "manni.bad-strategy.yaml") }),
    ).rejects.toThrow('manni.bad-strategy.yaml: strategy does not carry "paths". Name a collection under collections:.');
  });
});

describe("impactOf", () => {
  const maya = record("persona", "maya", { title: "Maya" });
  const devin = record("persona", "devin", { title: "Devin" });
  const d5 = record("journey", "d5", { title: "Gate" });
  const d18 = record("journey", "d18", { title: "Number" });
  const m2 = record("journey", "m2", { title: "Draft one", lifecycle: "draft" });
  const serving: ServingSet = {
    records: [maya, devin, d5, d18, m2],
    pages: new Map([
      ["/a.md", [maya, d18, m2]],
      ["/b.md", [devin, d5]],
      ["/c.md", [devin, d18]],
    ]),
    manifests: new Map(),
  };

  it("runs personas first, then journeys, worst first, drafts last, ties by id with numeric collation", () => {
    const entries = impactOf(serving, [
      { page: "/a.md", file: "a.md", severity: "error" },
      { page: "/a.md", file: "a.md", severity: "error" },
      { page: "/a.md", file: "a.md", severity: "error" },
      { page: "/b.md", file: "b.md", severity: "warning" },
      { page: "/c.md", file: "c.md", severity: "notice" },
      { page: "/z.md", file: "z.md", severity: "error" },
    ]);
    expect(entries.map((e) => `${e.type}:${e.id}`)).toEqual([
      "persona:maya",
      "persona:devin",
      "journey:d18",
      "journey:d5",
      "journey:m2",
    ]);
    const d18Entry = entries.find((e) => e.id === "d18");
    expect(d18Entry).toEqual({
      type: "journey",
      id: "d18",
      title: "Number",
      findings: 4,
      errors: 3,
      warnings: 0,
      notices: 1,
      pages: ["a.md", "c.md"],
    });
    expect(entries.find((e) => e.id === "m2")?.lifecycle).toBe("draft");
    // The worse page wins over the larger count: errors outrank warnings.
    expect(entries.find((e) => e.id === "devin")).toMatchObject({ errors: 0, warnings: 1, notices: 1, findings: 2 });
  });

  it("is empty when no finding's page names a record", () => {
    expect(impactOf(serving, [{ page: "/z.md", file: "z.md", severity: "error" }])).toEqual([]);
  });

  it("ties on severity break by id, numerically", () => {
    const entries = impactOf(serving, [
      { page: "/b.md", file: "b.md", severity: "error" },
      { page: "/c.md", file: "c.md", severity: "error" },
    ]);
    expect(entries.filter((e) => e.type === "journey").map((e) => e.id)).toEqual(["d5", "d18"]);
  });
});

describe("servesSentence", () => {
  it("joins id (title) values as a sentence, bare ids where a record has no title", () => {
    expect(servesSentence([record("persona", "maya", { title: "Maya" })])).toBe("Serves maya (Maya).");
    expect(servesSentence([record("persona", "maya", { title: "Maya" }), record("journey", "m5")])).toBe(
      "Serves maya (Maya) and m5.",
    );
    expect(
      servesSentence([record("persona", "a", { title: "A" }), record("persona", "b"), record("journey", "c", { title: "C" })]),
    ).toBe("Serves a (A), b and c (C).");
    expect(servesSentence([])).toBeUndefined();
  });
});

describe("impactLines", () => {
  it("prints the heading and one padded row per entry", () => {
    expect(
      impactLines([
        { type: "persona", id: "devin", title: "Devin, Platform", findings: 3, errors: 3, warnings: 0, notices: 0, pages: ["a", "b"] },
        { type: "persona", id: "sara", findings: 2, errors: 1, warnings: 1, notices: 0, pages: ["a"] },
        { type: "journey", id: "d5", title: "Gate", findings: 1, errors: 0, warnings: 0, notices: 1, pages: ["a"] },
        { type: "journey", id: "m2", title: "Draft", lifecycle: "draft", findings: 3, errors: 1, warnings: 1, notices: 1, pages: ["a"] },
      ]),
    ).toEqual([
      "The pages with findings serve 2 personas and 2 journeys.",
      "  devin   Devin, Platform   3 errors on 2 pages",
      "  sara                      1 error and 1 warning on 1 page",
      "  d5      Gate              1 notice on 1 page",
      "  m2      Draft (draft)     1 error, 1 warning and 1 notice on 1 page",
    ]);
  });

  it("names only the types present", () => {
    expect(
      impactLines([
        { type: "journey", id: "m5", title: "Pin", findings: 1, errors: 1, warnings: 0, notices: 0, pages: ["a"] },
        { type: "journey", id: "m6", title: "Keep", lifecycle: "archived", findings: 1, errors: 1, warnings: 0, notices: 0, pages: ["a"] },
      ])[0],
    ).toBe("The pages with findings serve 2 journeys.");
    expect(
      impactLines([{ type: "persona", id: "maya", findings: 1, errors: 1, warnings: 0, notices: 0, pages: ["a"] }])[0],
    ).toBe("The pages with findings serve 1 persona.");
    expect(impactLines([])).toEqual([]);
  });
});

describe("impactNotice", () => {
  it("carries the heading as its title and one unpadded row per entry, in the same order and words", () => {
    const entries: ImpactEntry[] = [
      { type: "persona", id: "devin", title: "Devin, Platform", findings: 3, errors: 3, warnings: 0, notices: 0, pages: ["a", "b"] },
      { type: "persona", id: "sara", findings: 2, errors: 1, warnings: 1, notices: 0, pages: ["a"] },
      { type: "journey", id: "m2", title: "Draft", lifecycle: "draft", findings: 1, errors: 1, warnings: 0, notices: 0, pages: ["a"] },
    ];
    expect(impactNotice(entries)).toEqual({
      title: "The pages with findings serve 2 personas and 1 journey.",
      lines: [
        "devin Devin, Platform: 3 errors on 2 pages",
        "sara: 1 error and 1 warning on 1 page",
        "m2 Draft (draft): 1 error on 1 page",
      ],
    });
    expect(impactNotice(entries)?.title).toBe(impactLines(entries)[0]);
    expect(impactNotice([])).toBeUndefined();
  });
});
