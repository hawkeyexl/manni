import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

describe("manni kg validate", () => {
  it("passes the corpus (valid kg keys and docs without kg)", () => {
    const { stdout, status } = run(
      ["validate"],
      join(root, "test", "kg", "fixtures", "corpus"),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("8 files checked");
  });

  it("takes kg.revision-of as a list or a bare string, and rejects an empty list", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-revof-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n',
    );
    writeFileSync(
      join(dir, "list.md"),
      "---\nkg:\n  revision-of: [old/guide.md]\n---\n\n# G\n",
    );
    // The single-string shorthand docmeta:kg widened over dockg 0.8: one value
    // is a string, many values are a list. This used to be a rejection.
    writeFileSync(
      join(dir, "shorthand.md"),
      "---\nkg:\n  revision-of: old/guide.md\n---\n\n# G\n",
    );
    expect(run(["validate"], dir).status).toBe(0);

    // …but an empty list is not a declaration. `minItems: 1` closes the hole
    // where `revision-of: []` read as "revised something" and named nothing.
    writeFileSync(
      join(dir, "bad.md"),
      "---\nkg:\n  revision-of: []\n---\n\n# B\n",
    );
    const bad = run(["validate"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/revision-of/);
  });

  it("fails on malformed kg frontmatter with exit 1 and named errors", () => {
    const { stdout, status } = run(
      ["validate"],
      join(root, "test", "kg", "fixtures", "invalid"),
    );
    expect(status).toBe(1);
    expect(stdout).toMatch(/label/);
    expect(stdout).toMatch(/bogus/);
  });

  it("accepts negative-scope fields and rejects an out-of-enum not-about-product-aspect", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-negscope-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n',
    );
    writeFileSync(
      join(dir, "good.md"),
      "---\nkg:\n  not-applicable-to: [SP-X300]\n  not-about-product-aspect: [architecture]\n---\n\n# G\n",
    );
    expect(run(["validate"], dir).status).toBe(0);

    writeFileSync(
      join(dir, "bad.md"),
      "---\nkg:\n  not-about-product-aspect: [nonsense]\n---\n\n# B\n",
    );
    const bad = run(["validate"], dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/not-about-product-aspect/);
  });
});
