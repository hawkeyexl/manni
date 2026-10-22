/**
 * `manni graph export llms` (proposal 0090, PR 4): `llms.txt` from the built
 * graph. Each description is the page's delivered `description`, and each
 * link takes the detected framework's URL style.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runExport } from "../../../src/graph/commands/export.js";
import { GraphError } from "../../../src/graph/types.js";
import { makeTempRepo, removeTempRepo } from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "llms");

function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(FIXTURE, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(FIXTURE);
  return out;
}

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) removeTempRepo(d);
  dirs = [];
});

/** A built copy of the fixture, outside git, after `edit` changes its files. */
async function built(edit?: (dir: string) => void): Promise<string> {
  const dir = makeTempRepo({ files: fixtureFiles(), init: false });
  dirs.push(dir);
  edit?.(dir);
  await runBuild({ cwd: dir });
  return dir;
}

const config = (dir: string, change: (yaml: string) => string): void => {
  const path = join(dir, "manni.config.yaml");
  writeFileSync(path, change(readFileSync(path, "utf8")), "utf8");
};
const framework = (dir: string, dep: string): void => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { [dep]: "1.0.0" } }), "utf8");
};
const llms = (dir: string): string => readFileSync(join(dir, ".manni/graph/llms.txt"), "utf8");

describe("graph export llms", () => {
  it("writes one section per language, each page's description as its frontmatter has it", async () => {
    const dir = await built();
    const result = await runExport({ cwd: dir, format: "llms" });
    expect(result.outPath).toBe(join(dir, ".manni/graph/llms.txt"));
    expect(result.nodes).toBe(4);
    expect(llms(dir)).toBe(
      [
        "# Example",
        "",
        "> Docs for the example tool.",
        "",
        "## de",
        "",
        "- [Beispiel](https://docs.example.com/docs/de/): Hier beginnt die Installation.",
        "",
        "## en",
        "",
        "- [Guide](https://docs.example.com/docs/guide/)",
        "- [Set up the tool](https://docs.example.com/docs/guide/setup/): Install the tool and write its config: one file.",
        "- [Example](https://docs.example.com/docs/): Start here to install and run the example tool.",
        "",
      ].join("\n"),
    );
  });

  it("leaves out a page under no route, and says how many", async () => {
    const dir = await built();
    const result = await runExport({ cwd: dir, format: "llms" });
    expect(result.warnings).toEqual(["1 page is under no route, so llms.txt leaves it out."]);
    expect(llms(dir)).not.toContain("Draft");
  });

  it.each([
    [["docs/en/guide/setup.md"], "1 page in the graph is not on disk, so llms.txt leaves it out; run manni graph build."],
    [
      ["docs/en/guide/setup.md", "docs/en/guide/index.md"],
      "2 pages in the graph are not on disk, so llms.txt leaves them out; run manni graph build.",
    ],
  ])("warns when a graph page is gone from disk: %j", async (gone, message) => {
    const dir = await built();
    for (const file of gone) rmSync(join(dir, file));
    const result = await runExport({ cwd: dir, format: "llms" });
    expect(result.warnings).toContain(message);
    expect(llms(dir)).not.toContain("Set up the tool");
  });

  it("writes one Docs section for one language, and no blockquote without a summary", async () => {
    const dir = await built((d) => {
      rmSync(join(d, "docs/de"), { recursive: true });
      rmSync(join(d, "notes"), { recursive: true });
      config(d, (y) =>
        y
          .replace("    - root: docs/de\n      basePath: /docs/de\n      language: de\n", "")
          .replace("      summary: Docs for the example tool.\n", ""),
      );
    });
    const result = await runExport({ cwd: dir, format: "llms" });
    expect(result.warnings).toEqual([]);
    expect(llms(dir)).toBe(
      [
        "# Example",
        "",
        "## Docs",
        "",
        "- [Guide](https://docs.example.com/docs/guide/)",
        "- [Set up the tool](https://docs.example.com/docs/guide/setup/): Install the tool and write its config: one file.",
        "- [Example](https://docs.example.com/docs/): Start here to install and run the example tool.",
        "",
      ].join("\n"),
    );
  });

  it.each([
    ["@docusaurus/core", "https://docs.example.com/docs/guide/setup)", "https://docs.example.com/docs/guide)"],
    ["vitepress", "https://docs.example.com/docs/guide/setup.html)", "https://docs.example.com/docs/guide/)"],
  ])("takes %s's URL style", async (dep, page, index) => {
    const dir = await built((d) => {
      framework(d, dep);
    });
    await runExport({ cwd: dir, format: "llms" });
    expect(llms(dir)).toContain(page);
    expect(llms(dir)).toContain(index);
  });

  it("detects the framework in site.dir, as manni site does", async () => {
    const dir = await built((d) => {
      rmSync(join(d, "package.json"));
      mkdirSync(join(d, "web"));
      framework(join(d, "web"), "vitepress");
      config(d, (y) => `${y}\nsite:\n  dir: web\n`);
    });
    await runExport({ cwd: dir, format: "llms" });
    expect(llms(dir)).toContain("(https://docs.example.com/docs/guide/setup.html)");
  });

  it("ends routes in a slash when no framework is detected", async () => {
    const dir = await built((d) => {
      rmSync(join(d, "package.json"));
    });
    await runExport({ cwd: dir, format: "llms" });
    expect(llms(dir)).toContain("(https://docs.example.com/docs/guide/setup/)");
  });

  it("writes to the path --out names", async () => {
    const dir = await built();
    const result = await runExport({ cwd: dir, format: "llms", out: "site/llms.txt" });
    expect(result.outPath).toBe(join(dir, "site/llms.txt"));
    expect(readFileSync(join(dir, "site/llms.txt"), "utf8")).toContain("# Example");
  });

  it.each([
    ["title", "      title: Example\n", "graph export llms needs graph.export.llms.title."],
    [
      "origin",
      "      origin: https://docs.example.com\n",
      "graph export llms needs graph.export.llms.origin, the site's scheme and host.",
    ],
  ])("refuses without %s", async (_key, line, message) => {
    const dir = await built((d) => {
      config(d, (y) => y.replace(line, ""));
    });
    const run = runExport({ cwd: dir, format: "llms" });
    await expect(run).rejects.toThrow(GraphError);
    await expect(run).rejects.toThrow(message);
  });

  it("refuses with no graph.export.llms section", async () => {
    const dir = await built((d) => {
      config(d, (y) => y.slice(0, y.indexOf("  export:\n")));
    });
    await expect(runExport({ cwd: dir, format: "llms" })).rejects.toThrow(
      "graph export llms needs graph.export.llms.title.",
    );
  });
});
