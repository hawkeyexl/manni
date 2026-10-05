/**
 * `manni check` and `manni status` against the built `dist/cli.js`: the
 * family contract by hand, every usage error in the plan with its exact
 * stderr line and exit code, and the hook protocol for each envelope.
 *
 * Every run works in a temp copy of a fixture repository, outside this
 * checkout, so the root manni.config.yaml is never discovered. stdin is
 * always given, even when empty, so a run by hand reads it closed rather than
 * waiting out the envelope timeout.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { gitAvailable, removeTempRepo } from "../helpers/temp-repo.js";
import { envelope, fixtureRepo } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: string[], cwd: string, input = "", env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(process.execPath, [manni, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", MANNI_GENERATED_BY: undefined, CLAUDE_ENV_FILE: undefined, ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function edit(dir: string, rel: string, change: (text: string) => string): void {
  const path = join(dir, rel);
  writeFileSync(path, change(readFileSync(path, "utf8")));
}

const addTodo = (t: string): string => `${t}\nTODO: finish this.\n`;

let dir: string | undefined;
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

describe.skipIf(!gitAvailable())("manni check, by hand", () => {
  it("exits 0 on a clean repository, with the summary last", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^skipped {2}meta validate +no meta: section$/m);
    expect(r.stdout.trimEnd()).toMatch(/\d+ checks over 1 file: 0 failed, \d+ skipped$/);
  });

  it("exits 1 on errors", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check"], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/: 1 failed, /);
  });

  it("names the files outside every collection on stderr, and checks the rest", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check", "docs/page.md", "README.md"], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("manni: Skipped 1 file outside every collection: README.md\n");
  });

  it("-f json prints one object", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check", "docs/", "-f", "json", "--no-color"], dir);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { status: string; files: string[]; checks: { command: string }[] };
    expect(doc.status).toBe("pass");
    expect(doc.files).toEqual(["docs/page.md"]);
  });

  it("-f github is the domains' own annotations", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check", "-f", "github"], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::error /m);
  });

  it("-c names the config", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check", "docs/page.md", "-c", "manni.config.yaml", "-f", "json"], dir);
    expect(r.status).toBe(0);
  });

  it("a check that could not run: exit 2, and the others still report", () => {
    dir = fixtureRepo("everything");
    writeFileSync(join(dir, "templates.yaml"), "templates:\n  concept:\n    heading: 7\n");
    const r = run(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni lint check could not run: .+/m);
    expect(r.stdout).toContain("graph check\n");
  });

  it("an unknown format is a usage error", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check", "-f", "sarif"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe(
      "error: option '-f, --format <format>' argument 'sarif' is invalid. Allowed choices are pretty, json, github.",
    );
  });

  it("no config: exit 2", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
    dir = bare;
    const r = run(["check"], bare);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `manni: No manni.config.yaml found from ${bare} up to the repository root. manni check runs the checks it sets up.\n`,
    );
  });

  it("nothing set up: exit 2", () => {
    dir = fixtureRepo("only-docevals");
    writeFileSync(join(dir, "manni.config.yaml"), 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n');
    const r = run(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: Nothing is set up to check in manni.config.yaml. manni status says what each domain needs.\n",
    );
  });

  it("the umbrella still says where a metadata verb went", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["validate"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(`validate` is a metadata command: try `manni meta validate`)");
  });
});

describe.skipIf(!gitAvailable())("manni check, under a hook", () => {
  it("PostToolUse on a member page with errors: exit 2 and the report on stderr", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check"], dir, envelope("post-tool-use-member", dir));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr.startsWith("manni found errors in docs/page.md. Fix them before you continue.\n\n")).toBe(true);
    expect(r.stderr).toContain("docevals run\n");
  });

  it("PostToolUse on a clean member page: exit 0 and nothing", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check"], dir, envelope("post-tool-use-member", dir));
    expect(r).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("PostToolUse on CLAUDE.md, outside every collection: exit 0 and nothing", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check"], dir, envelope("post-tool-use-claude-md", dir));
    expect(r).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("PostToolUse where a check could not run: context on stdout, exit 0", () => {
    dir = fixtureRepo("everything");
    writeFileSync(join(dir, "templates.yaml"), "templates:\n  concept:\n    heading: 7\n");
    const r = run(["check"], dir, JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(dir, "docs", "limits.md") },
      cwd: dir,
    }));
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(doc.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(doc.hookSpecificOutput.additionalContext).toMatch(
      /^manni lint check could not check docs\/limits\.md: .+$/,
    );
  });

  it("Stop on a clean tree: exit 0 and nothing", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["check"], dir, envelope("stop", dir));
    expect(r).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("Stop with errors: a block decision, exit 0", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check"], dir, envelope("stop", dir));
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(doc.decision).toBe("block");
    expect(doc.reason.startsWith("manni found errors in the files you changed. Fix them, then finish.\n\n")).toBe(true);
  });

  it("Stop with errors after one repair pass: a message for the user, exit 0", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check"], dir, envelope("stop-hook-active", dir));
    expect(r).toEqual({
      stdout: '{"systemMessage":"manni still reports errors after one repair pass. Run manni check to see them."}\n',
      stderr: "",
      status: 0,
    });
  });

  it("no config: exit 0 and nothing", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
    dir = bare;
    expect(run(["check"], bare, envelope("stop", bare))).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("positional paths win over the envelope's own scope", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check", "docs/page.md"], dir, envelope("post-tool-use-claude-md", dir));
    expect(r.status).toBe(2);
  });
});

describe.skipIf(!gitAvailable())("manni status", () => {
  it("by hand: the table, exit 0", () => {
    dir = fixtureRepo("only-graph");
    const r = run(["status"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^manni \S+ {3}config manni\.config\.yaml {3}collection site \(\d+ files?\)\n\n/);
    expect(r.stdout).toMatch(/^graph {6}in play {7}graph: section$/m);
  });

  it("-f json", () => {
    dir = fixtureRepo("only-graph");
    const doc = JSON.parse(run(["status", "-f", "json"], dir).stdout) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["version", "config", "collections", "domains"]);
  });

  it("no config: exit 2, the same message as check", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
    dir = bare;
    const r = run(["status"], bare);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `manni: No manni.config.yaml found from ${bare} up to the repository root. manni check runs the checks it sets up.\n`,
    );
  });

  describe("under SessionStart", () => {
    let envDir: string | undefined;
    afterEach(() => {
      if (envDir) rmSync(envDir, { recursive: true, force: true });
      envDir = undefined;
    });

    function envFile(): string {
      envDir = mkdtempSync(join(tmpdir(), "manni-env-"));
      const file = join(envDir, "env.sh");
      writeFileSync(file, "");
      return file;
    }

    it("prints the table and the agent lines, and exports the model", () => {
      dir = fixtureRepo("only-graph");
      const file = envFile();
      const r = run(["status"], dir, envelope("session-start-model", dir), { CLAUDE_ENV_FILE: file });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^graph {6}in play/m);
      expect(r.stdout).toContain(
        "\n\nAfter you edit a file in site, manni check runs on it, and errors come back to you at once.\n",
      );
      expect(readFileSync(file, "utf8")).toBe("export MANNI_GENERATED_BY=claude-opus-4-5\n");
    });

    it("exports nothing without a model", () => {
      dir = fixtureRepo("only-graph");
      const file = envFile();
      const r = run(["status"], dir, envelope("session-start", dir), { CLAUDE_ENV_FILE: file });
      expect(r.status).toBe(0);
      expect(readFileSync(file, "utf8")).toBe("");
    });

    it("exports nothing over a value already set", () => {
      dir = fixtureRepo("only-graph");
      const file = envFile();
      run(["status"], dir, envelope("session-start-model", dir), { CLAUDE_ENV_FILE: file, MANNI_GENERATED_BY: "me" });
      expect(readFileSync(file, "utf8")).toBe("");
    });

    it("prints the table without the agent lines when nothing is set up", () => {
      dir = fixtureRepo("only-graph");
      const config = join(dir, "manni.config.yaml");
      writeFileSync(config, readFileSync(config, "utf8").replace(/^graph:[\s\S]*$/m, ""));
      const r = run(["status"], dir, envelope("session-start", dir));
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^graph {6}not set up/m);
      expect(r.stdout).not.toContain("manni check runs on it");
    });

    it("says nothing with no config", () => {
      const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
      dir = bare;
      expect(run(["status"], bare, envelope("session-start-model", bare))).toEqual({ stdout: "", stderr: "", status: 0 });
    });
  });
});
