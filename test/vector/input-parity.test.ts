/**
 * `vector build` takes the input surface `graph build` takes (proposal 0128
 * §2): positional paths, `-` with `--as`, `--collection`, `--exclude`,
 * `--ext`, `--allow-empty`, `-c` and `--no-config`, with `collections:` as the
 * fallback. Through the built CLI.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hermeticEnv } from "../graph/helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "test", "graph", "fixtures");
const collections = join(fixtures, "collections");
const stdinPage = readFileSync(join(fixtures, "stdin-page.md"), "utf8");

function vector(args: string[], cwd: string, input?: string) {
  return spawnSync(process.execPath, [cli, "vector", "build", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
    ...(input === undefined ? {} : { input }),
  });
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `manni-vector-${prefix}-`));
}

/** `--no-cache` and the mock model keep every rung offline, and `-o` keeps fixtures clean. */
function offline(out: string): string[] {
  return ["--embedding-model", "mock", "--no-cache", "-o", out, "-f", "json"];
}

interface Report {
  documents: number;
  entries: number;
  languages: Array<{ language: string; searchPath: string }>;
}

function index(out: string, language = "und"): Array<{ id: string; text?: string }> {
  const doc = JSON.parse(readFileSync(join(out, `search.${language}.json`), "utf8")) as {
    entries: Array<{ id: string; text?: string }>;
  };
  return doc.entries;
}

describe("vector build inputs", () => {
  it("falls back to every collection the config declares", () => {
    const every = vector(offline(tmp("all")), collections);
    const guides = vector(["--collection", "guides", ...offline(tmp("guides"))], collections);
    expect(every.status, every.stderr).toBe(0);
    expect(guides.status, guides.stderr).toBe(0);
    const a = JSON.parse(every.stdout) as Report;
    const b = JSON.parse(guides.stdout) as Report;
    expect(b.documents).toBeLessThan(a.documents);
  });

  it("reads named paths, labelled from the working directory", () => {
    const out = tmp("paths");
    const r = vector(["guides/intro.md", ...offline(out)], collections);
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Report).documents).toBe(1);
    expect(index(out).map((e) => e.id)).toContain("https://example.com/collections/doc/guides/intro.md");
  });

  it("reads `-` with --as beside a named path, and indexes its text", () => {
    const out = tmp("stdin");
    const r = vector(["-", "guides/intro.md", "--as", "markdown", ...offline(out)], collections, stdinPage);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("Source not found");
    const stdin = index(out).find((e) => e.id === "https://example.com/collections/stdin");
    expect(stdin).toBeDefined();
  });

  it("excludes a glob", () => {
    const out = tmp("exclude");
    const r = vector(["--exclude", "**/draft.md", ...offline(out)], collections);
    expect(r.status, r.stderr).toBe(0);
    expect(index(out).map((e) => e.id).some((id) => id.includes("draft.md"))).toBe(false);
  });

  it("narrows a directory walk to --ext, and --allow-empty accepts zero matches", () => {
    const dir = tmp("ext");
    mkdirSync(join(dir, "docs"));
    copyFileSync(join(fixtures, "stdin-page.md"), join(dir, "docs", "a.md"));
    const none = vector(["docs", "--ext", ".rst", "--no-config", ...offline(join(dir, "o1"))], dir);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("No input files matched");
    const empty = vector(["docs", "--ext", ".rst", "--allow-empty", "--no-config", ...offline(join(dir, "o2"))], dir);
    expect(empty.status, empty.stderr).toBe(0);
    expect((JSON.parse(empty.stdout) as Report).languages).toEqual([]);
  });

  it("refuses no input and no collections, exit 2", () => {
    const r = vector(["--no-config", ...offline(tmp("none"))], tmp("bare"));
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: No files to build. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.\n",
    );
  });

  it("refuses `-` without --as, exit 2", () => {
    const r = vector(["-", "--collection", "guides"], collections, stdinPage);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.\n");
  });

  it("refuses --collection beside paths, as graph build does", () => {
    const r = vector(["guides", "--collection", "guides", ...offline(tmp("both"))], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--collection selects a configured collection; it cannot be combined with paths.");
  });
});
