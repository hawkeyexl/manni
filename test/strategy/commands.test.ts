/**
 * The `manni strategy` command cores and reporters (proposal 0102), against
 * small trees written per test and the sidecar fixture.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/strategy/commands/check.js";
import { runGet } from "../../src/strategy/commands/get.js";
import { runList } from "../../src/strategy/commands/list.js";
import { formatChoice } from "../../src/strategy/commands/run.js";
import { StrategyError } from "../../src/strategy/errors.js";
import { renderFindingsGithub } from "../../src/strategy/reporters/github.js";
import { renderFindingsJson, renderGetJson, renderListJson } from "../../src/strategy/reporters/json.js";
import { renderFindingsJunit } from "../../src/strategy/reporters/junit.js";
import { countsLine, renderFindingsPretty, renderGetPretty, renderListPretty } from "../../src/strategy/reporters/pretty.js";
import { renderFindingsSarif } from "../../src/strategy/reporters/sarif.js";

const gitOnPath = spawnSync("git", ["--version"]).status === 0;

const FIXTURES = resolve(import.meta.dirname, "..", "fixtures", "strategy");

const CONFIG = 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n  - name: strategy\n    paths: ["strategy/**/*.md"]\n';

function page(fields: Record<string, string>): string {
  return ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), "---", ""].join("\n");
}

const RECORDS: Record<string, string> = {
  "strategy/audiences/docs-engineers.md": page({ type: "audience", title: "Docs-as-code teams" }),
  "strategy/personas/maya.md": page({ type: "persona", title: "Maya, Documentation Engineer", description: "Owns the repo.", audience: "docs-engineers" }),
  "strategy/journeys/m2.md": page({ type: "journey", id: "m2", title: "Tighten the standard", personas: "[maya]" }),
  "strategy/journeys/m10.md": page({ type: "journey", id: "m10", title: "Keep the gate green", personas: "[maya]" }),
};

