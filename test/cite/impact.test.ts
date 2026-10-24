/**
 * `cite check` names the personas and journeys a finding's page serves
 * (proposal 0105), in every format, over a committed copy of
 * `test/fixtures/cite/impact`. The copy is a git repository of its own, so
 * the two stale pins are `source-never-true` whatever this checkout tracks.
 */
import { cpSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/cite/commands/check.js";
import { renderCheckGithub } from "../../src/cite/reporters/github.js";
import { renderCheckJson } from "../../src/cite/reporters/json.js";
import { renderCheckJunit } from "../../src/cite/reporters/junit.js";
import { renderCheckPretty } from "../../src/cite/reporters/pretty.js";
import { renderCheckSarif, type SarifLog } from "../../src/cite/reporters/sarif.js";
import type { CheckOptions, CheckRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, removeTempRepo } from "../helpers/temp-repo.js";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "cite", "impact");

const SERVES = "Serves maya (Maya, Documentation Engineer) and m5 (Pin a claim and catch it going stale).";

/** The fixture's config without its strategy collection: no records, so no impact. */
const NO_RECORDS = [
  "collections:",
  "  - name: pages",
  '    paths: ["pages/*.md"]',
  "    externalMetadata:",
  '      - file: "{page}.meta.yaml"',
  "        keys: [personas, journeys]",
  "cite:",
  "  root: .",
  "",
].join("\n");

let dir: string | undefined;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-cite-impact-")));
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, "manni.no-records.yaml"), NO_RECORDS);
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  commitAll(dir, "fixture");
});
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

function here(): string {
  if (dir === undefined) throw new Error("no fixture copy");
  return dir;
}

async function check(config: string, extra: Partial<CheckOptions> = {}): Promise<{ run: CheckRun; notices: string[] }> {
  const notices: string[] = [];
  const run = await runCheck({
    cwd: here(),
    inputs: [],
    configPath: config,
    onNotice: (message) => notices.push(message),
    ...extra,
  });
  return { run, notices };
}

interface JsonReport {
  summary: unknown;
  impact?: { type: string; id: string; title?: string; findings: number; errors: number; pages: string[] }[];
  pages: { file: string }[];
}

const json = (run: CheckRun): JsonReport => JSON.parse(renderCheckJson(run)) as JsonReport;

const lineFor = (text: string, file: string): string | undefined =>
  text.split("\n").find((line) => line.includes(`file=${file},`));

