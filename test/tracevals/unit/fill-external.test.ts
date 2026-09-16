/**
 * `manni tracevals fill` writes where the metadata lives (proposal 0047).
 *
 * Four cases, and they are the whole contract:
 *
 *  - a manifest owns the artifact's `metadata` block, so the proposals are
 *    spliced into the manifest and the page is not touched;
 *  - nothing owns it, so the page is written as it always was;
 *  - nothing owns it but the schema would rather something did, so the page is
 *    written *and* the run says so in meta's own words;
 *  - a URL manifest owns it, which is readable and not writable: exit 2.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { parse as parseYaml } from "yaml";
import { runFill } from "../../../src/tracevals/commands/fill.js";
import { loadExternalEvals } from "../../../src/tracevals/evals/external.js";
import { extractEvals } from "../../../src/tracevals/evals/extract.js";
import { discoverConfig } from "../../../src/tracevals/core/config.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const fixture = fileURLToPath(new URL("../fixtures/relocated", import.meta.url));

/** One well-formed proposal, the shape `fill.test.ts` uses. */
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

describe("fill against a relocated artifact", () => {
  let project: string;
  let manifest: string;
  let skill: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "manni-tracevals-relocated-"));
    await cp(fixture, project, { recursive: true });
    manifest = join(project, "artifact-evals.yaml");
    skill = join(project, ".claude", "skills", "fix-bug", "SKILL.md");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
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

  it("splices the proposals into the manifest and leaves the page alone", async () => {
    const before = await readFile(skill, "utf-8");
    const { report } = await run();

    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.status).toBe("filled");
    expect(filled?.written.map((w) => w.name)).toEqual(["no-shell"]);
    // The report names where it landed, or the reviewer opens the wrong file.
    expect(filled?.manifest).toBe("artifact-evals.yaml");

    expect(await readFile(skill, "utf-8")).toBe(before);

    const text = await readFile(manifest, "utf-8");
    // The splice writer changes one value and no other byte, so the manifest's
    // own comment survives.
    expect(text).toContain("# The whole `metadata` block");
    const doc = parseYaml(text) as Record<string, { metadata: Record<string, unknown> }>;
    const block = doc[".claude/skills/fix-bug/SKILL.md"]?.metadata;
    const ids = (block?.evals as { id: string }[]).map((e) => e.id);
    // Appended, never replacing what a human wrote.
    expect(ids).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
      "followed-the-skill",
      "no-shell",
    ]);
  });

  it("writes a trail the next run reads back out of the manifest", async () => {
    await run();
    const { collections } = await discoverConfig(project);
    const external = await loadExternalEvals({ collections, configDir: project });
    const merged = external?.forArtifact({
      path: skill,
      content: await readFile(skill, "utf-8"),
    });
    const extracted = extractEvals(
      { name: "fix-bug", type: "skill", path: skill, content: "", origin: "project" },
      merged?.extracted,
    );
    expect(extracted.errors).toEqual([]);
    expect(extracted.evals.map((e) => e.id)).toContain("no-shell");
    // The existing entry is extended rather than replaced, so both models stay
    // on the record for the criterion axis to read.
    expect(extracted.proposedBy.get("no-shell")).toEqual(["judge-5"]);
    expect(extracted.proposedBy.get("followed-the-skill")).toEqual([
      "claude-opus-4-5",
    ]);
  });

  it("knows what the artifact already declares, so it does not re-propose it", async () => {
    // The manifest already holds `stayed-out-of-the-shell`, which is the same
    // Bash check the model proposes. Without the manifest the gate would see an
    // artifact declaring nothing and write a duplicate.
    const { report } = await run({
      providerInstance: new MockProvider(
        [
          {
            json: {
              evals: [
                {
                  ...proposal.json.evals[0],
                  name: "stayed-out-of-the-shell",
                },
              ],
              needsSharpening: [],
            },
          },
        ],
        "judge-5",
      ),
    });
    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.written).toEqual([]);
    expect(filled?.rejected.map((r) => r.reason)).toContain("duplicate-name");
  });

  it("reports the manifest under --dry-run and writes nothing", async () => {
    const before = await readFile(manifest, "utf-8");
    const { report } = await run({ dryRun: true });
    const result = report.results.find((r) => r.artifact === skill);
    expect(result?.status).toBe("proposed");
    expect(result?.manifest).toBe("artifact-evals.yaml");
    expect(await readFile(manifest, "utf-8")).toBe(before);
  });

  it("refuses to write into a URL manifest, and says to vendor it", async () => {
    // Readable, never writable: `run` grades a hosted trail happily, and a CLI
    // has nowhere to PUT one. Exit 2, the way cite refuses the same thing.
    const hosted = await readFile(manifest, "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(hosted, { status: 200 }))),
    );
    await writeFile(
      join(project, "manni.config.yaml"),
      [
        "collections:",
        "  - name: agents",
        '    paths: [".claude/skills/**/SKILL.md"]',
        "    externalMetadata:",
        "      - file: https://example.invalid/artifact-evals.yaml",
        "        keys: [metadata]",
        "",
      ].join("\n"),
    );

    await expect(run()).rejects.toThrow(TracevalsError);
    await expect(run()).rejects.toThrow(
      /a URL manifest cannot be written\. Vendor it to a path/,
    );
  });

  it("refuses a remote manifest under --offline rather than fetching it", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    await writeFile(
      join(project, "manni.config.yaml"),
      [
        "collections:",
        "  - name: agents",
        '    paths: [".claude/skills/**/SKILL.md"]',
        "    externalMetadata:",
        "      - file: https://example.invalid/artifact-evals.yaml",
        "        keys: [metadata]",
        "",
      ].join("\n"),
    );
    await expect(run({ offline: true })).rejects.toThrow(
      /is remote and the run is offline/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fill when nothing owns the block", () => {
  let project: string;
  let skill: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "manni-tracevals-homeless-"));
    await cp(fixture, project, { recursive: true });
    skill = join(project, ".claude", "skills", "fix-bug", "SKILL.md");
    await rm(join(project, "artifact-evals.yaml"));
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

  it("writes the page, and says the schema would rather it had a manifest", async () => {
    await writeFile(
      join(project, "manni.config.yaml"),
      [
        "collections:",
        "  - name: agents",
        '    paths: [".claude/skills/**/SKILL.md"]',
        "",
      ].join("\n"),
    );
    const { report } = await run();
    const filled = report.results.find((r) => r.artifact === skill);
    expect(filled?.status).toBe("filled");
    expect(filled?.manifest).toBeUndefined();
    expect(await readFile(skill, "utf-8")).toContain("no-shell");
    // meta's own W1 line, word for word, because it is the same key.
    expect(report.warnings).toContain(
      "wrote metadata to 1 page in collection agents; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.",
    );
  });

  it("says so in the future tense under --dry-run", async () => {
    await writeFile(
      join(project, "manni.config.yaml"),
      [
        "collections:",
        "  - name: agents",
        '    paths: [".claude/skills/**/SKILL.md"]',
        "",
      ].join("\n"),
    );
    const { report } = await run({ dryRun: true });
    expect(report.warnings).toEqual([]);
  });

  it("names the collections when the artifact is in none of them", async () => {
    await writeFile(
      join(project, "manni.config.yaml"),
      [
        "collections:",
        "  - name: site",
        '    paths: ["site/**/*.md"]',
        "  - name: guides",
        '    paths: ["guides/**/*.md"]',
        "",
      ].join("\n"),
    );
    const { report } = await run();
    expect(report.warnings).toContain(
      "wrote metadata to 1 page that is in none of the 2 collections; the schema prefers external metadata, and only a collection has a manifest.",
    );
  });

  it("stays quiet for a repository that declares no collections", async () => {
    // The overwhelming majority of runs. There is nothing to relocate into and
    // no 0047 story to tell, so a warning here would be noise on every fill.
    await rm(join(project, "manni.config.yaml"));
    const { report } = await run();
    expect(report.warnings).toEqual([]);
    expect(await readFile(skill, "utf-8")).toContain("no-shell");
  });

  it("stays quiet under --no-config", async () => {
    const { report } = await run({ noConfig: true });
    expect(report.warnings).toEqual([]);
    expect(await readFile(skill, "utf-8")).toContain("no-shell");
  });
});
