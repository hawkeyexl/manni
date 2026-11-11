/**
 * The proposal 0128 ladder against the built `dist/cli.js`: `vector build`
 * and `vector search` from the minimum to every option, then each exit 2,
 * and the two graph surfaces the domain replaced.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hermeticEnv } from "../graph/helpers/git-env.js";
import { CORPUS_SOURCE, detachedCorpus } from "../graph/helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "test", "graph", "fixtures");

function manni(args: string[], cwd: string, input?: string) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
    ...(input === undefined ? {} : { input }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `manni-vector-cli-${prefix}-`));
}

/** The monolingual collections fixture, copied so the default directory is a temp one. */
function collections(): string {
  const dir = tmp("collections");
  cpSync(join(fixtures, "collections"), dir, { recursive: true });
  return dir;
}

const OFFLINE = ["--embedding-model", "mock", "--no-cache"];

describe("manni vector", () => {
  it("lists build and search", () => {
    const r = manni(["vector", "--help"], root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\s+build \[options\] \[paths\.\.\.\]/m);
    expect(r.stdout).toMatch(/^\s+search \[options\] <query>/m);
  });

  it("is listed by the umbrella", () => {
    expect(manni(["--help"], root).stdout).toMatch(/^\s+vector /m);
  });
});

describe("vector build ladder", () => {
  it("builds every collection beside graph.out, and writes no graph.ttl", () => {
    const dir = collections();
    const r = manni(["vector", "build", ...OFFLINE], dir);
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^Indexed \d+ pages: \d+ entries in 1 language$/);
    expect(lines[1]).toBe("Wrote 1 sidecar, recorded in graph/localizations.json");
    expect(lines[2]).toMatch(/^ {2}und: \d+ vectors \(\d+-d, mock\) -> graph\/vectors\.und\.bin$/);
    expect(lines[3]).toMatch(/^ {2}\d+ embedded, 0 from cache$/);
    expect(existsSync(join(dir, "graph", "search.und.json"))).toBe(true);
    expect(existsSync(join(dir, "graph", "graph.ttl"))).toBe(false);
  });

  it("builds one collection as JSON", () => {
    const dir = collections();
    const r = manni(["vector", "build", "--collection", "guides", ...OFFLINE, "-f", "json"], dir);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown> & {
      languages: Array<Record<string, unknown>>;
    };
    expect(report.manifestPath).toBe("graph/localizations.json");
    expect(Object.keys(report.languages[0] ?? {})).toEqual([
      "language",
      "searchPath",
      "entries",
      "outPath",
      "model",
      "dims",
      "embedded",
      "cached",
      "total",
    ]);
  });

  it("takes every option at once", () => {
    const corpus = detachedCorpus();
    const out = tmp("every");
    const draft = readFileSync(join(fixtures, "stdin-page.md"), "utf8");
    const r = manni(
      [
        "vector",
        "build",
        "docs",
        "-",
        "--as",
        "markdown",
        "--exclude",
        "**/fr/**",
        "--ext",
        ".md",
        "--no-authoring",
        "--embedding-model",
        "mock",
        "--dtype",
        "fp32",
        "--no-cache",
        "-o",
        out,
        "-c",
        "manni.config.yaml",
        "-f",
        "pretty",
      ],
      corpus,
      draft,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Wrote ");
    expect(existsSync(join(out, "search.fr.json"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(out, "localizations.json"), "utf8")) as {
      languages: Array<{ vectors?: { dtype: string } }>;
    };
    expect(manifest.languages.every((l) => l.vectors?.dtype === "fp32")).toBe(true);
  });

  it("refuses --model, exit 2", () => {
    const r = manni(["vector", "build", "--model", "gte"], root);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("error: unknown option '--model'\n(add --help for usage)\n");
  });
});

describe("vector search ladder", () => {
  let dir: string;
  beforeAll(() => {
    dir = collections();
    const r = manni(["vector", "build", ...OFFLINE], dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it("answers from the only language with no options", () => {
    const r = manni(["vector", "search", "intro guide"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\n\d+ results? \(vector\)\n$/);
  });

  it("prints JSON with mode vector and no lexical leg", () => {
    const r = manni(["vector", "search", "intro guide", "-f", "json"], dir);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout) as { mode: string; lexical: unknown[]; results: unknown[] };
    expect(report.mode).toBe("vector");
    expect(report.lexical).toEqual([]);
  });

  it("takes every option at once", () => {
    const r = manni(
      ["vector", "search", "intro guide", "-i", "graph", "--lang", "und", "--limit", "1", "-c", "manni.config.yaml", "-f", "pretty"],
      dir,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("1 result (vector)");
  });

  it("has no --mode", () => {
    const r = manni(["vector", "search", "x", "--mode", "hybrid"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown option '--mode'");
  });

  it("names manni vector build when nothing is built, exit 2", () => {
    const bare = collections();
    const r = manni(["vector", "search", "x"], bare);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `manni: Localization manifest not found: ${join(realpathSync(bare), "graph", "localizations.json")} — run \`manni vector build\` first.\n`,
    );
  });

  it("names manni vector build when only graph export search ran, exit 2", () => {
    const lexical = collections();
    expect(manni(["graph", "build"], lexical).status).toBe(0);
    expect(manni(["graph", "export", "search"], lexical).status).toBe(0);
    const r = manni(["vector", "search", "x"], lexical);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      'manni: Vector index not found: no sidecar recorded for "und" — run `manni vector build` first.\n',
    );
  });

  it("asks for --lang when the corpus has several languages, exit 2", () => {
    const corpus = detachedCorpus();
    expect(manni(["vector", "build", ...OFFLINE], corpus).status).toBe(0);
    const r = manni(["vector", "search", "x"], corpus);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: This corpus has more than one localization (de, de-AT, fr, und) — pass --lang to choose one.\n",
    );
  });
});

describe("the graph surfaces vector replaced", () => {
  it("graph embed moved to manni vector build, exit 2", () => {
    const r = manni(["graph", "embed", "--embedding-model", "mock"], root);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: graph embed moved to manni vector build.\n");
  });

  it("graph --help no longer lists embed", () => {
    const r = manni(["graph", "--help"], root);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/^\s+embed\b/m);
  });

  it("graph search --mode vector points at vector search, exit 2", () => {
    const r = manni(["graph", "search", "x", "--mode", "vector"], CORPUS_SOURCE);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      'manni: Unknown --mode "vector". Use lexical | hybrid. For vector-only ranking, run manni vector search.\n',
    );
  });

  it("graph search --mode names only lexical and hybrid otherwise", () => {
    const r = manni(["graph", "search", "x", "--mode", "fused"], CORPUS_SOURCE);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('manni: Unknown --mode "fused". Use lexical | hybrid.\n');
  });

  it("refuses graph.embed in a config, exit 2", () => {
    const dir = collections();
    const config = join(dir, "embed.config.yaml");
    writeFileSync(config, `${readFileSync(join(dir, "manni.config.yaml"), "utf8")}  embed:\n    model: mock\n`);
    const r = manni(["graph", "build", "-c", "embed.config.yaml"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      'manni: embed.config.yaml: "embed" is no longer a graph key. Embedding settings live under a top-level vector: section. See https://hawkeyexl.github.io/manni/vector/reference/configuration/\n',
    );
  });
});

