/**
 * A termbase that cannot be read is `term check`'s failure to report. The
 * graph warns once and builds the rest, as it does when git is absent.
 */
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runBuild } from "../../../src/graph/commands/build.js";
import { registerTermLabelSource } from "../../../src/shared/term-labels.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = join(root, "test", "graph", "fixtures", "termbase");

afterEach(() => {
  registerTermLabelSource(undefined);
});

describe("graph build when the termbase cannot be read", () => {
  it("warns with the reason and builds without termbase concepts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-termbase-bad-"));
    cpSync(fixture, dir, { recursive: true });
    registerTermLabelSource(() => Promise.reject(new Error("bad term.manifests entry")));

    const result = await runBuild({ cwd: dir });

    expect(result.warnings).toContain(
      "the graph holds no termbase concepts: the termbase could not be read — bad term.manifests entry",
    );
    expect(result.concepts.fromTermbase).toBe(0);
  });
});
