/**
 * `manni docevals` over every format meta reads (proposal 0125, decision 21),
 * against the built `dist/cli.js`. `test/docevals/fixtures/formats/` holds one
 * page each of HTML (a Flare topic), AsciiDoc, reStructuredText and DITA. Each
 * page's manifest declares a `tool:regex` eval that fails on a `TODO` line, so
 * the run proves discovery, the manifest merge and the line number at once.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const FORMATS = join(ROOT, "test", "docevals", "fixtures", "formats");

interface Report {
  evalResults: { file: string; evalName: string; outcome: string; findings?: { line?: number }[] }[];
}

describe("manni docevals over HTML, AsciiDoc, RST and DITA pages", () => {
  it("reads each page, and a regex finding names the file's own line", () => {
    const r = spawnSync("node", [MANNI, "docevals", "run", "--deterministic-only", "-f", "json"], {
      cwd: FORMATS,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(r.status, r.stderr).toBe(1);
    const report = JSON.parse(r.stdout) as Report;
    const lines = Object.fromEntries(
      report.evalResults.map((e) => [e.file, { outcome: e.outcome, line: e.findings?.[0]?.line }]),
    );
    expect(lines).toEqual({
      "Content/concept.dita": { outcome: "fail", line: 8 },
      "Content/guide.adoc": { outcome: "fail", line: 6 },
      "Content/notes.rst": { outcome: "fail", line: 8 },
      "Content/topic.htm": { outcome: "fail", line: 10 },
    });
  });
});
