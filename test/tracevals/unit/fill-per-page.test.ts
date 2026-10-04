/**
 * `manni tracevals fill` writes where a keyless, per-artifact manifest puts
 * the `metadata` block (proposals 0058 and 0068), and offers a home when no
 * manifest owns it (proposal 0047, P1).
 *
 * A `{page}` pattern names one file per artifact. Writing it literally made a
 * file called `{page}.meta.yaml`; this suite is the proof it no longer does.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { parse as parseYaml } from "yaml";
import { runFill } from "../../../src/tracevals/commands/fill.js";

const perPage = fileURLToPath(new URL("../fixtures/relocated-per-page", import.meta.url));
const relocated = fileURLToPath(new URL("../fixtures/relocated", import.meta.url));

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

type Entries = Record<string, { metadata?: { evals?: { id: string }[] } }>;

const ids = (text: string, entry: string): string[] =>
  ((parseYaml(text) as Entries)[entry]?.metadata?.evals ?? []).map((e) => e.id);

describe("fill against a keyless {page} manifest", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "manni-tracevals-per-page-"));
    await cp(perPage, project, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  const run = (paths: string[], over: Parameters<typeof runFill>[0] = {}) =>
    runFill({
      project,
      configDir: project,
      cwd: project,
      paths,
      providerInstance: new MockProvider([proposal], "judge-5"),
      ...over,
    });

  it("appends to the artifact's own manifest and leaves the page alone", async () => {
    const skill = join(project, ".claude", "skills", "fix-bug", "SKILL.md");
    const manifest = join(project, ".claude", "skills", "fix-bug", "SKILL.meta.yaml");
    const before = await readFile(skill, "utf-8");

    const { report } = await run([skill]);

    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.status).toBe("filled");
    expect(filled?.manifest).toBe(".claude/skills/fix-bug/SKILL.meta.yaml");
    expect(await readFile(skill, "utf-8")).toBe(before);
    expect(ids(await readFile(manifest, "utf-8"), ".claude/skills/fix-bug/SKILL.md")).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
      "no-shell",
    ]);
    expect(existsSync(join(project, "{page}.meta.yaml"))).toBe(false);
  });

  it("creates the manifest for an artifact that has none yet", async () => {
    const dir = join(project, ".claude", "skills", "plan-work");
    await mkdir(dir, { recursive: true });
    const skill = join(dir, "SKILL.md");
    const page = "---\nname: plan-work\ndescription: Plan the work.\n---\n\n# Plan\n\nPlan first.\n";
    await writeFile(skill, page);

    const { report } = await run([skill]);

    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.status).toBe("filled");
    expect(filled?.manifest).toBe(".claude/skills/plan-work/SKILL.meta.yaml");
    expect(await readFile(skill, "utf-8")).toBe(page);
    const text = await readFile(join(dir, "SKILL.meta.yaml"), "utf-8");
    expect(ids(text, ".claude/skills/plan-work/SKILL.md")).toEqual(["no-shell"]);
    expect(report.warnings).toEqual([]);
  });
});

describe("fill offers a home when no manifest owns metadata", () => {
  let project: string;
  let skill: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "manni-tracevals-offer-"));
    await cp(relocated, project, { recursive: true });
    await rm(join(project, "artifact-evals.yaml"));
    await writeFile(
      join(project, "manni.config.yaml"),
      ["collections:", "  - name: agents", '    paths: [".claude/skills/**/SKILL.md"]', ""].join(
        "\n",
      ),
    );
    skill = join(project, ".claude", "skills", "fix-bug", "SKILL.md");
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  const run = (over: Parameters<typeof runFill>[0] = {}) =>
    runFill({
      project,
      configDir: project,
      cwd: project,
      providerInstance: new MockProvider([proposal], "judge-5"),
      ...over,
    });

  it("asks once, and on a yes writes into the manifest it created", async () => {
    const before = await readFile(skill, "utf-8");
    const questions: string[] = [];
    const notices: string[] = [];
    const moved: string[] = [];

    const { report } = await run({
      confirm: (q) => {
        questions.push(q);
        return Promise.resolve(true);
      },
      onNotice: (m) => notices.push(m),
      onRelocated: (r) => moved.push(...r.manifests.map((m) => m.file)),
    });

    expect(questions).toHaveLength(1);
    expect(notices.join("\n")).toContain("metadata");
    expect(moved).toHaveLength(1);
    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.status).toBe("filled");
    expect(filled?.manifest).toBe(moved[0]);
    expect(await readFile(skill, "utf-8")).toBe(before);
    const text = await readFile(join(project, moved[0] ?? ""), "utf-8");
    expect(ids(text, ".claude/skills/fix-bug/SKILL.md")).toEqual(["no-shell"]);
    expect(report.warnings).toEqual([]);
  });

  it("writes the page and warns on a no", async () => {
    const { report } = await run({ confirm: () => Promise.resolve(false) });

    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.manifest).toBeUndefined();
    expect(await readFile(skill, "utf-8")).toContain("no-shell");
    expect(report.warnings).toContain(
      "wrote metadata to 1 page in collection agents; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.",
    );
  });

  it("asks nothing under --dry-run", async () => {
    let asked = false;
    await run({
      dryRun: true,
      confirm: () => {
        asked = true;
        return Promise.resolve(true);
      },
    });
    expect(asked).toBe(false);
  });
});
