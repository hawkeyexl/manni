/**
 * `manni site build` and `site preview` on a Flare project, against the built
 * `dist/cli.js` (proposal 0125, decision 22). Flare is never installed here:
 * the madbuild on PATH is the stand-in under test/fixtures/flare/, which
 * copies topics and writes a Default.htm. On Windows PATHEXT finds its
 * `madbuild.cmd`; elsewhere its `madbuild` shell shim.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const manni = resolve(here, "..", "..", "dist", "cli.js");
const fixtures = resolve(here, "..", "fixtures", "flare");
const user = process.env["USERNAME"] ?? userInfo().username;

let work: string;
let server: ChildProcess | undefined;

/** This environment with the stand-in first on PATH: one PATH key, since Windows spells it `Path`. */
function env(bin: string): NodeJS.ProcessEnv {
  const rest = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
  return { ...rest, NO_COLOR: "1", PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
}

function freePort(): Promise<number> {
  return new Promise((settle, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        settle(port);
      });
    });
  });
}

/** The first line the child prints to stdout: the server's URL. */
function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((settle, reject) => {
    let out = "";
    let err = "";
    child.stderr?.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const end = out.indexOf("\n");
      if (end >= 0) settle(out.slice(0, end));
    });
    child.once("exit", (code) => {
      reject(new Error(`site preview exited ${String(code)}: ${err}`));
    });
  });
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-flare-site-"));
  mkdirSync(join(work, ".git"));
  cpSync(join(fixtures, "widget"), join(work, "widget"), { recursive: true });
  // A copy, so the POSIX shim is executable whatever mode the checkout gave it.
  cpSync(join(fixtures, "madbuild-standin"), join(work, "bin"), { recursive: true });
  if (process.platform !== "win32") chmodSync(join(work, "bin", "madbuild"), 0o755);
});

afterEach(async () => {
  // Windows refuses to remove a folder a live process runs in, so wait for the
  // server to exit before removing its project.
  const child = server;
  server = undefined;
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((settle) => child.once("exit", settle));
    child.kill();
    await exited;
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("manni site on a Flare project, with the stand-in madbuild", () => {
  it("builds the configured target, then previews it", async () => {
    const project = join(work, "widget");
    const build = spawnSync(process.execPath, [manni, "site", "build"], {
      cwd: project,
      encoding: "utf8",
      env: env(join(work, "bin")),
    });
    expect(build.stderr).toContain("manni: Flare in ./. Running madbuild -project Widget.flprj -target HTML5\n");
    expect(build.stdout).toContain(`stand-in madbuild: built HTML5 into Output/${user}/HTML5`);
    expect(build.status).toBe(0);
    expect(existsSync(join(project, "Output", user, "HTML5", "Default.htm"))).toBe(true);

    const port = await freePort();
    server = spawn(process.execPath, [manni, "site", "preview", "--port", String(port)], {
      cwd: project,
      env: env(join(work, "bin")),
    });
    expect(await firstLine(server)).toBe(`http://127.0.0.1:${String(port)}/`);
    for (const path of ["/", "/Content/Topics/Install.htm"]) {
      const res = await fetch(`http://127.0.0.1:${String(port)}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      await res.text();
    }
  }, 30_000);
});
