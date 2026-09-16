/**
 * The eval trail kept outside the artifact (proposal 0047).
 *
 * `manni meta relocate` moves the whole `metadata` key — evals, `eval-skip` and
 * `meta-provenance` together — into a collection's external-metadata manifest.
 * Reading only front matter graded such an artifact as declaring nothing: no
 * evals, no trail, no error, a clean gate. These cases are the proof that it no
 * longer does, and that a relocated artifact grades exactly as an inline one.
 *
 * The fixture is `test/tracevals/fixtures/relocated/`: a `manni.config.yaml`
 * with one collection, a manifest that owns `metadata`, and a `fix-bug` skill
 * whose front matter carries none.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { loadExternalEvals } from "../../../src/tracevals/evals/external.js";
import { extractEvals } from "../../../src/tracevals/evals/extract.js";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import { discoverConfig } from "../../../src/tracevals/core/config.js";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { makeTrace } from "../helpers.js";
import type { ResolvedArtifact } from "../../../src/tracevals/artifacts/types.js";

const fixture = fileURLToPath(new URL("../fixtures/relocated", import.meta.url));
const skillPath = join(fixture, ".claude", "skills", "fix-bug", "SKILL.md");

async function loadFixture() {
  const { collections } = await discoverConfig(fixture);
  const external = await loadExternalEvals({ collections, configDir: fixture });
  if (external === null) throw new Error("the fixture declares a manifest");
  const artifact: ResolvedArtifact = {
    name: "fix-bug",
    type: "skill",
    path: skillPath,
    content: await readFile(skillPath, "utf-8"),
    origin: "project",
  };
  return { external, artifact, collections };
}

describe("loadExternalEvals", () => {
  it("is null when no collection keeps metadata in a manifest", async () => {
    // Every setup that predates 0047, and every `--no-config` run: nothing is
    // loaded and nothing is fetched, so the cost of the feature is zero.
    expect(await loadExternalEvals({ collections: [], configDir: fixture })).toBeNull();
  });

  it("merges the manifest's metadata block into the artifact's front matter", async () => {
    const { external, artifact } = await loadFixture();
    const merged = external.forArtifact(artifact);

    // The page itself carries no `metadata:` at all.
    expect(artifact.content).not.toContain("metadata:");
    expect(merged.owner?.file).toBe("artifact-evals.yaml");
    expect(merged.owner?.collection).toBe("agents");
    expect(merged.owner?.url).toBe(false);
    // The entry key is the artifact's path relative to the config directory,
    // posix-spelled, which is how the manifest names it on every platform.
    expect(merged.entry).toBe(".claude/skills/fix-bug/SKILL.md");
    expect(merged.extracted.data.name).toBe("fix-bug");
  });

  it("gives an artifact in no collection nothing, and no owner", async () => {
    const { external } = await loadFixture();
    const outsider = external.forArtifact({
      path: join(fixture, "notes", "README.md"),
      content: "---\nname: notes\n---\n",
    });
    expect(outsider.owner).toBeUndefined();
    expect(outsider.extracted.data.metadata).toBeUndefined();
  });
});

describe("a relocated artifact's evals", () => {
  it("are invisible without the manifest, and read with it", async () => {
    const { external, artifact } = await loadFixture();

    // The contract this change replaced: front matter alone sees no block, so
    // the artifact falls through to the implicit whole-artifact eval.
    const inline = planEvals([artifact]);
    expect(inline.map((p) => p.evalName)).toEqual(["adheres-to-artifact"]);

    const plans = planEvals(
      [artifact],
      (a) => external.forArtifact(a).extracted,
    );
    expect(plans.map((p) => p.evalName)).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
      "followed-the-skill",
    ]);
    expect(plans.every((p) => p.error === undefined)).toBe(true);
    expect(plans[0]?.grader).toBe("tool-usage");
    expect(plans[0]?.options).toEqual({ tool: "Read", expect: "used" });
  });

  it("validates against the draft the same way an inline block does", async () => {
    // The schema is document-rooted, so the merged extraction is what it sees.
    // A malformed relocated block must be an error, not a silent skip.
    const { artifact } = await loadFixture();
    const bad = extractEvals(artifact, {
      present: true,
      format: "yaml",
      data: {
        name: "fix-bug",
        metadata: { evals: [{ assertion: "no id, which the schema requires" }] },
      },
      lineFor: () => undefined,
    });
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("carries eval-skip out of the manifest too", async () => {
    // 0047 moves the whole `metadata` map, so the opt-out relocates with the
    // evals. A run that read the evals but not the skip would grade an
    // artifact its owner had switched off.
    const { artifact } = await loadFixture();
    const skipped = extractEvals(artifact, {
      present: true,
      format: "yaml",
      data: { name: "fix-bug", metadata: { "eval-skip": true } },
      lineFor: () => undefined,
    });
    expect(skipped.skip).toBe(true);
  });
});

describe("self-preference, criterion axis, on a relocated artifact", () => {
  it("still fires when meta-provenance is in the manifest", async () => {
    // The sharpest reason to read the manifest at all: the trail says which
    // model wrote the assertion, and a judge grading a criterion it proposed
    // is biased however the block reached the run.
    const { external, artifact } = await loadFixture();
    const plans = planEvals(
      [artifact],
      (a) => external.forArtifact(a).extracted,
    );
    const ai = plans.find((p) => p.evalName === "followed-the-skill");
    if (ai === undefined) throw new Error("the manifest declares an ai eval");
    expect(ai.proposedBy).toEqual(["claude-opus-4-5"]);

    const judge = makeTraceJudge({
      provider: new MockProvider(
        [mockVerdict("pass", 0.95), mockVerdict("pass", 0.95), mockVerdict("pass", 0.95)],
        "claude-opus-4-5",
      ),
      cacheDir: undefined,
      noCache: true,
    });
    const [judged] = await judge([ai], () => "rendered transcript", {
      trace: makeTrace({ model: "some-other-model" }),
    });
    expect(judged?.selfPreference).toEqual({
      axis: "criterion",
      model: "claude-opus-4-5",
    });
    // The verdict still forms; the bias rides alongside it.
    expect(judged?.outcome).toBe("pass");
  });
});
