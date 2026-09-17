/**
 * The bin runner when the reader of stdout or stderr has gone away, as in
 * `manni cite check | head -1`. Against the built `dist/`, because the crash
 * is an unhandled `error` event on the real process streams, which no
 * in-process test reaches.
 *
 * The reader is a Node parent that destroys its end of the pipe before the
 * child writes anything, rather than a POSIX `head`: that runs the same on
 * Windows, macOS and Linux, and it makes the very first write fail instead of
 * depending on how much output fits in a pipe buffer.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const docmeta = resolve(root, "dist", "docmeta.js");

interface Closed {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** Run a bin with its stdout (and optionally stderr) reader closed at once. */
function runClosed(
  bin: string,
  args: string[],
  opts: { closeStderr?: boolean } = {},
): Promise<Closed> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    child.stdout.destroy();
    let stderr = "";
    if (opts.closeStderr === true) {
      child.stderr.destroy();
    } else {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (status, signal) => {
      done({ status, signal, stderr });
    });
  });
}

function expectQuiet(r: Closed): void {
  expect(r.signal).toBeNull();
  expect(r.stderr).not.toMatch(/Unhandled 'error' event/);
  expect(r.stderr).not.toMatch(/EPIPE/);
  expect(r.stderr).not.toMatch(/Unexpected error/);
}

describe("a bin whose output reader closes early", () => {
  beforeAll(() => {
    if (!existsSync(manni) || !existsSync(docmeta)) {
      execSync("npm run build", { cwd: root, stdio: "ignore" });
    }
  }, 180000);

  it("exits quietly with the command's own exit code, 0 when it passes", async () => {
    const r = await runClosed(manni, [
      "meta",
      "validate",
      "-f",
      "json",
      "test/fixtures/valid.md",
    ]);
    expectQuiet(r);
    expect(r.status).toBe(0);
  });

  it("keeps exit 1 for findings, so a pipefail pipeline still fails", async () => {
    const r = await runClosed(manni, [
      "meta",
      "validate",
      "test/fixtures/missing-type.md",
    ]);
    expectQuiet(r);
    expect(r.status).toBe(1);
  });

  it("exits quietly for every domain's output, help included", async () => {
    for (const args of [
      ["cite", "check", "--help"],
      ["term", "list", "--help"],
      ["a11y", "check", "--help"],
      ["--help"],
    ]) {
      const r = await runClosed(manni, args);
      expectQuiet(r);
      expect(r.status, args.join(" ")).toBe(0);
    }
  });

  it("covers the docmeta bin too", async () => {
    const r = await runClosed(docmeta, ["-f", "json", "test/fixtures/valid.md"]);
    expectQuiet(r);
    expect(r.status).toBe(0);
  });

  it("exits quietly when stderr's reader is gone as well", async () => {
    const r = await runClosed(
      manni,
      ["meta", "validate", "test/fixtures/valid.md"],
      { closeStderr: true },
    );
    // Nothing to read on stderr, so the exit code is the evidence: a crash
    // exits 1 where this command passes with 0.
    expect(r.signal).toBeNull();
    expect(r.status).toBe(0);
  });
});