let tmp: string | undefined;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function tree(spec: Record<string, string>): Promise<string> {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-strategy-cmd-")));
  for (const [rel, content] of Object.entries(spec)) {
    const p = join(tmp, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
  return tmp;
}

async function docset(extra: Record<string, string> = {}): Promise<string> {
  return tree({
    "manni.config.yaml": CONFIG,
    ...RECORDS,
    "docs/guide.md": page({ title: "Guide", audiences: "[docs-engineers]", personas: "[maya]", journeys: "[m2, m10]" }),
    ...extra,
  });
}

describe("formatChoice", () => {
  it("refuses an unknown format with the expected list", () => {
    expect(() => formatChoice("xml", ["pretty", "json"])).toThrow(new StrategyError('unknown format "xml". Expected pretty | json.'));
  });
});

describe("list", () => {
  it("lists the records as a tree, parents first and siblings in natural order", async () => {
    const cwd = await docset();
    const { entries } = await runList({ cwd, inputs: [] });
    expect(entries.map((e) => [e.depth, e.record.id])).toEqual([
      [0, "docs-engineers"],
      [1, "maya"],
      [2, "m2"],
      [2, "m10"],
    ]);
    expect(renderListPretty(entries)).toBe(
      [
        "record            pages  title",
        "docs-engineers        1  Docs-as-code teams",
        "  maya                1  Maya, Documentation Engineer",
        "    m2                1  Tighten the standard",
        "    m10               1  Keep the gate green",
        "1 audience, 1 persona, 2 journeys",
      ].join("\n"),
    );
  });

  it("puts a record whose parent is not in the set at the top, and falls back to the id for a title", async () => {
    const cwd = await docset({ "strategy/journeys/x1.md": page({ type: "journey", personas: "[nobody]" }) });
    const { entries } = await runList({ cwd, inputs: [] });
    const orphan = entries.find((e) => e.record.id === "x1");
    expect(orphan?.depth).toBe(0);
    expect(entries.at(-1)?.record.id).toBe("x1");
    expect(renderListPretty(entries).split("\n")).toContain("x1                    0  x1");
  });

  it("files a journey with two personas under each, and counts it once", async () => {
    const cwd = await docset({
      "strategy/personas/sara.md": page({ type: "persona", title: "Sara, Schema Author", audience: "docs-engineers" }),
      "strategy/journeys/m5.md": page({ type: "journey", id: "m5", title: "Share a schema", personas: "[maya, sara]" }),
    });
    const { entries } = await runList({ cwd, inputs: [] });
    expect(entries.map((e) => [e.depth, e.record.id])).toEqual([
      [0, "docs-engineers"],
      [1, "maya"],
      [2, "m2"],
      [2, "m5"],
      [2, "m10"],
      [1, "sara"],
      [2, "m5"],
    ]);
    expect(renderListPretty(entries).split("\n").at(-1)).toBe("1 audience, 2 personas, 3 journeys");
    const json = JSON.parse(renderListJson(entries)) as { records: { id: string; personas?: string[] }[] };
    expect(json.records.map((r) => r.id)).toEqual(["docs-engineers", "maya", "m2", "m5", "m10", "sara"]);
    expect(json.records.find((r) => r.id === "m5")?.personas).toEqual(["maya", "sara"]);
  });

  it("returns { records } in json, each with namedBy", async () => {
    const cwd = await docset();
    const { entries } = await runList({ cwd, inputs: [] });
    const json = JSON.parse(renderListJson(entries)) as { records: Record<string, unknown>[] };
    expect(json.records[0]).toEqual({
      id: "docs-engineers",
      type: "audience",
      title: "Docs-as-code teams",
      file: "strategy/audiences/docs-engineers.md",
      line: 1,
      namedBy: { personas: ["maya"], pages: ["docs/guide.md"] },
    });
    expect(json.records[1]).toMatchObject({ id: "maya", audience: "docs-engineers", namedBy: { journeys: ["m2", "m10"] } });
  });

  it("pluralises the counts", () => {
    expect(countsLine([])).toBe("0 audiences, 0 personas, 0 journeys");
  });
});

describe("get", () => {
  it("matches the id without case and shows its parent, children and pages", async () => {
    const cwd = await docset();
    const entry = await runGet({ cwd, inputs: [], id: "MAYA" });
    expect(renderGetPretty(entry, { color: false })).toBe(
      [
        "Maya, Documentation Engineer                  strategy/personas/maya.md:1",
        "  type          persona",
        "  id            maya",
        "  description   Owns the repo.",
        "  audience      docs-engineers  Docs-as-code teams",
        "  journeys      m2   Tighten the standard",
        "                m10  Keep the gate green",
        "  pages         docs/guide.md",
      ].join("\n"),
    );
  });

  it("prints none when no page names the record, and the journey's json", async () => {
    const cwd = await docset({ "docs/guide.md": page({ title: "Guide" }) });
    const entry = await runGet({ cwd, inputs: [], id: "m2" });
    expect(renderGetPretty(entry, { color: false }).split("\n").at(-1)).toBe("  pages         none");
    expect(JSON.parse(renderGetJson(entry))).toEqual({
      id: "m2",
      type: "journey",
      title: "Tighten the standard",
      file: "strategy/journeys/m2.md",
      line: 1,
      personas: ["maya"],
      namedBy: { pages: [] },
    });
  });

  it("shows a lifecycle row and key when the record sets one", async () => {
    const cwd = await docset({
      "strategy/journeys/m2.md": page({ type: "journey", id: "m2", title: "Tighten the standard", personas: "[maya]", lifecycle: "draft" }),
    });
    const entry = await runGet({ cwd, inputs: [], id: "m2" });
    expect(renderGetPretty(entry, { color: false }).split("\n").slice(1, 4)).toEqual([
      "  type          journey",
      "  id            m2",
      "  lifecycle     draft",
    ]);
    expect(JSON.parse(renderGetJson(entry))).toMatchObject({ id: "m2", lifecycle: "draft" });
    const { entries } = await runList({ cwd, inputs: [] });
    const json = JSON.parse(renderListJson(entries)) as { records: Record<string, unknown>[] };
    expect(json.records.find((r) => r["id"] === "m2")).toHaveProperty("lifecycle", "draft");
    expect(json.records.find((r) => r["id"] === "m10")).not.toHaveProperty("lifecycle");
  });

  it("lists every persona of a journey, one per line", async () => {
    const cwd = await docset({
      "strategy/personas/sara.md": page({ type: "persona", title: "Sara, Schema Author", audience: "docs-engineers" }),
      "strategy/journeys/m5.md": page({ type: "journey", id: "m5", title: "Share a schema", personas: "[maya, sara, nobody]" }),
    });
    const entry = await runGet({ cwd, inputs: [], id: "m5" });
    expect(renderGetPretty(entry, { color: false }).split("\n").slice(3, 6)).toEqual([
      "  personas      maya    Maya, Documentation Engineer",
      "                sara    Sara, Schema Author",
      "                nobody",
    ]);
  });

  it("refuses a miss, with the nearest id when one is near", async () => {
    const cwd = await docset();
    await expect(runGet({ cwd, inputs: [], id: "m3" })).rejects.toThrow('no record "m3". 4 records; did you mean "m2"?');
    await expect(runGet({ cwd, inputs: [], id: "zzzzzz" })).rejects.toThrow('no record "zzzzzz". 4 records.');
  });

  it("gives paths relative to where it was run, from a subdirectory", async () => {
    const cwd = await docset();
    // A git root is where config discovery stops walking up.
    await mkdir(join(cwd, ".git"));
    const entry = await runGet({ cwd: join(cwd, "docs"), inputs: [], id: "m2" });
    expect(entry.file).toBe("../strategy/journeys/m2.md");
    expect(entry.pages).toEqual(["guide.md"]);
  });
});

describe("check", () => {
  it("is clean on a joined-up set", async () => {
    const cwd = await docset();
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.findings).toEqual([]);
    // Four page values, maya's audience and each journey's one persona: a
    // journey's personas: is its parent field, counted once, not twice.
    expect(renderFindingsPretty(report, { color: false })).toBe("✓ 4 records, 7 references, no findings");
  });

  it("reads a sidecar's values and files a finding at the sidecar's line", async () => {
    const report = await runCheck({ cwd: join(FIXTURES, "sidecars"), inputs: [] });
    expect(report.findings.map((f) => [f.rule, f.file, f.line])).toEqual([
      ["missing-parent", "docs/guide.meta.yaml", 3],
      ["undefined-reference", "docs/guide.meta.yaml", 4],
    ]);
  });

  it("reads stdin alongside the named paths", async () => {
    const cwd = await docset();
    const report = await runCheck({
      cwd,
      inputs: ["strategy", "-"],
      as: "markdown",
      stdin: page({ title: "Piped", journeys: "[m9]" }),
    });
    expect(report.findings.map((f) => [f.rule, f.file])).toContainEqual(["undefined-reference", "<stdin>"]);
  });

  it("refuses stdin without --as, and a run with no records", async () => {
    const cwd = await docset();
    await expect(runCheck({ cwd, inputs: ["-"], stdin: "" })).rejects.toThrow(
      "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
    );
    await expect(runCheck({ cwd, inputs: ["docs"] })).rejects.toThrow(
      "no strategy records found. A record is a page declaring type: audience, type: persona or type: journey.",
    );
    const empty = await runCheck({ cwd, inputs: ["docs"], allowEmpty: true });
    expect(renderFindingsPretty(empty, { color: false })).toBe("✓ 0 records, 4 references, no findings");
  });

  it("honours strategy.allowEmpty and strategy.severity", async () => {
    const cwd = await docset({
      "manni.config.yaml": `${CONFIG}strategy:\n  allowEmpty: true\n  severity:\n    unserved-journey: error\n`,
      "docs/guide.md": page({ title: "Guide", audiences: "[docs-engineers]", personas: "[maya]", journeys: "[m2]" }),
    });
    expect((await runCheck({ cwd, inputs: ["docs"] })).records).toBe(0);
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.findings.map((f) => [f.rule, f.severity])).toEqual([["unserved-journey", "error"]]);
    expect(report.summary.failed).toBe(1);
  });

  it.skipIf(!gitOnPath)("skips what .gitignore covers, unless strategy.respectGitignore or --no-gitignore says not to", async () => {
    const cwd = await docset({ ".gitignore": "strategy/journeys/m10.md\n" });
    execSync("git init -q", { cwd });
    expect((await runCheck({ cwd, inputs: [] })).records).toBe(3);
    expect((await runCheck({ cwd, inputs: [], noGitignore: true })).records).toBe(4);
    await writeFile(join(cwd, "manni.config.yaml"), `${CONFIG}strategy:\n  respectGitignore: false\n`);
    expect((await runCheck({ cwd, inputs: [] })).records).toBe(4);
  });

  it("records a baseline, then suppresses what it holds", async () => {
    const cwd = await docset({ "docs/guide.md": page({ title: "Guide" }) });
    const first = await runCheck({ cwd, inputs: [], baseline: true });
    expect(renderFindingsPretty(first, { color: false })).toMatch(/^✓ \d+ findings recorded in \.manni-strategy-baseline\.json$/);
    expect(existsSync(join(cwd, ".manni-strategy-baseline.json"))).toBe(true);
    const again = await runCheck({ cwd, inputs: [], baseline: true });
    expect(again.findings).toEqual([]);
    expect(renderFindingsPretty(again, { color: false })).toBe(
      `✓ 4 records, 3 references, no findings, ${String(first.found)} baselined`,
    );
  });

  it("compares a configured baseline without the flag, and refuses one that is missing", async () => {
    const cwd = await docset({ "manni.config.yaml": `${CONFIG}strategy:\n  baseline: .manni-strategy-baseline.json\n` });
    await expect(runCheck({ cwd, inputs: [] })).rejects.toThrow(
      'Baseline ".manni-strategy-baseline.json" not found. Record one with `manni strategy check --baseline`.',
    );
    await runCheck({ cwd, inputs: [], baseline: true });
    expect(JSON.parse(await readFile(join(cwd, ".manni-strategy-baseline.json"), "utf8"))).toBeTypeOf("object");
  });
});

