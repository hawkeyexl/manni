/**
 * cite over the metadata directory (proposal 0126): `docs/limits.md` carries
 * `id: limits`, so its citations live in `metadata/limits.yaml`. The page is
 * in both of the fixture's collections, which read one directory and so one
 * manifest. Writing there is the writers' suites' business.
 *
 * The `.gitignore` warning needs git to answer, so that case builds a real
 * repository and skips where git is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { noGit } from "../../src/cite/core/git.js";
import type { CheckRun } from "../../src/cite/types.js";
import { resetWarnings } from "../../src/shared/warn.js";
import { gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "external-metadata-dir", "cite");

let repo: string | undefined;
let stderr: string[];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  removeTempRepo(repo);
  repo = undefined;
});

function check(cwd: string, inputs: string[] = []): Promise<CheckRun> {
  return runCheck({ cwd, inputs, gitClient: noGit(), env: {} });
}

describe("cite reads metadata/<id>.yaml (0126)", () => {
  it("finds the page's citations in the file its id names, in two collections at once", async () => {
    const run = await check(FIXTURE);
    const page = run.pages.find((p) => p.file === "docs/limits.md");
    expect(page?.citations[0]?.origin).toEqual({ kind: "manifest", file: "metadata/limits.yaml", line: 3, index: 0 });
    expect([page?.citations[0]?.claim?.status, page?.citations[0]?.source.status]).toEqual(["current", "current"]);
    expect(run.summary.failed).toBe(0);
  });

  it.skipIf(!gitAvailable())("warns once, on a full run, when .gitignore covers the directory", async () => {
    const files: Record<string, string> = { ".gitignore": "metadata/\n" };
    for (const rel of readdirSync(FIXTURE, { recursive: true, encoding: "utf8" })) {
      if (statSync(join(FIXTURE, rel)).isFile()) files[rel.split("\\").join("/")] = readFileSync(join(FIXTURE, rel), "utf8");
    }
    repo = makeTempRepo({ files });
    await check(repo);
    expect(stderr.filter((line) => line.includes("covered by .gitignore"))).toEqual([
      "manni: metadata/ is covered by .gitignore, so CI checks out pages with no citations.\n",
    ]);
  });
});
