/** The `site:` key of `manni.config.yaml`: every malformed value names the file and the key. */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "../../src/site/core/config.js";
import { SiteError } from "../../src/site/errors.js";

const FILE = "manni.config.yaml";
const DIR = resolve("/repo");

describe("parseSiteConfig", () => {
  it("resolves dir against the config file and keeps each command", () => {
    expect(
      parseSiteConfig(
        { dir: "docs", commands: { start: "pnpm dev", build: "pnpm build", preview: "npx serve" } },
        FILE,
        DIR,
      ),
    ).toEqual({
      dir: join(DIR, "docs"),
      commands: { start: "pnpm dev", build: "pnpm build", preview: "npx serve" },
      afterBuild: false,
    });
  });

  it("treats an empty section as no settings", () => {
    expect(parseSiteConfig(null, FILE, DIR)).toEqual({ commands: {}, afterBuild: false });
  });

  it("keeps out as written, relative to the site, and reads annotate.after-build", () => {
    expect(parseSiteConfig({ out: "build", annotate: { "after-build": true } }, FILE, DIR)).toMatchObject({
      out: "build",
      afterBuild: true,
    });
  });

  it.each([
    [{ framework: "astro" }, '`site:` has unknown key "framework". Supported keys: dir, commands, out, annotate.'],
    [{ annotate: { marks: true } }, '`site.annotate:` has unknown key "marks". Supported keys: after-build.'],
    [{ annotate: { "after-build": "yes" } }, "site.annotate.after-build must be a boolean."],
    [{ out: 1 }, "site.out must be a string."],
    [{ out: " " }, "site.out must not be empty."],
    [{ commands: { serve: "x" } }, '`site.commands:` has unknown key "serve". Supported keys: start, build, preview.'],
    [{ commands: { start: 1 } }, "site.commands.start must be a string."],
    [{ commands: { build: "  " } }, "site.commands.build must not be empty."],
    [{ dir: ["docs"] }, "site.dir must be a string."],
    [{ commands: "pnpm dev" }, "`site.commands:` must be a mapping."],
    ["docs", "`site:` must be a mapping."],
  ])("refuses %j", (value, message) => {
    expect(() => parseSiteConfig(value, FILE, DIR)).toThrow(SiteError);
    expect(() => parseSiteConfig(value, FILE, DIR)).toThrow(`${FILE}: ${message}`);
  });
});
