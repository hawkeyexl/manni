/**
 * Every eval points at the entry that declares it.
 *
 * An eval is declared by one item of `metadata.evals`, in the artifact's front
 * matter or in the manifest a collection declares for it (proposal 0037). The
 * plan carries that file and the item's line, and the result carries it on to
 * every report, so a CI annotation lands on the line someone edits.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExternalEvals } from "../../../src/tracevals/evals/external.js";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import { discoverConfig } from "../../../src/tracevals/core/config.js";
import { runEvals } from "../../../src/tracevals/core/engine.js";
import { parseConfig } from "../../../src/tracevals/core/config.js";
import type { ResolvedArtifact } from "../../../src/tracevals/artifacts/types.js";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function fixBug(dir: string): Promise<ResolvedArtifact> {
  const path = join(dir, ".claude", "skills", "fix-bug", "SKILL.md");
  return {
    name: "fix-bug",
    type: "skill",
    path,
    content: await readFile(path, "utf-8"),
    origin: "project",
  };
}

async function plansFor(name: string) {
  const dir = fixture(name);
  const { collections, path } = await discoverConfig(dir);
  const external = await loadExternalEvals({
    collections,
    configDir: dir,
    ...(path === undefined ? {} : { configPath: path }),
  });
  if (external === null) throw new Error(`${name} declares a manifest`);
  const artifact = await fixBug(dir);
  const merged = await external.forArtifact(artifact);
  return { dir, plans: planEvals([artifact], () => merged) };
}

describe("an eval's declaring location", () => {
  it("is the artifact and the entry's line when the front matter declares it", async () => {
    const artifact = await fixBug(fixture("project"));
    const plans = planEvals([artifact]);
    expect(plans.map((p) => [p.evalName, p.location])).toEqual([
      ["used-read", { file: artifact.path, line: 6 }],
      ["forbidden-tool", { file: artifact.path, line: 12 }],
      ["no-force-push", { file: artifact.path, line: 18 }],
      ["refactor-preserved-intent", { file: artifact.path, line: 23 }],
      // The string shorthand's line is the string's own.
      ["eval-5", { file: artifact.path, line: 27 }],
    ]);
  });

  it("is the shared manifest and the entry's line when relocation put it there", async () => {
    const { dir, plans } = await plansFor("relocated");
    const manifest = join(dir, "artifact-evals.yaml");
    expect(plans.map((p) => [p.evalName, p.location])).toEqual([
      ["used-read", { file: manifest, line: 7 }],
      ["stayed-out-of-the-shell", { file: manifest, line: 13 }],
      ["followed-the-skill", { file: manifest, line: 19 }],
    ]);
  });

  it("is the artifact's own manifest under a {page} pattern", async () => {
    const { dir, plans } = await plansFor("relocated-per-page");
    const manifest = join(dir, ".claude", "skills", "fix-bug", "SKILL.meta.yaml");
    expect(plans.map((p) => p.location)).toEqual([
      { file: manifest, line: 5 },
      { file: manifest, line: 11 },
    ]);
  });

  it("is the manifest's entry when the manifest joins on a field", async () => {
    const { dir, plans } = await plansFor("relocated-joined");
    const manifest = join(dir, "artifact-evals.yaml");
    expect(plans.map((p) => p.location)).toEqual([
      { file: manifest, line: 5 },
      { file: manifest, line: 11 },
    ]);
  });

  it("is the artifact alone for the implicit eval, which no entry declares", async () => {
    const artifact = await fixBug(fixture("relocated"));
    const [plan] = planEvals([artifact]);
    expect(plan?.evalName).toBe("adheres-to-artifact");
    expect(plan?.location).toEqual({ file: artifact.path });
  });

  it("reaches the result, spelled relative to the working directory", async () => {
    const dir = fixture("relocated");
    const { collections, path } = await discoverConfig(dir);
    const external = await loadExternalEvals({
      collections,
      configDir: dir,
      ...(path === undefined ? {} : { configPath: path }),
    });
    if (external === null) throw new Error("relocated declares a manifest");
    const report = await runEvals({
      tracePath: fileURLToPath(
        new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
      ),
      projectDir: dir,
      config: parseConfig({}),
      deterministicOnly: true,
      metadataFor: (artifact) => external.forArtifact(artifact),
    });
    const result = report.evalResults.find(
      (r) => r.artifactName === "fix-bug" && r.evalName === "stayed-out-of-the-shell",
    );
    expect(result?.location).toEqual({
      file: relative(process.cwd(), join(dir, "artifact-evals.yaml")).split("\\").join("/"),
      line: 13,
    });
  });
});
