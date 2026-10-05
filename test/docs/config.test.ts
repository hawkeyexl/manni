/** The `docs:` key of `manni.config.yaml`: every malformed value names the file and the key. */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocsConfig } from "../../src/docs/core/config.js";
import { DocsError } from "../../src/docs/errors.js";

const FILE = "manni.config.yaml";
const DIR = resolve("/repo");

describe("parseDocsConfig", () => {
  it("resolves dir against the config file and keeps each command", () => {
    expect(
      parseDocsConfig(
        { dir: "docs", commands: { start: "pnpm dev", build: "pnpm build", preview: "npx serve" } },
        FILE,
        DIR,
      ),
    ).toEqual({
      dir: join(DIR, "docs"),
      commands: { start: "pnpm dev", build: "pnpm build", preview: "npx serve" },
    });
  });

  it("treats an empty section as no settings", () => {
    expect(parseDocsConfig(null, FILE, DIR)).toEqual({ commands: {} });
  });

  it.each([
    [{ framework: "astro" }, '`docs:` has unknown key "framework". Supported keys: dir, commands.'],
    [{ commands: { serve: "x" } }, '`docs.commands:` has unknown key "serve". Supported keys: start, build, preview.'],
    [{ commands: { start: 1 } }, "docs.commands.start must be a string."],
    [{ dir: ["docs"] }, "docs.dir must be a string."],
    [{ commands: "pnpm dev" }, "`docs.commands:` must be a mapping."],
    ["docs", "`docs:` must be a mapping."],
  ])("refuses %j", (value, message) => {
    expect(() => parseDocsConfig(value, FILE, DIR)).toThrow(DocsError);
    expect(() => parseDocsConfig(value, FILE, DIR)).toThrow(`${FILE}: ${message}`);
  });
});
