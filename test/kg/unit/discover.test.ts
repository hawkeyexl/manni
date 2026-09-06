import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverFiles } from "../../../src/kg/core/discover.js";

function corpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-discover-"));
  mkdirSync(join(dir, "docs", "sub"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "docs", "b.md"), "# b\n");
  writeFileSync(join(dir, "docs", "a.md"), "# a\n");
  writeFileSync(join(dir, "docs", "sub", "c.md"), "# c\n");
  writeFileSync(join(dir, "node_modules", "pkg", "readme.md"), "# no\n");
  writeFileSync(join(dir, "docs", "not-md.txt"), "x\n");
  return dir;
}

describe("discoverFiles", () => {
  it("returns repo-relative forward-slash paths, stably sorted", () => {
    const dir = corpus();
    const files = discoverFiles(["**/*.md"], ["**/node_modules/**"], dir);
    expect(files).toEqual(["docs/a.md", "docs/b.md", "docs/sub/c.md"]);
  });

  it("applies exclude patterns", () => {
    const dir = corpus();
    const files = discoverFiles(
      ["**/*.md"],
      ["**/node_modules/**", "**/sub/**"],
      dir,
    );
    expect(files).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("returns the same order regardless of input glob order", () => {
    const dir = corpus();
    const a = discoverFiles(["docs/sub/**/*.md", "docs/*.md"], [], dir);
    const b = discoverFiles(["docs/*.md", "docs/sub/**/*.md"], [], dir);
    expect(a).toEqual(b);
  });
});
