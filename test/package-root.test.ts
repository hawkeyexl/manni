/**
 * `packageRoot` finds the files a tool ships beside its code - a schema, a
 * built-in template - by walking up to `package.json`. The walk cannot fail in
 * a published package or in this repository, so what is tested here is what it
 * does when it nevertheless does: which error class, because that is what
 * decides whether the user reads one line or a stack trace.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageRoot } from "../src/shared/package-root.js";
import { ToolError } from "../src/shared/errors.js";

describe("packageRoot", () => {
  it("walks up to the package.json above the calling module", () => {
    const root = packageRoot(import.meta.url);
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  // A bare `Error` is rendered by the bin runner as "Unexpected error: …",
  // with a stack trace, because that is what the runner says about a bug. A
  // package whose files did not ship is an operational failure and reads as
  // one line, exit 2, like every other `ToolError`.
  it("fails with the family's error class, not a bare Error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manni-package-root-"));
    try {
      const url = pathToFileURL(join(dir, "module.js")).href;
      expect(() => packageRoot(url)).toThrow(ToolError);
      expect(() => packageRoot(url)).toThrow(/No package\.json above/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
