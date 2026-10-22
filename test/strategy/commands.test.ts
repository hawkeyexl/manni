/**
 * The `manni strategy` command cores and reporters (proposal 0100), against
 * small trees written per test and the sidecar fixture.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  "strategy/journeys/m2.md": page({ type: "journey", id: "m2", title: "Tighten the standard", persona: "maya" }),
  "strategy/journeys/m10.md": page({ type: "journey", id: "m10", title: "Keep the gate green", persona: "maya" }),
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
    const cwd = await docset({ "strategy/journeys/x1.md": page({ type: "journey", persona: "nobody" }) });
    const { entries } = await runList({ cwd, inputs: [] });
    const orphan = entries.find((e) => e.record.id === "x1");
    expect(orphan?.depth).toBe(0);
    expect(entries.at(-1)?.record.id).toBe("x1");
    expect(renderListPretty(entries).split("\n")).toContain("x1                    0  x1");
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
      persona: "maya",
      namedBy: { pages: [] },
    });
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
        description: "A page names a journey whose persona its personas: lacks, or a persona whose audience its audiences: lacks.",
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
