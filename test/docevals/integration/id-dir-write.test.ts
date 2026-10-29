/**
 * Integration: docevals' writers on the metadata directory (proposal 0126),
 * over copies of `test/docevals/fixtures/manifest/id-dir-write`.
 *
 * `fill`, `generate` and `promote --write` put the evals of a page that
 * carries an id in `metadata/<id>.yaml`. A page with none is minted one, and
 * the evals it kept in its frontmatter move into the new file with the
 * write, so the page and the file never both hold them. A Docusaurus page,
 * whose `id` is the doc id, keeps its evals and says why.
 *
 * The providers are mocked; only the routing and the files are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/docevals/commands/fill.js";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";
import { runValidate } from "../../../src/meta/commands/validate.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/manifest/id-dir-write");

const dirs: string[] = [];
let stderr: string[] = [];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copyOf(fixture = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-id-dir-"));
  dirs.push(dir);
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const read = (cwd: string, rel: string): string => readFileSync(join(cwd, rel), "utf8");
type Entry = { evals?: { id?: string; command?: unknown; grader?: string }[]; "meta-provenance"?: unknown };
const entryOf = (cwd: string, rel: string, id: string): Entry | undefined =>
  (parseYaml(read(cwd, rel)) as Record<string, Entry>)[id];
const evalIds = (cwd: string, rel: string, id: string): (string | undefined)[] =>
  (entryOf(cwd, rel, id)?.evals ?? []).map((e) => e.id);

const PROPOSAL = {
  id: "states-the-problem",
  assertion: "The page states what problem it solves before how to solve it.",
  confidence: 0.9,
  examples: { pass: "The intro motivates the feature.", fail: "Bare syntax." },
};
const proposed = (): MockProvider => new MockProvider([{ json: { evals: [PROPOSAL] } }]);

const MINTED = 'manni: minted id "fresh" in docs/fresh.md, for metadata/fresh.yaml.\n';
/** The page `fresh.md` becomes once its evals have moved out. */
const FRESH_MINTED = "---\ntitle: Fresh\nid: fresh\n---\n\n# Fresh\n\nInstall the package, then run it. Node 20 or newer is required.\n";

describe("fill on the metadata directory", () => {
  it("writes a page's evals to the file its id names", async () => {
    const cwd = copyOf();
    const report = await runFill(["docs/known.md"], { cwd, noCache: true, providerInstance: proposed() });
    expect(report.results[0]?.wroteTo).toBe("metadata/known.yaml");
    expect(evalIds(cwd, "metadata/known.yaml", "known")).toEqual(["has-example", "states-the-problem"]);
    expect(read(cwd, "docs/known.md")).toBe(read(FIXTURE, "docs/known.md"));
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([]);
  });

  it("mints an id into a page with none, and moves its evals with the new one", async () => {
    const cwd = copyOf();
    const report = await runFill(["docs/fresh.md"], { cwd, noCache: true, providerInstance: proposed() });
    expect(report.results[0]).toMatchObject({ status: "filled", wroteTo: "metadata/fresh.yaml" });
    expect(evalIds(cwd, "metadata/fresh.yaml", "fresh")).toEqual([
      "has-example",
      "mentions-prerequisites",
      "states-the-problem",
    ]);
    expect(entryOf(cwd, "metadata/fresh.yaml", "fresh")?.["meta-provenance"]).toBeDefined();
    expect(read(cwd, "docs/fresh.md")).toBe(FRESH_MINTED);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED]);
  });

  it("leaves the evals in the page, and says why, when no id can be minted", async () => {
    const cwd = copyOf();
    const report = await runFill(["docs/docusaurus.md"], { cwd, noCache: true, providerInstance: proposed() });
    expect(report.results[0]?.wroteTo).toBe("page");
    expect(read(cwd, "docs/docusaurus.md")).toContain("id: states-the-problem");
    expect(existsSync(join(cwd, "metadata", "docusaurus.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("no id could be minted"))).toEqual([
      "manni: docs/docusaurus.md: no id could be minted (docusaurus:docs:3.10 gives id a meaning of its own; set one by hand), so evals stays in the page.\n",
    ]);
  });
});

describe("generate on the metadata directory", () => {
  it("mints an id, and moves the evals with the command reference into its file", async () => {
    const cwd = copyOf();
    const run = await runGenerate(["docs/fresh.md"], {
      cwd,
      providerInstance: new MockProvider([{ json: { code: "process.exit(0);\n" } }]),
    });
    expect(run.refusals).toEqual([]);
    expect(run.generatedPaths).toHaveLength(1);
    const evals = entryOf(cwd, "metadata/fresh.yaml", "fresh")?.evals ?? [];
    expect(evals.map((e) => e.id)).toEqual(["has-example", "mentions-prerequisites"]);
    expect(evals[1]?.command).toBeDefined();
    expect(read(cwd, "docs/fresh.md")).toBe(FRESH_MINTED);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED]);
  });
});

describe("promote --write on the metadata directory", () => {
  it("mints an id, and moves the evals with the promoted one into its file", async () => {
    const cwd = copyOf();
    const proposals = await runPromote(["docs/fresh.md"], {
      cwd,
      write: true,
      providerInstance: new MockProvider([
        { json: { promotable: true, rationale: "A regex checks it.", code: "process.exit(0);\n" } },
      ]),
    });
    expect(proposals.map((p) => [p.evalName, p.applied, p.error])).toEqual([["has-example", true, undefined]]);
    const evals = entryOf(cwd, "metadata/fresh.yaml", "fresh")?.evals ?? [];
    expect(evals.map((e) => [e.id, e.grader])).toEqual([
      ["has-example", "command"],
      ["mentions-prerequisites", "command"],
    ]);
    expect(read(cwd, "docs/fresh.md")).toBe(FRESH_MINTED);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED]);
  });
});

describe("fill moves every value the directory owns with the id it mints", () => {
  it("takes the page's personas into the new file beside its evals", async () => {
    const cwd = copyOf(resolve(import.meta.dirname, "../../fixtures/external-metadata-dir/mint-moves"));
    const report = await runFill(["docs/guide.md"], { cwd, noCache: true, providerInstance: proposed() });
    expect(report.results[0]).toMatchObject({ status: "filled", wroteTo: "metadata/guide.yaml" });
    const entry = entryOf(cwd, "metadata/guide.yaml", "guide") as Record<string, unknown> | undefined;
    expect(entry?.["personas"]).toEqual(["maya", "devin"]);
    expect(evalIds(cwd, "metadata/guide.yaml", "guide")).toEqual(["states-the-problem"]);
    expect(read(cwd, "docs/guide.md")).not.toContain("personas");
    const { results } = await runValidate({ cwd, inputs: [] });
    expect(results.find((r) => r.file === "docs/guide.md")?.errors).toEqual([]);
  });
});
