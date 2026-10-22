/**
 * `manni site …` against the built `dist/cli.js`. Each run works in a
 * throwaway directory with an empty `.git`, so the config search and the site
 * search both stop there. Overrides are `node -e` one-liners, so no docs
 * framework is installed; the one detected case runs a fake `hugo` from PATH.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  it("lists the four verbs in help", () => {
    const r = site(["--help"]);
    expect(r.status).toBe(0);
    for (const verb of ["start", "build", "preview", "annotate"]) expect(r.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
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

describe("manni site annotate (proposal 0095)", () => {
  const SUCCESS =
    "site/dist: 2 pages annotated. 5 of 8 pins placed, 3 listed on their page only. 2 blocks carry a verification.\n";

  beforeEach(() => {
    cpSync(join(here, "fixtures", "annotate"), work, { recursive: true });
  });

  const yamlQuote = (v: string): string => `'${v.replaceAll("'", "''")}'`;

  /** The fixture's config, plus `extra` under `site:`. */
  const siteConfig = (extra: string): void => {
    writeFileSync(join(work, "manni.config.yaml"), `site:\n  dir: site\n${extra}graph:\n  out: graph/graph.ttl\n`);
  };

  it("annotates the built site, prints the success line and exits 0", () => {
    const r = site(["annotate"]);
    expect(r.status).toBe(0);
    expect(r.stderr.startsWith("manni: Starlight in site/. Annotating site/dist from graph/chunks.json.\n")).toBe(true);
    expect(r.stderr).toContain("manni: site/src/content/docs/missing.md could not be read, so its pins are placed by line alone: ");
    expect(r.stdout.startsWith(SUCCESS)).toBe(true);
    expect(r.stdout).toContain("  plain/index.html: 1 pin not placed, because its text appears twice: repeat.\n");
  });

  it("prints the JSON report with -f json", () => {
    const r = site(["annotate", "-f", "json"]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(["out", "pages", "pins", "statements", "unplaced", "drifted"]);
  });

  it("takes every option at once", () => {
    const r = site(["annotate", "site", "--out", "site/dist", "--chunks", "graph/chunks.json", "-f", "json", "-c", "manni.config.yaml"]);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { pages: number }).pages).toBe(2);
  });

  it("exits 2 on an unknown format", () => {
    const r = site(["annotate", "-f", "sarif"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('manni: Unknown --format "sarif". Use pretty or json.\n');
  });

  it("exits 2 with no built site", () => {
    rmSync(join(work, "site", "dist"), { recursive: true });
    const r = site(["annotate"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: no built site at site/dist. Run manni site build first, or pass --out.\n");
  });

  it("exits 2 with no chunk artifact", () => {
    rmSync(join(work, "graph"), { recursive: true });
    const r = site(["annotate"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: graph/chunks.json does not exist; run manni graph publish.\n");
  });

  it("exits 2 on a wrong after-build type", () => {
    siteConfig("  annotate:\n    after-build: yes please\n");
    const r = site(["annotate"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: manni.config.yaml: site.annotate.after-build must be a boolean.\n");
  });

  it("annotates after site build when after-build is true", () => {
    siteConfig(`  commands:\n    build: ${yamlQuote(nodeLine("console.log('built')"))}\n  annotate:\n    after-build: true\n`);
    const r = site(["build"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`built\\n${SUCCESS.replace(/\./g, "\\.")}`));
  });

  it("annotates before preview serves", () => {
    siteConfig(
      `  commands:\n    build: ${yamlQuote(nodeLine("console.log('built')"))}\n    preview: ${yamlQuote(nodeLine("console.log('served')"))}\n  annotate:\n    after-build: true\n`,
    );
    const r = site(["preview"]);
    expect(r.status).toBe(0);
    expect(r.stdout.indexOf("pages annotated")).toBeGreaterThan(r.stdout.indexOf("built"));
    expect(r.stdout.indexOf("served")).toBeGreaterThan(r.stdout.indexOf("pages annotated"));
  });

  it("never annotates start", () => {
    siteConfig(`  commands:\n    start: ${yamlQuote(nodeLine("console.log('dev')"))}\n  annotate:\n    after-build: true\n`);
    const r = site(["start"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("annotated");
  });

  it("does not annotate a failed build", () => {
    siteConfig(`  commands:\n    build: ${yamlQuote(nodeLine("process.exit(3)"))}\n  annotate:\n    after-build: true\n`);
    const r = site(["build"]);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain("annotated");
  });
});
