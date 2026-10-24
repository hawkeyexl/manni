/**
 * A journey's `steps:` (proposal 0106): each step's `doc` resolves to a page
 * of the run, and the step gets one state. Inline sets cover every row of the
 * state table; the steps fixture covers reading the field and its lines.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RouteMapping } from "../../src/graph/core/config.js";
import { loadStrategy } from "../../src/strategy/commands/run.js";
import { coverageOf, resolveSteps, stepsNeedRoutes } from "../../src/strategy/core/steps.js";
import type { StrategyRecord, StrategySet, StrategyStep } from "../../src/strategy/types.js";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "strategy", "steps");

const ROUTES: RouteMapping[] = [{ basePath: "/site", root: "docs", extensions: [".md"], indexFiles: ["index"] }];

function step(fields: Partial<StrategyStep>, n = 1): StrategyStep {
  return { n, file: "strategy/journeys/m1.md", line: 6 + n, ...fields };
}

function journey(steps: StrategyStep[], extra: Partial<StrategyRecord> = {}): StrategyRecord {
  return { id: "m1", type: "journey", file: "strategy/journeys/m1.md", line: 1, parents: [], steps, ...extra };
}

/** `docs/guide.md` names m1; `docs/reference.md` names nothing. */
function setWith(steps: StrategyStep[], extra: Partial<StrategyRecord> = {}): StrategySet {
  return {
    records: [journey(steps, extra)],
    references: [{ field: "journeys", value: "m1", file: "docs/guide.md", line: 2, page: "docs/guide.md", record: false }],
    pages: ["docs/guide.md", "docs/reference.md"],
  };
}

/** The one step's state and page. */
function stateOf(fields: Partial<StrategyStep>, routes: RouteMapping[] = ROUTES): { state: string; page?: string } {
  const set = setWith([step(fields)]);
  const [record] = set.records;
  const resolved = record === undefined ? undefined : resolveSteps(set, { routes }).get(record)?.[0];
  if (resolved === undefined) throw new Error("no step resolved");
  return { state: resolved.state, ...(resolved.page === undefined ? {} : { page: resolved.page }) };
}

describe("resolveSteps: the state table", () => {
  it.each([undefined, true, false] as const)("a doc naming a page that names the journey is served (exists %s)", (exists) => {
    expect(stateOf({ doc: "docs/guide.md", ...(exists === undefined ? {} : { exists }) })).toEqual({
      state: "served",
      page: "docs/guide.md",
    });
  });

  it.each([undefined, true, false] as const)("a doc naming a page that does not is unclaimed (exists %s)", (exists) => {
    expect(stateOf({ doc: "docs/reference.md", ...(exists === undefined ? {} : { exists }) })).toEqual({
      state: "unclaimed",
      page: "docs/reference.md",
    });
  });

  it.each(["docs/guide.md", "docs/reference.md"])("exists: partial on a page is partial, whatever %s names", (doc) => {
    expect(stateOf({ doc, exists: "partial" })).toEqual({ state: "partial", page: doc });
  });

  it("a doc naming no page with exists: false is unwritten", () => {
    expect(stateOf({ doc: "docs/tutorial.md", exists: false })).toEqual({ state: "unwritten" });
  });

  it.each([undefined, false] as const)("no doc is unwritten (exists %s)", (exists) => {
    expect(stateOf(exists === undefined ? {} : { exists })).toEqual({ state: "unwritten" });
  });

  it.each([undefined, true, "partial"] as const)("a doc naming no page is broken (exists %s)", (exists) => {
    expect(stateOf({ doc: "docs/gide.md", ...(exists === undefined ? {} : { exists }) })).toEqual({ state: "broken" });
  });

  it.each([true, "partial"] as const)("no doc with exists: %s is broken", (exists) => {
    expect(stateOf({ exists })).toEqual({ state: "broken" });
  });

  it.each([undefined, true, "partial"] as const)("a scheme URL is unchecked (exists %s)", (exists) => {
    expect(stateOf({ doc: "https://example.com/blog/", ...(exists === undefined ? {} : { exists }) })).toEqual({
      state: "unchecked",
    });
  });

  it("a scheme URL with exists: false is unwritten", () => {
    expect(stateOf({ doc: "https://example.com/blog/", exists: false })).toEqual({ state: "unwritten" });
  });
});