describe("steps", () => {
  const STEPS = join(FIXTURES, "steps");

  it("get shows a steps row after personas and before pages: coverage, then each step with its page and note", async () => {
    const entry = await runGet({ cwd: STEPS, inputs: [], id: "m1" });
    expect(entry.coverage).toEqual({ served: 3, steps: 9 });
    const lines = renderGetPretty(entry, { color: false }).split("\n");
    const start = lines.indexOf("  steps         3 of 9 served");
    expect(lines[start - 1]).toMatch(/^ {2}personas {6}maya/);
    expect(lines.slice(start, start + 20)).toEqual([
      "  steps         3 of 9 served",
      "                1  served     Read the guide",
      "                              docs/guide.md",
      "                2  served     Add the CI step",
      "                              docs/ci/index.md",
      "                3  partial    Go deeper in the guide",
      "                              docs/guide.md",
      "                              Covers the config half only.",
      "                4  unclaimed  Look up a flag",
      "                              docs/reference.md",
      "                5  broken     Follow the walkthrough",
      "                              docs/gide.md",
      "                6  served     Keep the gate green",
      "                              docs/ci/index.md",
      "                7  unwritten  Work through the tutorial",
      "                              /site/tutorial/",
      "                8  unwritten  Write a tutorial",
      "                9  unchecked  Read how a team adopted it",
      "                              https://example.com/blog/adopting",
      "  pages         docs/ci/index.md",
    ]);
  });

  it("get dims the page and note lines in colour", async () => {
    const entry = await runGet({ cwd: STEPS, inputs: [], id: "m1" });
    expect(renderGetPretty(entry, { color: true })).toContain("\u001b[2mdocs/gide.md\u001b[22m");
  });

  it("json carries steps and coverage after personas and before namedBy", async () => {
    const entry = await runGet({ cwd: STEPS, inputs: [], id: "m1" });
    const json = JSON.parse(renderGetJson(entry)) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["id", "type", "title", "file", "line", "personas", "steps", "coverage", "namedBy"]);
    const steps = json["steps"] as Record<string, unknown>[];
    expect(steps[0]).toEqual({ stage: "Read the guide", doc: "docs/guide.md", line: 7, state: "served", page: "docs/guide.md" });
    expect(steps[2]).toEqual({
      stage: "Go deeper in the guide",
      doc: "docs/guide.md#config",
      exists: "partial",
      note: "Covers the config half only.",
      line: 11,
      state: "partial",
      page: "docs/guide.md",
    });
    expect(steps[6]).toEqual({ stage: "Work through the tutorial", doc: "/site/tutorial/", exists: false, line: 22, state: "unwritten" });
    expect(steps[7]).toEqual({ stage: "Write a tutorial", line: 25, state: "unwritten" });
    expect(json["coverage"]).toEqual({ served: 3, steps: 9 });
  });

  it("gives step pages relative to where it was run", async () => {
    const entry = await runGet({ cwd: join(STEPS, "docs"), inputs: [], id: "m1" });
    expect(entry.steps?.[1]?.page).toBe("ci/index.md");
  });

  it("list gains a steps column only when some journey has steps", async () => {
    const { entries } = await runList({ cwd: STEPS, inputs: [] });
    expect(renderListPretty(entries).split("\n").slice(0, 5)).toEqual([
      "record            pages  steps  title",
      "docs-engineers        2         Docs-as-code teams",
      "  maya                2         Maya, Documentation Engineer",
      "    m1                2    3/9  Stand up metadata validation for my repo",
      "    m2                0    0/1  Tighten the standard without breaking the build",
    ]);
    const json = JSON.parse(renderListJson(entries)) as { records: Record<string, unknown>[] };
    expect(json.records.find((r) => r["id"] === "m1")?.["coverage"]).toEqual({ served: 3, steps: 9 });
    expect(json.records.find((r) => r["id"] === "maya")).not.toHaveProperty("steps");
    expect(json.records.find((r) => r["id"] === "maya")).not.toHaveProperty("coverage");
  });

  it("reads steps: [] and items that are not mappings as no steps, and numbers steps by position", async () => {
    const cwd = await docset({
      "strategy/journeys/m2.md": "---\ntype: journey\nid: m2\ntitle: Tighten the standard\npersonas: [maya]\nsteps: []\n---\n",
      "strategy/journeys/m10.md":
        "---\ntype: journey\nid: m10\ntitle: Keep the gate green\npersonas: [maya]\nsteps:\n  - just a string\n  - stage: 3\n    doc: docs/guide.md\n    exists: maybe\n---\n",
    });
    const m2 = await runGet({ cwd, inputs: [], id: "m2" });
    expect(m2.steps).toBeUndefined();
    expect(JSON.parse(renderGetJson(m2))).not.toHaveProperty("steps");
    const m10entry = await runGet({ cwd, inputs: [], id: "m10" });
    expect(m10entry.steps?.map((s) => s.n)).toEqual([2]);
    const m10 = JSON.parse(renderGetJson(m10entry)) as { steps: unknown[] };
    expect(m10.steps).toEqual([{ doc: "docs/guide.md", line: 8, state: "served", page: "docs/guide.md" }]);
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.findings).toEqual([]);
  });

  it("check counts the steps in its summary and its clean line, and files each finding at its line", async () => {
    const report = await runCheck({ cwd: STEPS, inputs: [] });
    expect(report.steps).toBe(10);
    expect(report.findings.map((f) => [f.rule, f.severity, f.line])).toEqual([
      ["missing-journey", "warning", 16],
      ["broken-step", "error", 18],
      ["stale-step", "warning", 21],
      ["unwritten-step", "notice", 22],
      ["unwritten-step", "notice", 25],
    ]);
    const json = JSON.parse(renderFindingsJson(report)) as { summary: Record<string, unknown> };
    expect(Object.keys(json.summary)).toEqual(["records", "references", "steps", "errors", "warnings", "notices"]);
    expect(json.summary["steps"]).toBe(10);

    const quiet = await stepsCopy(
      "strategy:\n  severity:\n    broken-step: off\n    stale-step: off\n    missing-journey: off\n    unwritten-step: off\n",
    );
    const clean = await runCheck({ cwd: quiet, inputs: [] });
    expect(renderFindingsPretty(clean, { color: false })).toMatch(/^✓ 4 records, \d+ references, 10 steps, no findings$/);
  });

  it("keeps a set without steps to today's summary keys", async () => {
    const report = await runCheck({ cwd: await docset(), inputs: [] });
    const json = JSON.parse(renderFindingsJson(report)) as { summary: Record<string, unknown> };
    expect(json.summary).not.toHaveProperty("steps");
  });

  it("never reads graph: when no step names a / route", async () => {
    const cwd = await docset({
      "manni.config.yaml": `${CONFIG}graph:\n  routes:\n    - basePath: /site\n`,
      "strategy/journeys/m2.md":
        "---\ntype: journey\nid: m2\ntitle: Tighten the standard\npersonas: [maya]\nsteps:\n  - stage: Read it\n    doc: docs/guide.md\n---\n",
    });
    expect((await runCheck({ cwd, inputs: [] })).findings).toEqual([]);
  });

  it("refuses an invalid graph: section with graph's own message once a step names a / route", async () => {
    const cwd = await docset({
      "manni.config.yaml": `${CONFIG}graph:\n  routes:\n    - basePath: /site\n`,
      "strategy/journeys/m2.md":
        "---\ntype: journey\nid: m2\ntitle: Tighten the standard\npersonas: [maya]\nsteps:\n  - stage: Read it\n    doc: /site/guide/\n---\n",
    });
    await expect(runCheck({ cwd, inputs: [] })).rejects.toThrow(/Invalid config in .*manni\.config\.yaml:\n {2}\/graph\/routes\/0: must have required property 'root'/);
  });
});

