/**
 * `manni graph fill -`: the page read from stdin is filled in memory and comes
 * back as `stdinDocument`, never written to disk and never part of the
 * rendered report. Named files beside it are filled as usual.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { renderFill, runFill } from "../../../src/graph/commands/fill.js";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "fixtures", "stdin-page.md"), "utf8");

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-fillstdin-"));
  writeFileSync(
    join(dir, "manni.config.yaml"),
    "graph:\n  fill:\n    fields: [type]\n",
  );
  return dir;
}

describe("graph fill reads stdin", () => {
  it("returns the filled page as stdinDocument and writes nothing", async () => {
    const dir = setup();
    const report = await runFill({
      cwd: dir,
      paths: ["-"],
      as: "markdown",
      stdinContent: page,
      noCache: true,
      providerInstance: new MockProvider([
        { json: { type: "reference", confidence: { type: 0.9 } } },
      ]),
    });
    expect(report.exitCode).toBe(0);
    expect(report.results.map((r) => [r.path, r.status])).toEqual([
      ["<stdin>", "filled"],
    ]);
    expect(report.stdinDocument).toContain("type: reference");
    expect(report.stdinDocument).toContain("# Read from stdin");
    expect(readdirSync(dir)).toEqual(["manni.config.yaml"]);
    expect(renderFill(report, "json")).not.toContain("stdinDocument");
  });

  it("returns the page unchanged under --dry-run", async () => {
    const dir = setup();
    const report = await runFill({
      cwd: dir,
      paths: ["-"],
      as: "markdown",
      stdinContent: page,
      noCache: true,
      dryRun: true,
      providerInstance: new MockProvider([
        { json: { type: "reference", confidence: { type: 0.9 } } },
      ]),
    });
    expect(report.results[0]?.status).toBe("proposed");
    expect(report.stdinDocument).toBe(page);
  });
});
