/**
 * `manni site …` against the built `dist/cli.js`. Each run works in a
 * throwaway directory with an empty `.git`, so the config search and the site
 * search both stop there. Overrides are `node -e` one-liners, so no docs
 * framework is installed; the one detected case runs a fake `hugo` from PATH.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const manni = resolve(here, "..", "..", "dist", "cli.js");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

let work: string;

function site(args: string[]): Run {
  const r = spawnSync(process.execPath, [manni, "site", ...args], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

/** A shell command line running `code` under this node; the trailing `--` lets passthrough reach argv. */
const nodeLine = (code: string): string => `"${process.execPath}" -e "${code}" --`;

/** `site.commands` as YAML, each value single-quoted so backslashes stay literal. */
function config(commands: Record<string, string>): void {
  const lines = Object.entries(commands).map(([k, v]) => `    ${k}: '${v.replaceAll("'", "''")}'`);
  writeFileSync(join(work, "manni.config.yaml"), ["site:", "  commands:", ...lines, ""].join("\n"));
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-site-cli-"));
  mkdirSync(join(work, ".git"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni site", () => {
  it("lists the three verbs in help", () => {
    const r = site(["--help"]);
    expect(r.status).toBe(0);
    for (const verb of ["start", "build", "preview"]) expect(r.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
  });

  it("shows usage and exits 2 with no verb, as key does", () => {
    const r = site([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Usage: manni site");
  });

  it("runs a build override and exits 0", () => {
    config({ build: nodeLine("console.log('built')") });
    const r = site(["build"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("built");
    expect(r.stderr).toContain("manni: Running site.commands.build in ./: ");
  });

  it("exits 2 naming the command when the build fails", () => {
    const line = nodeLine("process.exit(3)");
    config({ build: line });
    const r = site(["build"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`manni: ${line} exited with code 3.\n`);
  });

  it("runs build, then serve, for preview", () => {
    config({ build: nodeLine("console.log('step build')"), preview: nodeLine("console.log('step serve')") });
    const r = site(["preview"]);
    expect(r.status).toBe(0);
    expect(r.stdout.indexOf("step build")).toBeGreaterThanOrEqual(0);
    expect(r.stdout.indexOf("step build")).toBeLessThan(r.stdout.indexOf("step serve"));
  });

  it("appends what follows -- to the command, with and without [dir]", () => {
    mkdirSync(join(work, "website"));
    config({ build: nodeLine("console.log(JSON.stringify(process.argv.slice(1)))") });
    const bare = site(["build", "--", "--open", "x"]);
    expect(bare.status).toBe(0);
    expect(bare.stdout).toContain('["--open","x"]');
    expect(bare.stderr).toContain("in ./: ");

    const named = site(["build", "website", "--", "--open"]);
    expect(named.status).toBe(0);
    expect(named.stdout).toContain('["--open"]');
    expect(named.stderr).toContain("in website/: ");
  });

  it("does not read a flag after -- as manni's own", () => {
    config({ start: nodeLine("console.log(JSON.stringify(process.argv.slice(1)))") });
    const r = site(["start", "--", "--port", "4000"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('["--port","4000"]');
  });

  it("refuses a second [dir]", () => {
    const r = site(["build", "a", "b"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("too many arguments for 'build'");
  });

  it("refuses a --port that is not a port", () => {
    const r = site(["start", "--port", "abc"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('manni: --port must be an integer from 1 to 65535, got "abc".\n');
  });

  it("refuses --port with an override", () => {
    config({ start: nodeLine("0") });
    const r = site(["start", "--port", "4000"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: --port does not apply to site.commands.start. Put the port in that command.\n");
  });

  it("says where it looked when there is no site", () => {
    const r = site(["build"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: no docs site found in ./, docs/, website/ or site/. Pass the site's directory, or set site.commands.build in manni.config.yaml.\n",
    );
  });

  it("detects Hugo and runs hugo from PATH", () => {
    writeFileSync(join(work, "hugo.toml"), 'title = "x"\n');
    const bin = join(work, "bin");
    mkdirSync(bin);
    if (process.platform === "win32") {
      writeFileSync(join(bin, "hugo.cmd"), "@echo fake hugo %*\r\n");
    } else {
      writeFileSync(join(bin, "hugo"), '#!/bin/sh\necho fake hugo "$@"\n');
      chmodSync(join(bin, "hugo"), 0o755);
    }
    // One PATH key: Windows spells it `Path`, and a second spelling is a coin toss.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH")) as Record<
      string,
      string
    >;
    const r = spawnSync(process.execPath, [manni, "site", "build"], {
      cwd: work,
      encoding: "utf8",
      env: { ...env, NO_COLOR: "1", PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` },
    });
    expect(r.stderr).toContain("manni: Hugo in ./. Running hugo\n");
    expect(r.stdout).toContain("fake hugo");
    expect(r.status).toBe(0);
  });
});