describe("resolveSteps: how a doc resolves", () => {
  it("resolves a / route through the routes, directory index first", () => {
    expect(stateOf({ doc: "/site/guide/" })).toEqual({ state: "served", page: "docs/guide.md" });
  });

  it("calls a mapped route with no file broken, and unwritten when exists: false", () => {
    expect(stateOf({ doc: "/site/tutorial/" })).toEqual({ state: "broken" });
    expect(stateOf({ doc: "/site/tutorial/", exists: false })).toEqual({ state: "unwritten" });
  });

  it("leaves a route no mapping covers unchecked", () => {
    expect(stateOf({ doc: "/elsewhere/guide/" })).toEqual({ state: "unchecked" });
  });

  it("leaves every route unchecked when there are no routes", () => {
    expect(stateOf({ doc: "/site/guide/" }, [])).toEqual({ state: "unchecked" });
  });

  it("drops an anchor and a query before resolving", () => {
    expect(stateOf({ doc: "docs/guide.md#config" })).toEqual({ state: "served", page: "docs/guide.md" });
    expect(stateOf({ doc: "/site/guide/?tab=ci#x" })).toEqual({ state: "served", page: "docs/guide.md" });
  });

  it("needs a repo path to name the file exactly", () => {
    expect(stateOf({ doc: "docs/Guide.md" })).toEqual({ state: "broken" });
    expect(stateOf({ doc: "docs/guide" })).toEqual({ state: "broken" });
  });

  it("resolves a repo path from the config directory onto the run's base", () => {
    const set = setWith([step({ doc: "docs/guide.md" })]);
    set.pages = ["guide.md"];
    set.references = [{ field: "journeys", value: "m1", file: "guide.md", line: 2, page: "guide.md", record: false }];
    const [record] = set.records;
    if (record === undefined) throw new Error("no record");
    const from = resolve("/repo");
    const [resolved] = resolveSteps(set, { from, base: resolve(from, "docs") }).get(record) ?? [];
    expect(resolved).toMatchObject({ state: "served", page: "guide.md" });
  });

  it("never counts a record as a step's page", () => {
    const set = setWith([step({ doc: "strategy/journeys/m1.md" })]);
    const [record] = set.records;
    if (record === undefined) throw new Error("no record");
    expect(resolveSteps(set).get(record)?.[0]?.state).toBe("broken");
  });
});

describe("coverageOf", () => {
  it("counts served steps over steps, leaving partial, unclaimed and unchecked out", () => {
    const set = setWith([
      step({ doc: "docs/guide.md" }, 1),
      step({ doc: "docs/guide.md", exists: "partial" }, 2),
      step({ doc: "docs/reference.md" }, 3),
      step({ doc: "https://example.com/" }, 4),
      step({}, 5),
    ]);
    const [record] = set.records;
    if (record === undefined) throw new Error("no record");
    expect(coverageOf(resolveSteps(set, { routes: ROUTES }).get(record) ?? [])).toEqual({ served: 1, steps: 5 });
  });
});

describe("stepsNeedRoutes", () => {
  it("is true only when some step names a / route", () => {
    expect(stepsNeedRoutes(setWith([step({ doc: "docs/guide.md" }), step({ doc: "https://x.test/" })]))).toBe(false);
    expect(stepsNeedRoutes(setWith([step({ doc: "/site/guide/" })]))).toBe(true);
  });
});

describe("loading steps from the fixture", () => {
  it("reads each step with its fields and lines, numbered from 1 in the order written", async () => {
    const { set } = await loadStrategy({ cwd: FIXTURE, inputs: [] });
    const m1 = set.records.find((r) => r.id === "m1");
    expect(m1?.steps?.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m1?.steps?.[2]).toMatchObject({
      n: 3,
      stage: "Go deeper in the guide",
      doc: "docs/guide.md#config",
      exists: "partial",
      note: "Covers the config half only.",
      line: 11,
      docAt: { line: 12 },
      existsAt: { line: 13 },
    });
    expect(m1?.steps?.[7]).toEqual({ n: 8, stage: "Write a tutorial", file: "strategy/journeys/m1.md", line: 25 });
    expect(set.pages).toContain("docs/reference.md");
    expect(set.pages).not.toContain("strategy/journeys/m1.md");
  });

  it("resolves every state the fixture holds, the route through graph.routes", async () => {
    const { set, steps } = await loadStrategy({ cwd: FIXTURE, inputs: [] });
    const m1 = set.records.find((r) => r.id === "m1");
    if (m1 === undefined) throw new Error("no m1");
    expect(steps.get(m1)?.map((s) => s.state)).toEqual([
      "served",
      "served",
      "partial",
      "unclaimed",
      "broken",
      "served",
      "unwritten",
      "unwritten",
      "unchecked",
    ]);
    expect(steps.get(m1)?.[1]?.page).toBe("docs/ci/index.md");
  });

  it("rebases the routes and the repo paths for a positional run below the config", async () => {
    const cwd = resolve(FIXTURE, "docs");
    const { set, steps } = await loadStrategy({ cwd, inputs: [".", "../strategy"] });
    const m1 = set.records.find((r) => r.id === "m1");
    if (m1 === undefined) throw new Error("no m1");
    expect(steps.get(m1)?.slice(0, 2).map((s) => [s.state, s.page])).toEqual([
      ["served", "guide.md"],
      ["served", "ci/index.md"],
    ]);
  });

  it("reads an empty steps: [] and a non-list as no steps, and skips items that are not mappings", async () => {
    const set: StrategySet = { records: [journey([])], references: [], pages: [] };
    const [record] = set.records;
    if (record === undefined) throw new Error("no record");
    expect(resolveSteps(set).get(record)).toEqual([]);
    const { set: loaded } = await loadStrategy({ cwd: FIXTURE, inputs: ["strategy/"] });
    expect(loaded.records.find((r) => r.type === "persona")?.steps).toBeUndefined();
  });
});
