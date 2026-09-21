/**
 * `manni lint`'s command grammar, against the built bin.
 *
 * The verbs, the shared input surface, and the config keys are the contract a
 * workflow is written against, and every one of them is only real after a
 * build: the CLI is a commander program, and a flag that does not exist is a
 * usage error rather than a type error. So this suite runs `dist/cli.js` the
 * way CI does.
 *
 * Proposal 0034 is why there is no default subcommand: a bare `manni lint` is
 * a usage error that lists the verbs, exactly as `manni cite` is. Proposal
 * 0041 is why `paths:` and `exclude:` are refused under `lint:` - a document
 * set is declared once, for every tool, under `collections:`.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DOC,
  gitAvailable,
  makeTempRepo,
  removeTempRepo,
} from "../../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const manni = resolve(root, "dist", "cli.js");

const COLLECTIONS = "test/lint/fixtures/collections/manni.config.yaml";
const HOW_TO = "test/lint/fixtures/formats/how-to.md";
const BROKEN = "test/lint/fixtures/formats/how-to-broken.md";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * `spawnSync`, not `execFileSync`: this suite asserts on what a *successful*
 * run says on stderr (the config line, the jobs line), and `execFileSync`
 * hands back stdout alone unless the command failed.
 */
function run(args: string[], opts: { cwd?: string; input?: string } = {}): Run {
  const result = spawnSync("node", [manni, "lint", ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  // `status` is null only when a signal killed the child, which nothing here
  // does; the two streams are strings because `encoding` is set.
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

let temp: string | undefined;

afterEach(() => {
  removeTempRepo(temp);
  temp = undefined;
});

describe("manni lint (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(manni)) {
      execSync("npm run build", { cwd: root, stdio: "ignore" });
    }
  }, 180000);

  describe("the domain's verbs", () => {
    // Proposal 0034: the umbrella owns no verbs, a domain owns nothing but
    // verbs, and `manni lint docs/` is no longer one of them.
    it("is a usage error on its own, listing what it can do", () => {
      const bare = run([]);
      expect(bare.status).toBe(2);
      expect(bare.stdout).toBe("");
      expect(bare.stderr).toMatch(/^Usage: manni lint /m);
      for (const verb of ["check", "structure", "templates", "tools"]) {
        expect(bare.stderr).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
      }
    });

    it("spells each verb in its own usage line", () => {
      for (const verb of ["check", "structure", "templates", "tools"]) {
        const help = run([verb, "--help"]);
        expect(help.status).toBe(0);
        expect(help.stdout).toMatch(new RegExp(`^Usage: manni lint ${verb} `, "m"));
      }
    });
  });

  describe("structure", () => {
    it("lints a clean page (exit 0) and a broken one (exit 1)", () => {
      const ok = run(["structure", HOW_TO, "-t", "tgdp:how-to:1.6"]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("1 passed");

      const bad = run(["structure", BROKEN, "-t", "tgdp:how-to:1.6"]);
      expect(bad.status).toBe(1);
    });

    it("explains how each page routed, and lints nothing", () => {
      const r = run(["structure", HOW_TO, "--explain"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("1 routed");
    });

    it("reads stdin behind --as", () => {
      const r = run(["structure", "-", "--as", "markdown", "-t", "tgdp:how-to:1.6"], {
        input: "# T\n\n## Overview\n\nWhy.\n\n## Do it\n\nHow.\n\n## See also\n\nMore.\n",
      });
      expect(r.stdout).toContain("<stdin>");
    });

    // The tool performing the job is named, not assumed: `structure` is a job
    // a second tool could perform, and a value nothing implements must not
    // fall through to manni's engine.
    it("accepts --tool manni and refuses anything else", () => {
      expect(run(["structure", HOW_TO, "-t", "tgdp:how-to:1.6", "--tool", "manni"]).status).toBe(0);

      const wrong = run(["structure", HOW_TO, "--tool", "vale"]);
      expect(wrong.status).toBe(2);
      expect(wrong.stderr).toContain('Unknown --tool "vale" for structure. Use manni.');
    });

    // One separator per list: `--templates` takes one path per occurrence,
    // never a space- or comma-separated batch.
    it("takes one --templates path per occurrence", () => {
      const help = run(["structure", "--help"]);
      expect(help.stdout).toContain("--templates <path>");
      expect(help.stdout).not.toContain("--templates <path...>");
    });

    it("prints the tool's options in their own help group", () => {
      const help = run(["structure", "--help"]);
      const options = help.stdout.indexOf("Options:");
      const tools = help.stdout.indexOf("Tool options:");
      expect(tools).toBeGreaterThan(options);
      // The shared options stay above; the tool's own sit under the heading.
      expect(help.stdout.slice(tools)).toContain("--explain");
      expect(help.stdout.slice(options, tools)).toContain("--collection");
    });
  });

  describe("check", () => {
    it("runs the configured jobs and says which", () => {
      const r = run(["check", HOW_TO, "--no-config"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("Checked: structure.");
      expect(r.stdout).toContain("1 passed");
    });

    // The line is a diagnostic about the run, so it stays out of anything a
    // machine parses.
    it("says nothing extra under a machine format", () => {
      const r = run(["check", HOW_TO, "--no-config", "-f", "json"]);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Checked:");
      expect(JSON.parse(r.stdout)).toHaveLength(1);
    });

    // `check` is the whole-suite verb, so it carries the shared options only.
    // Anything belonging to the tool that performs a job lives on the job.
    it("carries no tool options", () => {
      for (const flag of ["--tool", "-t", "--templates", "--explain"]) {
        const r = run(["check", HOW_TO, flag, "x"]);
        expect(r.status, flag).toBe(2);
        expect(r.stderr, flag).toMatch(/unknown option/);
      }
    });
  });

  describe("tools", () => {
    it("reports the structure job, its tool, and the formats it reads", () => {
      const r = run(["tools", "--no-config"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("structure");
      expect(r.stdout).toContain("manni");
      expect(r.stdout).toContain("built-in defaults");
      expect(r.stdout).toContain("markdown  Markdown (.md, .markdown)");
      // A listed format is one the tool reads, so no row carries a state that
      // would imply formats in some other state.
      expect(r.stdout).not.toMatch(/implemented|planned/);
    });

    it("answers as JSON, one row per job", () => {
      const r = run(["tools", "--no-config", "-f", "json"]);
      expect(r.status).toBe(0);
      const rows = JSON.parse(r.stdout);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        job: "structure",
        tool: "manni",
        configured: false,
        available: true,
        config: "built-in defaults",
      });
      expect(typeof rows[0].version).toBe("string");
      // Every format the tool reads, which is exactly what `--as` accepts. A
      // row is a name, a label, its extensions, and the content kinds it
      // emits, and nothing that implies a format in some other state.
      const formats = rows[0].formats as Record<string, unknown>[];
      expect(formats.length).toBeGreaterThan(1);
      for (const format of formats) {
        expect(Object.keys(format).sort()).toEqual(["extensions", "kinds", "label", "name"]);
      }
      expect(formats.some((f) => f.name === "markdown")).toBe(true);
    });

    it("names the config it read, and calls the job configured", () => {
      const r = run(["tools", "-c", COLLECTIONS, "-f", "json"]);
      const rows = JSON.parse(r.stdout);
      expect(rows[0]).toMatchObject({ configured: true, config: COLLECTIONS });
    });

    // `tools` lists the formats; there is no `formats` verb.
    it("has replaced the formats verb", () => {
      const r = run(["formats"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/unknown command/);
    });
  });

  describe("the document set", () => {
    it("comes from the collections when no paths are given", () => {
      const r = run(["check", "-c", COLLECTIONS]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("rotate-a-key.md");
      expect(r.stdout).toContain("list-keys.md");
      // The collection's own `exclude:` still shapes it.
      expect(r.stdout).not.toContain("half-written.md");
    });

    it("narrows to one named collection", () => {
      const r = run(["check", "-c", COLLECTIONS, "--collection", "guides"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("rotate-a-key.md");
      expect(r.stdout).not.toContain("list-keys.md");
    });

    it("refuses --collection beside paths", () => {
      const r = run(["check", HOW_TO, "-c", COLLECTIONS, "--collection", "guides"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(
        "--collection selects a configured collection; it cannot be combined with paths.",
      );
    });

    it("refuses --collection with no config to select from", () => {
      const r = run(["check", "--collection", "guides", "--no-config"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("--collection needs a config file to select from.");
    });

    it("is an error when nothing names one", () => {
      const r = run(["check", "--no-config"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(
        "No files to check. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
      );
    });

    it("narrows a walk with --ext", () => {
      const r = run([
        "check",
        "test/lint/fixtures/collections",
        "--no-config",
        "--ext",
        ".mdx",
        "--allow-empty",
      ]);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("rotate-a-key.md");
    });

    it("narrows a walk with a repeatable --exclude", () => {
      const r = run([
        "check",
        "test/lint/fixtures/collections",
        "--no-config",
        "--exclude",
        "**/drafts/**",
        "--exclude",
        "**/api/**",
      ]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("rotate-a-key.md");
      expect(r.stdout).not.toContain("half-written.md");
      expect(r.stdout).not.toContain("list-keys.md");
    });

    it("treats a glob that matched nothing as an error, and --allow-empty as a pass", () => {
      const missed = run(["check", "no-such-dir/**/*.md", "--no-config"]);
      expect(missed.status).toBe(2);
      expect(missed.stderr).toContain("No files matched");

      const allowed = run(["check", "no-such-dir/**/*.md", "--no-config", "--allow-empty"]);
      expect(allowed.status).toBe(0);
    });

    it.skipIf(!gitAvailable())("skips what .gitignore covers unless told not to", () => {
      temp = makeTempRepo({
        files: {
          ".gitignore": "ignored/\n",
          "docs/page.md": DOC,
          "ignored/page.md": DOC,
        },
      });
      const args = ["check", ".", "--no-config", "--explain"];
      const on = run(["structure", ...args.slice(1)], { cwd: temp });
      expect(on.stdout).toContain("docs/page.md");
      expect(on.stdout).not.toContain("ignored/page.md");

      const off = run(["structure", ...args.slice(1), "--no-gitignore"], { cwd: temp });
      expect(off.stdout).toContain("ignored/page.md");
    });
  });

  describe("the lint: section", () => {
    it("refuses paths:, pointing at collections:", () => {
      const r = run(["check", HOW_TO, "-c", "test/lint/fixtures/config/moved-paths.yaml"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('"paths" is no longer a lint key');
      expect(r.stderr).toContain("under a top-level collections: list");
    });

    it("refuses exclude: the same way", () => {
      const r = run(["check", HOW_TO, "-c", "test/lint/fixtures/config/moved-exclude.yaml"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('"exclude" is no longer a lint key');
    });

    it("refuses a structure tool nothing implements", () => {
      const r = run(["check", HOW_TO, "-c", "test/lint/fixtures/config/unknown-tool.yaml"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("lint.structure.tool must be one of: manni.");
    });

    it("is skipped entirely under --no-config", () => {
      const r = run([
        "check",
        HOW_TO,
        "-c",
        "test/lint/fixtures/config/moved-paths.yaml",
        "--no-config",
      ]);
      // --no-config wins over an explicit path: the file is never read, so the
      // key it carries is never refused.
      expect(r.status).toBe(0);
    });

    it("says which config governed the run", () => {
      const r = run(["check", "-c", COLLECTIONS]);
      expect(r.stdout).toContain("Using manni.config.yaml");
    });
  });

  describe("templates", () => {
    it("lists the built-in doctype templates", () => {
      const r = run(["templates", "--no-config"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("tgdp:how-to:1.6");
    });

    it("takes one --templates path per occurrence", () => {
      const help = run(["templates", "--help"]);
      expect(help.stdout).toContain("--templates <path>");
      expect(help.stdout).not.toContain("--templates <path...>");
    });

    // `infer` is the escape from a format that is strict by default: proposal
    // 0061's stress test 5 says the two ship together. The round trip is
    // covered in `test/lint/unit/infer.test.ts`; what is only real after a
    // build is the grammar - a third level under the `templates` noun, and a
    // `templates` verb that still lists.
    describe("infer", () => {
      it("writes a template to stdout", () => {
        const r = run(["templates", "infer", HOW_TO, "--no-config"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("templates:");
        expect(r.stdout).toContain("heading:");
      });

      it("takes exactly one page", () => {
        const help = run(["templates", "infer", "--help"]);
        expect(help.status).toBe(0);
        expect(help.stdout).toMatch(/^Usage: manni lint templates infer /m);
        expect(help.stdout).toContain("<page>");
        expect(help.stdout).not.toContain("<page...>");

        const two = run(["templates", "infer", HOW_TO, BROKEN, "--no-config"]);
        expect(two.status).toBe(2);
        expect(two.stderr).toContain("too many arguments");
      });

      it("is a usage error with no page at all", () => {
        const r = run(["templates", "infer", "--no-config"]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("missing required argument 'page'");
      });

      it("reads stdin only with --as", () => {
        const piped = run(["templates", "infer", "-", "--as", "markdown", "--no-config"], {
          input: "# Title\n\nProse.\n",
        });
        expect(piped.status).toBe(0);
        expect(piped.stdout).toContain("heading: Title");

        const bare = run(["templates", "infer", "-", "--no-config"], {
          input: "# Title\n",
        });
        expect(bare.status).toBe(2);
        expect(bare.stderr).toContain(
          "manni: Reading from stdin (-) requires --as <format> to choose a parser.",
        );
      });

      it("refuses a format it could not load back", () => {
        const r = run(["templates", "infer", HOW_TO, "-f", "xml", "--no-config"]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('manni: Unknown --format "xml". Use yaml or json.');
      });

      it("will not overwrite --out without --force", () => {
        const dir = makeTempRepo({ files: { "page.md": DOC }, init: false });
        temp = dir;
        const out = "./templates.yaml";
        const first = run(["templates", "infer", "page.md", "-o", out, "--no-config"], {
          cwd: dir,
        });
        expect(first.status).toBe(0);
        expect(existsSync(join(dir, "templates.yaml"))).toBe(true);

        const again = run(["templates", "infer", "page.md", "-o", out, "--no-config"], {
          cwd: dir,
        });
        expect(again.status).toBe(2);
        expect(again.stderr).toContain(
          `manni: ${out} exists. Pass --force to overwrite it.`,
        );

        const forced = run(
          ["templates", "infer", "page.md", "-o", out, "--force", "--no-config"],
          { cwd: dir },
        );
        expect(forced.status).toBe(0);
      });
    });
  });
});

// A stale import guard: the walker lint used to own is gone, and the family's
// is what every tool now resolves targets with.
describe("the lint package", () => {
  it("no longer carries a resolver of its own", () => {
    expect(existsSync(join(root, "src", "lint", "core", "load-files.ts"))).toBe(false);
  });
});
