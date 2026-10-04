/**
 * The sidecar shapes `manni meta validate` and `manni docevals` read, read by
 * tracevals too (proposals 0037, 0039 and 0068).
 *
 * `relocated/` covers a path-joined manifest with `keys`, and
 * `relocated-per-page/` a keyless `{page}` manifest. These cover the rest. A
 * field-joined manifest keys its entries on the artifact's own `name`, and a
 * shared keyless manifest owns what the artifact's schemas mark external.
 * Without a collection, an adjacent manifest is nobody's, as it is for meta.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExternalEvals } from "../../../src/tracevals/evals/external.js";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import { discoverConfig } from "../../../src/tracevals/core/config.js";
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

async function evalIds(name: string): Promise<string[]> {
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
  return planEvals([artifact], () => merged.extracted).map((p) => p.evalName);
}

describe("sidecar shapes", () => {
  it("reads a manifest joined on the artifact's name", async () => {
    expect(await evalIds("relocated-joined")).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
    ]);
  });

  it("reads a shared manifest with no keys", async () => {
    expect(await evalIds("relocated-keyless")).toEqual([
      "used-read",
      "stayed-out-of-the-shell",
    ]);
  });

  it("reads no adjacent manifest when no collection declares one", async () => {
    const dir = fixture("relocated-per-page");
    expect(
      await loadExternalEvals({ collections: [], configDir: dir }),
    ).toBeNull();
    const artifact = await fixBug(dir);
    expect(planEvals([artifact]).map((p) => p.evalName)).toEqual([
      "adheres-to-artifact",
    ]);
  });
});
