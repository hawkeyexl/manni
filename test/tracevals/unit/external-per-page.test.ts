/**
 * Relocated evals in one manifest per artifact, with no `keys` (proposals 0058
 * and 0068).
 *
 * A keyless manifest owns what the artifact's schemas mark external, and
 * artifact-evals marks the whole `metadata` block. Reading an absent `keys` as
 * "owns nothing" dropped every eval such a manifest held, and a `{page}`
 * pattern read literally named a file nobody wrote. Either way the run graded
 * the artifact as declaring nothing, which is the silent pass 0047 closed.
 *
 * The fixture is `test/tracevals/fixtures/relocated-per-page/`: two skills,
 * each with its own `SKILL.meta.yaml`, and a meta override that judges the
 * collection by `manni:artifact-evals:1.0.0`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExternalEvals } from "../../../src/tracevals/evals/external.js";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import { discoverConfig } from "../../../src/tracevals/core/config.js";
import { prepareRun } from "../../../src/tracevals/commands/run.js";
import type { ResolvedArtifact } from "../../../src/tracevals/artifacts/types.js";

const fixture = fileURLToPath(new URL("../fixtures/relocated-per-page", import.meta.url));

async function artifact(name: string): Promise<ResolvedArtifact> {
  const path = join(fixture, ".claude", "skills", name, "SKILL.md");
  return {
    name,
    type: "skill",
    path,
    content: await readFile(path, "utf-8"),
    origin: "project",
  };
}

async function load() {
  const { collections, path } = await discoverConfig(fixture);
  const external = await loadExternalEvals({
    collections,
    configDir: fixture,
    ...(path === undefined ? {} : { configPath: path }),
  });
  if (external === null) throw new Error("the fixture declares a manifest");
  return external;
}

describe("a keyless {page} manifest", () => {
  it("supplies the metadata block the artifact's schemas mark external", async () => {
    const external = await load();
    const merged = await external.forArtifact(await artifact("fix-bug"));

    expect(merged.owner?.file).toBe(".claude/skills/fix-bug/SKILL.meta.yaml");
    expect(merged.owner?.collection).toBe("agents");
    expect(merged.entry).toBe(".claude/skills/fix-bug/SKILL.md");
    const metadata = merged.extracted.data.metadata as { evals: { id: string }[] };
    expect(metadata.evals.map((e) => e.id)).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
    ]);
  });

  it("resolves the pattern per artifact", async () => {
    const external = await load();
    const merged = await external.forArtifact(await artifact("write-docs"));

    expect(merged.owner?.file).toBe(".claude/skills/write-docs/SKILL.meta.yaml");
    const metadata = merged.extracted.data.metadata as { evals: { id: string }[] };
    expect(metadata.evals.map((e) => e.id)).toEqual(["read-the-page"]);
  });

  it("plans the declared evals instead of the implicit one", async () => {
    const external = await load();
    const skills = [await artifact("fix-bug"), await artifact("write-docs")];
    const merged = new Map<string, Awaited<ReturnType<typeof external.forArtifact>>>();
    for (const a of skills) merged.set(a.path, await external.forArtifact(a));

    const plans = planEvals(skills, (a) => merged.get(a.path));
    expect(plans.map((p) => p.evalName)).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
      "read-the-page",
    ]);
  });

  it("reaches run through prepareRun", async () => {
    const context = await prepareRun({ configDir: fixture });
    const loader = context.metadataFor;
    if (loader === undefined) throw new Error("the fixture declares a manifest");
    const supplied = await loader(await artifact("write-docs"));
    const metadata = supplied?.extracted.data.metadata as { evals: { id: string }[] };
    expect(metadata.evals.map((e) => e.id)).toEqual(["read-the-page"]);
  });
});