describe.skipIf(!gitAvailable())("cite check names the readers of a finding's page", () => {
  it("json: impact sits between summary and pages, names the stale page's records, and joins on pages[].file", async () => {
    const { run } = await check("manni.config.yaml");
    const report = json(run);
    expect(Object.keys(report)).toEqual(["summary", "impact", "pages"]);
    expect(report.impact?.map((e) => `${e.type}:${e.id}`)).toEqual(["persona:maya", "journey:m5"]);
    const files = new Set(report.pages.map((p) => p.file));
    for (const entry of report.impact ?? []) {
      expect(entry.pages).toEqual(["pages/stale.md"]);
      for (const page of entry.pages) expect(files.has(page)).toBe(true);
      expect(entry.findings).toBe(entry.errors);
    }
    // m6 is named only by the clean page.
    expect(report.impact?.some((e) => e.id === "m6")).toBe(false);
    expect(JSON.parse(JSON.stringify(report.summary))).toEqual(run.summary);
  });

  it("github: the sentence follows the finding's text and precedes the guidance; other pages are unchanged", async () => {
    const { run } = await check("manni.config.yaml");
    const { run: bare } = await check("manni.no-records.yaml");
    const github = renderCheckGithub(run);
    const stale = lineFor(github, "pages/stale.md");
    const before = lineFor(renderCheckGithub(bare), "pages/stale.md");
    if (stale === undefined || before === undefined) throw new Error("no annotation for pages/stale.md");
    const [head, ...rest] = before.split("%0A");
    expect(stale).toBe([`${head ?? ""} ${SERVES}`, ...rest].join("%0A"));
    expect(lineFor(github, "pages/unnamed.md")).toBe(lineFor(renderCheckGithub(bare), "pages/unnamed.md"));
  });

  it("sarif and junit carry the same sentence", async () => {
    const { run } = await check("manni.config.yaml");
    const sarif = JSON.parse(renderCheckSarif(run)) as SarifLog;
    const texts = sarif.runs.flatMap((r) => r.results.map((result) => result.message.text));
    const withSentence = texts.filter((text) => text.includes(SERVES));
    expect(withSentence).toHaveLength(1);
    expect(withSentence[0]).toMatch(new RegExp(`${SERVES.replace(/[().]/g, "\\$&")}\\nmanni:cite source-never-true`));
    const junit = renderCheckJunit(run);
    expect(junit).toContain(`${SERVES} (line 15)"`);
  });

  it("pretty: the roll-up comes after the pages and before the summary line", async () => {
    const { run } = await check("manni.config.yaml");
    const lines = renderCheckPretty(run, { color: false, quiet: true }).split("\n");
    const at = lines.indexOf("The pages with findings serve 1 persona and 1 journey.");
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toBe("");
    expect(lines.slice(at + 1, at + 3)).toEqual([
      "  maya   Maya, Documentation Engineer           1 error on 1 page",
      "  m5     Pin a claim and catch it going stale   1 error on 1 page",
    ]);
    expect(lines[at + 3]).toBe("");
    expect(lines[at + 4]).toMatch(/files checked/);
    expect(lines).toHaveLength(at + 5);
  });

  it("with no strategy record, no format says anything new", async () => {
    const { run } = await check("manni.no-records.yaml");
    expect(json(run)).not.toHaveProperty("impact");
    expect(renderCheckGithub(run)).not.toContain("Serves");
    expect(renderCheckSarif(run)).not.toContain("Serves");
    expect(renderCheckJunit(run)).not.toContain("Serves");
    expect(renderCheckPretty(run, { color: false })).not.toContain("The pages with findings");
  });

  it("--no-config reads no records", async () => {
    const { run } = await check("manni.config.yaml", {
      configPath: undefined,
      noConfig: true,
      root: here(),
      inputs: ["pages/stale.md"],
    });
    expect(run.summary.failed).toBe(1);
    expect(json(run)).not.toHaveProperty("impact");
  });

  it("a positional run and a --collection run still read the records from every collection", async () => {
    const { run: positional } = await check("manni.config.yaml", { inputs: ["pages/stale.md"] });
    expect(json(positional).impact?.map((e) => e.id)).toEqual(["maya", "m5"]);
    const { run: collection } = await check("manni.config.yaml", { collection: ["pages"] });
    expect(json(collection).impact?.map((e) => e.id)).toEqual(["maya", "m5"]);
  });

  it("journeys: stays free-form when no journey record exists", async () => {
    const { run } = await check("manni.personas-only.yaml");
    expect(json(run).impact?.map((e) => e.id)).toEqual(["maya"]);
    expect(lineFor(renderCheckGithub(run), "pages/stale.md")).toContain(
      "Serves maya (Maya, Documentation Engineer).%0A",
    );
  });

  it("a broken strategy section says so once, and cite's verdict stands", async () => {
    const { run, notices } = await check("manni.bad-strategy.yaml");
    expect(notices.filter((n) => n.startsWith("personas and journeys"))).toEqual([
      'personas and journeys left out of the report. manni.bad-strategy.yaml: strategy does not carry "paths". Name a collection under collections:.',
    ]);
    expect(run.summary.failed).toBe(2);
    expect(json(run)).not.toHaveProperty("impact");
  });

  it("a run whose findings are all baselined carries no impact and reads no strategy set", async () => {
    await check("manni.config.yaml", { writeBaseline: true });
    // The broken section would say so if the set were read.
    const { run, notices } = await check("manni.bad-strategy.yaml", { baseline: true });
    expect(run.summary.failed).toBe(0);
    expect(notices.some((n) => n.startsWith("personas and journeys"))).toBe(false);
    expect(json(run)).not.toHaveProperty("impact");
    expect(renderCheckPretty(run, { color: false })).not.toContain("The pages with findings");
  });
});
