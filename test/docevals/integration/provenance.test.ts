/**
 * `manni docevals` and the family's attribution records (proposal 0046),
 * against the built `dist/cli.js`: the `fill` report's `metaProvenance`, and
 * the reserved `eval-` prefix refusing a key no draft defines any more.
 *
 * `fill` runs under `--provider mock` from a cache seeded by this test, so
 * nothing probes the machine or reaches a model: a cache hit spends no turn
 * and constructs no provider.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { readPage } from "../../../src/docevals/core/discover.js";
import { FillCache, fillCacheKey } from "../../../src/docevals/fill/cache.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const FIXTURES = join(ROOT, "test/docevals/fixtures/provenance");

function manni(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** A copy of the provenance fixtures, outside the repository. */
function workspace(page: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-provenance-"));
  mkdirSync(join(dir, "docs"));
  copyFileSync(join(FIXTURES, "manni.config.yaml"), join(dir, "manni.config.yaml"));
  copyFileSync(join(FIXTURES, "docs", page), join(dir, "docs", page));
  return dir;
}

describe("manni docevals fill records meta-provenance", () => {
  it("reports the merged entry in --dry-run -f json", () => {
    const page = "fill-meta-provenance.md";
    const dir = workspace(page);
    const config = loadConfig(undefined, dir);
    const plan = readPage(join(dir, "docs", page), dir);
    const key = fillCacheKey(
      "mock",
      "mock-model",
      config.fill.temperature,
      config.fill.maxEvalsPerPage,
      plan.body,
      ["limits-stated", "retry-named"],
      config.fill.chunkChars,
    );
    new FillCache(resolve(dir, config.fill.cacheDir)).set(key, {
      evals: [
        {
          id: "links-resolve",
          assertion: "Every relative link resolves.",
          confidence: 0.8,
          examples: { pass: "Links resolve.", fail: "A link 404s." },
        },
      ],
    });

    const r = manni(["fill", `docs/${page}`, "--provider", "mock", "--dry-run", "-f", "json"], dir);
    // W1 (proposal 0047): this workspace declares no manifest, and the evals
    // draft prefers these keys in one. Nothing else reaches stderr, and stdout
    // stays the report.
    expect(r.stderr).toBe(
      "manni: would write evals to 1 page; the schema prefers external " +
        "metadata. Run manni meta relocate to give it a manifest.\n",
    );
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as { results: Record<string, unknown>[] };
    expect(report.results[0]?.status).toBe("proposed");
    expect(report.results[0]?.metaProvenance).toEqual({
      written: true,
      entry: {
        "generated-by": "mock-model",
        fields: ["/description"],
        evals: ["retry-named", "links-resolve"],
        confidence: { "/description": 0.9, "retry-named": 0.75, "links-resolve": 0.8 },
      },
    });
  });
});

describe("the reserved eval- prefix", () => {
  it("reports eval-provenance as a page problem, exit 1", () => {
    const dir = workspace("eval-provenance-typo.md");
    const r = manni(["run", "docs/eval-provenance-typo.md", "--deterministic-only", "--no-generate"], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      'frontmatter/eval-provenance: unknown key "eval-provenance". The "eval-" prefix is reserved, and the only settings under it are eval-suite, eval-skip — so a typo is an error here rather than a key nothing reads.',
    );
  });
});
