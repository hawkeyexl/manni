/**
 * Where graph build reads `x-manni-graph-output` from (proposal 0074): the
 * schema set `manni meta validate` resolves for each page. Graph keeps no
 * schema set of its own.
 *
 * This is the filter's own test, over the fixture's one page. It is where the
 * claim can be proved both ways round: graph derives no triple from `owner`,
 * `stakeholders` or `reviewed-by`, so the published outputs lack those values
 * whether or not they are marked. What the mark changes is what reaches
 * derivation, and that is what these cases read.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { loadRunConfig } from "../../../src/graph/core/config.js";
import { suppressGraphOutput } from "../../../src/graph/core/graph-output.js";
import { openMetaView } from "../../../src/graph/core/external.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "fixtures", "stewardship-output");
const PAGE = "docs/owned-page.md";
const PEOPLE = ["owner", "stakeholders", "reviewed-by"];

async function harvested(configFile: string | undefined): Promise<string[]> {
  const config = loadRunConfig(
    configFile === undefined ? { noConfig: true } : { configPath: configFile },
    fixture,
  );
  const doc = analyzeDoc(
    readFileSync(join(fixture, PAGE), "utf8"),
    PAGE,
    new Set([PAGE]),
    { routes: config.routes },
  );
  const view = await openMetaView(
    configFile === undefined ? { noConfig: true } : { configPath: configFile },
    fixture,
    [PAGE],
  );
  const [out] = await suppressGraphOutput([doc], view);
  return Object.keys(out?.frontmatter ?? {});
}

describe("graph build reads its output marks from meta's schema set (0074)", () => {
  it("drops the people fields under the default set, which holds stewardship 1.1.0", async () => {
    const keys = await harvested("manni.config.yaml");
    for (const key of PEOPLE) expect(keys).not.toContain(key);
    expect(keys).toEqual(expect.arrayContaining(["title", "description", "graph"]));
  });

  it("drops them with meta strict: true", async () => {
    const keys = await harvested("strict.config.yaml");
    for (const key of PEOPLE) expect(keys).not.toContain(key);
    expect(keys).toContain("title");
  });

  it("drops them under --no-config, which is the default set too", async () => {
    const keys = await harvested(undefined);
    for (const key of PEOPLE) expect(keys).not.toContain(key);
  });

  it("drops them for a graph-only config, which has no meta: section", async () => {
    const keys = await harvested("graph-only.config.yaml");
    for (const key of PEOPLE) expect(keys).not.toContain(key);
  });

  it("keeps them when meta's set is stewardship 1.0.0 without the defaults", async () => {
    const keys = await harvested("stewardship-1.0.0.config.yaml");
    expect(keys).toEqual(expect.arrayContaining(PEOPLE));
  });
});
