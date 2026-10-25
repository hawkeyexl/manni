import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { authoringMetadata } from "../../docs/src/components/graph-explorer-model.js";

describe("explorer metadata export", () => {
  it("includes sidecar fields, honours graph publication marks, and preserves ciphertext", () => {
    const directory = mkdtempSync(join(tmpdir(), "manni-explorer-"));
    try {
      cpSync(resolve("test/fixtures/graph-explorer"), directory, {
        recursive: true,
      });
      const output = execFileSync(
        process.execPath,
        [resolve("scripts/export-explorer-metadata.mjs")],
        { cwd: directory, encoding: "utf8" },
      );
      expect(output).toContain("Exported authoring metadata for 2 pages");
      const json: unknown = JSON.parse(
        readFileSync(
          join(directory, "docs/public/explorer-data/authoring.json"),
          "utf8",
        ),
      );
      const metadata = authoringMetadata(json);
      expect(metadata.get("docs/page.md")).toMatchObject({
        personas: ["devin"],
        encrypted: "~opaque-ciphertext",
      });
      expect(metadata.get("docs/page.md")).not.toHaveProperty("private-note");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
