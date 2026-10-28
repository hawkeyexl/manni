/**
 * Proposal 0125's worked example through the real CLI: the widget project,
 * whose collection holds a TOC as well as topics and a snippet. A TOC is a
 * format meta does not read, so chunks must leave it out of the pins and
 * dates it asks cite and derive for, rather than exit 2 on it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "fixtures", "flare", "widget");

function graph(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd, env: hermeticEnv() });
}

describe("graph export chunks over the widget project", () => {
  it("exports a collection holding a TOC, with each topic's resolved text", () => {
    const corpus = mkdtempSync(join(tmpdir(), "manni-graph-flare-widget-"));
    cpSync(fixture, corpus, { recursive: true });
    expect(graph(["build"], corpus).status).toBe(0);
    const r = graph(["export", "chunks", "-o", "out"], corpus);
    expect(r.status, r.stderr).toBe(0);
    const lines = readdirSync(join(corpus, "out"))
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => readFileSync(join(corpus, "out", f), "utf8"))
      .join("");
    expect(lines).toContain("Version 4.3 needs Node 20.");
    expect(lines).not.toContain("MadCap:variable");
    expect(lines).not.toContain("This paragraph prints only.");
  });
});
