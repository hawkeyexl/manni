/**
 * Input parity for `graph build` and `graph fill` through the real CLI: `-`
 * reads stdin alongside named paths, `--as` picks the parser, `--ext` narrows
 * directory walks, and `--allow-empty` turns zero matches into success. Also
 * the flags renamed for what they mean: `query --subject/--predicate/--object`,
 * `traverse --software-subject` and `embed --embedding-model`.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "test", "graph", "fixtures");
const collections = join(fixtures, "collections");
const stdinPage = readFileSync(join(fixtures, "stdin-page.md"), "utf8");

function graph(args: string[], cwd: string, input?: string) {
  return spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
    ...(input === undefined ? {} : { input }),
  });
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `manni-graph-${prefix}-`));
}

describe("graph build reads stdin", () => {
  it("builds `-` with --as beside a named path", () => {
    const out = join(tmp("stdin"), "g.ttl");
    const r = graph(
      ["build", "-", "guides/intro.md", "--as", "markdown", "-o", out],
      collections,
      stdinPage,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(2 docs, \d+ triples\)/);
    const ttl = readFileSync(out, "utf8");
    // The node is `<baseIri>stdin`, and its display path is `<stdin>`.
    expect(ttl).toContain("<https://example.com/collections/stdin>");
    expect(ttl).toContain('"<stdin>"');
    // A relative link resolves from the working directory.
    const node = ttl.slice(ttl.indexOf("<https://example.com/collections/stdin> a"));
    expect(node.slice(0, node.indexOf(" .\n"))).toContain(
      "dcterms:references <https://example.com/collections/doc/guides/intro.md>",
    );
  });

  it("refuses `-` without --as, exit 2", () => {
    const r = graph(["build", "-"], collections, stdinPage);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.\n",
    );
  });

  it("refuses an unknown --as, exit 2", () => {
    const r = graph(["build", "guides", "--as", "docx"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      'manni: Unknown format "docx". Known formats: asciidoc, html, markdown, mdx, rst, xml.\n',
    );
  });

  it("parses every input as MDX under --as mdx", () => {
    const dir = tmp("as-mdx");
    // A `.md` name, MDX content: only --as makes the brace an expression.
    writeFileSync(join(dir, "page.md"), "# Page\n\n{1 +}\n");
    const r = graph(
      ["build", "page.md", "--as", "mdx", "--no-config", "-o", join(dir, "g.ttl")],
      dir,
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Could not parse MDX in page.md");
  });
});

describe("graph build --ext and --allow-empty", () => {
  let dir: string;
  beforeAll(() => {
    dir = tmp("ext");
    mkdirSync(join(dir, "docs"));
    copyFileSync(join(fixtures, "stdin-page.md"), join(dir, "docs", "a.md"));
    copyFileSync(join(fixtures, "mdx-page.mdx"), join(dir, "docs", "b.mdx"));
  });

  it("walks .md and .mdx by default", () => {
    const r = graph(["build", "docs", "--no-config", "-o", join(dir, "g.ttl")], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(2 docs,/);
  });

  it("narrows a directory walk to --ext", () => {
    const r = graph(
      ["build", "docs", "--ext", ".mdx", "--no-config", "-o", join(dir, "g.ttl")],
      dir,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\(1 docs,/);
  });

  it("fails on zero matches without --allow-empty", () => {
    const r = graph(
      ["build", "docs", "--ext", ".rst", "--no-config", "-o", join(dir, "g.ttl")],
      dir,
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("No input files matched");
  });

  it("treats zero matches as success with --allow-empty", () => {
    const out = join(dir, "empty.ttl");
    const r = graph(
      ["build", "docs", "--ext", ".rst", "--allow-empty", "--no-config", "-o", out],
      dir,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`Wrote ${out} (0 docs, 0 triples)\n`);
  });

  it("fill exits 0 with an empty report under --allow-empty", () => {
    const r = graph(
      [
        "fill",
        "docs",
        "--ext",
        ".rst",
        "--allow-empty",
        "--no-config",
        "--provider",
        "mock",
        "-f",
        "json",
      ],
      dir,
    );
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout) as { results: unknown[] };
    expect(report.results).toEqual([]);
  });
});

describe("graph fill reads stdin", () => {
  it("writes the document to stdout and the report to stderr", () => {
    const dir = tmp("fill-stdin");
    const r = graph(
      [
        "fill",
        "-",
        "--as",
        "markdown",
        "--no-config",
        "--provider",
        "mock",
        "--no-cache",
      ],
      dir,
      stdinPage,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.startsWith("---\n")).toBe(true);
    expect(r.stdout).toContain("# Read from stdin");
    expect(r.stderr).toContain("<stdin>");
  });

  it("sends a json report to stderr", () => {
    const dir = tmp("fill-stdin-json");
    const r = graph(
      [
        "fill",
        "-",
        "--as",
        "markdown",
        "--no-config",
        "--provider",
        "mock",
        "--no-cache",
        "-f",
        "json",
      ],
      dir,
      stdinPage,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("# Read from stdin");
    const json = r.stderr.slice(r.stderr.indexOf("{"));
    const report = JSON.parse(json) as { results: Array<{ path: string }> };
    expect(report.results.map((x) => x.path)).toEqual(["<stdin>"]);
  });

  it("refuses `-` without --as, exit 2", () => {
    const r = graph(["fill", "-", "--provider", "mock"], collections, stdinPage);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.\n",
    );
  });
});

describe("flags named for what they mean", () => {
  let graphPath: string;
  beforeAll(() => {
    graphPath = join(tmp("renames"), "g.ttl");
    const r = graph(["build", "-o", graphPath], collections);
    expect(r.status, r.stderr).toBe(0);
  });

  it("query takes --subject, --predicate and --object", () => {
    const r = graph(
      [
        "query",
        "--subject",
        "https://example.com/collections/doc/guides/intro.md",
        "--predicate",
        "dcterms:title",
        "--object",
        "Intro",
        "-g",
        graphPath,
      ],
      collections,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("1 match(es)");
  });

  for (const old of ["--s", "--p", "--o"]) {
    it(`query no longer answers to ${old}`, () => {
      const r = graph(["query", old, "x", "-g", graphPath], collections);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`unknown option '${old}'`);
    });
  }

  it("traverse takes --software-subject and refuses --subject", () => {
    const node = "https://example.com/collections/doc/guides/intro.md";
    const ok = graph(
      ["traverse", node, "-g", graphPath, "--software-subject", "nope"],
      collections,
    );
    expect(ok.status).toBe(2);
    expect(ok.stderr).toContain("Unknown software subject");
    const old = graph(
      ["traverse", node, "-g", graphPath, "--subject", "nope"],
      collections,
    );
    expect(old.status).toBe(2);
    expect(old.stderr).toContain("unknown option '--subject'");
  });

  it("embed refuses --model, which is now --embedding-model", () => {
    const r = graph(["embed", "-g", graphPath, "--model", "mock"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown option '--model'");
  });
});