/** A copy of the steps fixture in the temp tree, its config with more appended. */
async function stepsCopy(extra: string): Promise<string> {
  const dir = await tree({});
  await cp(join(FIXTURES, "steps"), dir, { recursive: true });
  const path = join(dir, "manni.config.yaml");
  await writeFile(path, `${await readFile(path, "utf8")}${extra}`);
  return dir;
}

describe("check reporters", () => {
  async function failing() {
    return runCheck({ cwd: join(FIXTURES, "failing"), inputs: [] });
  }

  it("pretty groups findings under file:line, with the guidance beneath, and counts each level", async () => {
    const text = renderFindingsPretty(await failing(), { color: false });
    const lines = text.split("\n");
    expect(lines[0]).toBe("docs/guide.md:5");
    expect(lines[1]).toMatch(/^ {2}warning manni:strategy\/missing-parent {7}personas: does not name "maya"/);
    expect(text).toContain(`${" ".repeat(46)}manni:strategy missing-parent: A page names a journey`);
    expect(text).toContain(`${" ".repeat(46)}Guide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#missing-parent`);
    expect(lines.at(-1)).toBe("3 errors, 3 warnings, 1 notice in 7 records");
  });

  it("json carries term's shape, and never the baseline key", async () => {
    const json = JSON.parse(renderFindingsJson(await failing())) as {
      findings: Record<string, unknown>[];
      summary: Record<string, unknown>;
    };
    expect(json.summary).toMatchObject({ records: 7, errors: 3, warnings: 3, notices: 1 });
    expect(Object.keys(json.summary)).toEqual(["records", "references", "errors", "warnings", "notices"]);
    expect(json.findings[0]).toEqual({
      rule: "missing-parent",
      ruleId: "manni:strategy/missing-parent",
      severity: "warning",
      message: 'personas: does not name "maya", the persona of journey "m1". Add it, or drop "m1" from journeys:.',
      guidance: {
        id: "manni:strategy",
        rule: "missing-parent",
        description: "A page names a journey but none of its personas in personas:, or a persona but not its audience in audiences:.",
        guide: "https://hawkeyexl.github.io/manni/strategy/reference/rules/#missing-parent",
      },
      file: "docs/guide.md",
      line: 5,
      field: "personas",
    });
    for (const finding of json.findings) expect(finding).not.toHaveProperty("key");
  });

  it("github prints one workflow command per finding, the colon escaped", async () => {
    const lines = renderFindingsGithub(await failing()).split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/^::warning file=docs\/guide\.md,line=5,title=manni%3Astrategy\/missing-parent::personas: /);
    expect(lines[0]).toContain("%0AGuide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#missing-parent");
  });

  it("sarif describes each rule in its own words and links its section", async () => {
    const sarif = JSON.parse(renderFindingsSarif(await failing())) as {
      runs: {
        tool: { driver: { informationUri: string; rules: { id: string; shortDescription: { text: string }; helpUri?: string }[] } };
        results: { ruleId: string; message: { text: string } }[];
      }[];
    };
    const run = sarif.runs[0];
    expect(run?.tool.driver.informationUri).toBe("https://hawkeyexl.github.io/manni/strategy/");
    expect(run?.tool.driver.rules.map((r) => r.helpUri).sort()).toEqual(
      ["duplicate-id", "missing-parent", "orphan-record", "undefined-reference", "unserved-journey", "unused-record"].map(
        (rule) => `https://hawkeyexl.github.io/manni/strategy/reference/rules/#${rule}`,
      ),
    );
    for (const result of run?.results ?? []) expect(result.message.text).not.toMatch(/^(\(root\)|\/\w+) /);
  });

  it("junit carries the classname and the finding's own message", async () => {
    const junit = renderFindingsJunit(await failing());
    expect(junit).toContain('classname="manni.strategy"');
    expect(junit).toContain('message="journeys: &quot;m9&quot; names no journey.');
    expect(junit).not.toContain('message="/journeys ');
  });
});
