/**
 * The `graph fill` question ladder through the built bin (proposal 0087):
 * its usage errors, and an `--offline` run on a machine with no local model,
 * faked with the inference library's environment seams. Needs `npm run build`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { localModelEnv } from "../../helpers/local-model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = resolve(root, "test", "graph", "fixtures", "questions", "fill-pair");
const noModel = localModelEnv(false);
const dir = mkdtempSync(join(tmpdir(), "manni-graph-fill-questions-cli-"));
cpSync(fixture, dir, { recursive: true });

afterAll(() => {
  noModel.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function fill(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [cli, "graph", "fill", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...noModel.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe("manni graph fill, the question ladder", () => {
  it.each([
    [["--chunk-chars", "0"], "manni: --chunk-chars must be >= 1, got 0.\n"],
    [
      ["--fields", "questions"],
      'manni: --fields must be one of label | alt-labels | broader | narrower | related-concepts | concepts | type | applies-to | about-product-lifecycle | about-product-aspect | not-applicable-to | not-about-product-aspect | sample-questions, got "questions".\n',
    ],
    [
      ["--offline", "--provider", "anthropic"],
      "manni: --offline and --provider anthropic contradict each other: --offline sends nothing off this machine, so only llama-cpp with a model already downloaded can run. Drop one of them.\n",
    ],
  ])("refuses %j with exit 2", (args, stderr) => {
    const r = fill(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(stderr);
  });

  it("--offline with no local model re-pins, writes nothing on a dry run, and exits 0", () => {
    const before = readFileSync(join(dir, "docs", "retry.md"), "utf8");
    const r = fill("--fields", "sample-questions", "--dry-run", "--offline");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      [
        "proposed  docs/retry.md (sample-questions) — dry run, not written",
        '            re-pinned  "How many times does the client retry?"  lines 8',
        '            re-pinned  "How do I resume a paused upload?"  lines 9 to 12',
        "",
      ].join("\n"),
    );
    expect(r.stderr).toBe(
      "manni: no model is available offline, so only answer pins were updated, and nothing was drafted or proposed; download one first with --local, or drop --offline.\n",
    );
    expect(readFileSync(join(dir, "docs", "retry.md"), "utf8")).toBe(before);
  });
});
