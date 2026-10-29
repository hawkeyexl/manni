/**
 * `manni tracevals fill` on the metadata directory (proposal 0126), over
 * copies of `test/tracevals/fixtures/relocated-id-dir`.
 *
 * An artifact carrying an id keeps its `metadata` block in
 * `metadata/<id>.yaml`. One with none is minted one, and the block it carried
 * moves into the new file with the write. A skill under the agentskills
 * schema, which allows no `id`, keeps its block and says why.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { parse as parseYaml } from "yaml";
import { runFill } from "../../../src/tracevals/commands/fill.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const fixture = fileURLToPath(new URL("../fixtures/relocated-id-dir", import.meta.url));

const proposal = {
  json: {
    evals: [
      {
        name: "no-shell",
        assertion: "The session never ran shell commands.",
        grader: "tool-usage",
        options: { tool: "Bash", expect: "not-used" },
        examples: { pass: "no Bash calls", fail: "ran npm test" },
        confidence: 0.9,
      },
    ],
    needsSharpening: [],
  },
};

type Entries = Record<string, { metadata?: { evals?: { id: string }[]; "meta-provenance"?: unknown } }>;
const ids = (text: string, entry: string): string[] =>
  ((parseYaml(text) as Entries)[entry]?.metadata?.evals ?? []).map((e) => e.id);

let project: string;
let stderr: string[];
beforeEach(async () => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  project = await mkdtemp(join(tmpdir(), "manni-tracevals-id-dir-"));
  await cp(fixture, project, { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(project, { recursive: true, force: true });
});

const skill = (name: string): string => join(project, ".claude", "skills", name, "SKILL.md");
const run = (paths: string[]) =>
  runFill({
    project,
    configDir: project,
    cwd: project,
    paths,
    providerInstance: new MockProvider([proposal], "judge-5"),
  });

describe("fill on the metadata directory", () => {
  it("appends to the file the artifact's id names, and leaves the page alone", async () => {
    const before = await readFile(skill("known"), "utf-8");
    const { report } = await run([skill("known")]);
    expect(report.results.find((r) => r.artifact === skill("known"))).toMatchObject({
      status: "filled",
      manifest: "metadata/known.yaml",
    });
    expect(ids(await readFile(join(project, "metadata", "known.yaml"), "utf-8"), "known")).toEqual([
      "used-read",
      "no-shell",
    ]);
    expect(await readFile(skill("known"), "utf-8")).toBe(before);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([]);
  });

  it("mints an id into an artifact with none, and moves its block with the new one", async () => {
    const { report } = await run([skill("fresh")]);
    expect(report.results.find((r) => r.artifact === skill("fresh"))).toMatchObject({
      status: "filled",
      manifest: "metadata/fresh-skill.yaml",
    });
    const text = await readFile(join(project, "metadata", "fresh-skill.yaml"), "utf-8");
    expect(ids(text, "fresh-skill")).toEqual(["read-the-page", "no-shell"]);
    expect((parseYaml(text) as Entries)["fresh-skill"]?.metadata?.["meta-provenance"]).toBeDefined();
    expect(await readFile(skill("fresh"), "utf-8")).toBe(
      "---\nname: fresh\ndescription: Write or update a documentation page.\nid: fresh-skill\n---\n\n# Fresh\n\nRead the page before editing it.\n",
    );
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([
      'manni: minted id "fresh-skill" in .claude/skills/fresh/SKILL.md, for metadata/fresh-skill.yaml.\n',
    ]);
  });

  it("leaves the block in the page, and says why, when no id can be minted", async () => {
    const { report } = await run([skill("strict")]);
    const filled = report.results.find((r) => r.artifact === skill("strict"));
    expect(filled?.status).toBe("filled");
    expect(filled?.manifest).toBeUndefined();
    expect(await readFile(skill("strict"), "utf-8")).toContain("no-shell");
    expect(existsSync(join(project, "metadata", "strict-skill.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("no id could be minted"))).toEqual([
      "manni: .claude/skills/strict/SKILL.md: no id could be minted (its schemas do not allow id), so metadata stays in the page.\n",
    ]);
  });
});
