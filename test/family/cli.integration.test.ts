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
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    // The tracevals hooks are off unless a test turns them on, whatever the shell says.
    env: {
      ...process.env,
      NO_COLOR: "1",
      MANNI_GENERATED_BY: undefined,
      CLAUDE_ENV_FILE: undefined,
      MANNI_TRACEVALS_HOOKS: "",
      ...env,
    },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function edit(dir: string, rel: string, change: (text: string) => string): void {
  const path = join(dir, rel);
  writeFileSync(path, change(readFileSync(path, "utf8")));
}

const addTodo = (t: string): string => `${t}\nTODO: finish this.\n`;

const STOP_BLOCK =
  "manni found errors in the files you changed. Fix them, then finish. The manni:fix skill says how to repair each finding.\n\n";

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

  it("says a missing metadata directory once, and exits 2 (0126)", () => {
    dir = fixtureRepo("missing-metadata-dir");
    const r = run(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n").filter((line) => line.includes("does not exist"))).toEqual([
      "manni: externalMetadataDir: nope-meta does not exist. Create it, or check out the repository it names.",
    ]);
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

  it("-f github carries docevals' missing-examples advice as ::notice, exit 0", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", (t) =>
      t.replace(
        "title: Page\n",
        "title: Page\nevals:\n  - id: states-purpose\n    assertion: The page says what it is for.\n",
      ),
    );
    const r = run(["check", "-f", "github"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^::notice file=docs\/page\.md,line=4,[^\n]*work best with examples/m);
    expect(r.stdout).not.toMatch(/^::warning /m);
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
    const r = run(["check", "-f", "sarf"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe(
      "error: option '-f, --format <format>' argument 'sarf' is invalid. Allowed choices are pretty, json, github, sarif.",
    );
  });

  describe("-f sarif", () => {
    interface Log {
      version: string;
      runs: {
        automationDetails: { id: string };
        results: unknown[];
        invocations: { executionSuccessful: boolean; toolExecutionNotifications?: { level: string }[] }[];
      }[];
    }
    const ids = (log: Log): string[] => log.runs.map((r) => r.automationDetails.id);

    it("one log with each domain's run and the manni-check run, exit 1 on errors", () => {
      dir = fixtureRepo("meta-and-lint");
      const r = run(["check", "-f", "sarif"], dir);
      expect(r.status).toBe(1);
      const log = JSON.parse(r.stdout) as Log;
      expect(log.version).toBe("2.1.0");
      expect(ids(log)).toEqual(["manni/meta/", "manni/lint/", "manni/check/"]);
      expect(log.runs[2]?.invocations[0]?.toolExecutionNotifications).toHaveLength(5);
    });

    it("a page that passes: runs with no results, exit 0", () => {
      dir = fixtureRepo("meta-and-lint");
      const r = run(["check", "docs/index.md", "-f", "sarif"], dir);
      expect(r.status).toBe(0);
      const log = JSON.parse(r.stdout) as Log;
      expect(ids(log)).toEqual(["manni/meta/", "manni/lint/", "manni/check/"]);
      expect(log.runs[0]?.results).toEqual([]);
      expect(log.runs[1]?.results).toEqual([]);
    });

    it("a file outside every collection: the notice on stderr, the manni-check run alone", () => {
      dir = fixtureRepo("meta-and-lint");
      const r = run(["check", "README.md", "-f", "sarif"], dir);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("manni: Skipped 1 file outside every collection: README.md\n");
      const log = JSON.parse(r.stdout) as Log;
      expect(ids(log)).toEqual(["manni/check/"]);
      expect(log.runs[0]?.invocations).toEqual([{ executionSuccessful: true }]);
    });

    it("a check that could not run has no run, and the manni-check run reports it, exit 2", () => {
      dir = fixtureRepo("meta-and-lint");
      writeFileSync(join(dir, "templates.yaml"), "templates:\n  how-to:\n    heading: 7\n");
      const r = run(["check", "-f", "sarif"], dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^manni lint check could not run: .+/m);
      const log = JSON.parse(r.stdout) as Log;
      expect(ids(log)).toEqual(["manni/meta/", "manni/check/"]);
      const invocation = log.runs[1]?.invocations[0];
      expect(invocation?.executionSuccessful).toBe(false);
      expect(invocation?.toolExecutionNotifications?.map((n) => n.level)).toContain("error");
    });

    it("every option at once", () => {
      dir = fixtureRepo("meta-and-lint");
      const r = run(["check", "docs/**/*.md", "-c", "manni.config.yaml", "-f", "sarif", "--no-color"], dir);
      expect(r.status).toBe(1);
      expect(ids(JSON.parse(r.stdout) as Log)).toEqual(["manni/meta/", "manni/lint/", "manni/check/"]);
    });
  });

  it("no config: exit 2", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
    dir = bare;
    const r = run(["check"], bare);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `manni: No manni.config.yaml found from ${bare} up to the repository root. Create one there with a collections: entry for your docs.\n`,
    );
  });

  it("nothing set up: exit 2", () => {
    dir = fixtureRepo("only-docevals");
    writeFileSync(join(dir, "manni.config.yaml"), 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n');
    const r = run(["check"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: Nothing is set up to check in manni.config.yaml. Run manni status to see what each domain needs.\n",
    );
  });

  it("the umbrella still says where a metadata verb went", () => {
    dir = fixtureRepo("only-docevals");
    const r = run(["validate"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(`validate` is a metadata command: try `manni meta validate`)");
  });
});

describe.skipIf(!gitAvailable())("manni check, the roll-up by persona and journey (0109)", () => {
  const HEADING = "The pages with findings serve 2 personas and 3 journeys.";

  it("pretty: the block after the not-run lines and before the summary, exit 1", () => {
    dir = fixtureRepo("impact");
    const r = run(["check"], dir);
    expect(r.status).toBe(1);
    const blocks = r.stdout.trimEnd().split("\n\n");
    expect(blocks.at(-3)).toMatch(/^skipped {2}/);
    expect(blocks.at(-2)?.split("\n")[0]).toBe(HEADING);
    expect(blocks.at(-2)).toMatch(/^ {2}d1 +Add the gate \(draft\) +3 errors on 1 page$/m);
    expect(blocks.at(-1)).toMatch(/^\d+ checks over \d+ files: 2 failed, \d+ skipped$/);
  });

  it("json, github and sarif carry the same roll-up", () => {
    dir = fixtureRepo("impact");
    const json = run(["check", "-f", "json"], dir);
    expect(json.status).toBe(1);
    const doc = JSON.parse(json.stdout) as Record<string, unknown> & { impact: { id: string }[] };
    expect(Object.keys(doc)).toEqual(["status", "files", "checks", "impact"]);
    expect(doc.impact.map((e) => e.id)).toEqual(["devin", "maya", "m2", "m1", "d1"]);

    const github = run(["check", "-f", "github"], dir);
    expect(github.status).toBe(1);
    expect(github.stdout.split("\n")[0]).toMatch(
      new RegExp(`^::notice title=${HEADING.replace(/[.]/g, "\\.")}::devin Devin: 3 errors and 1 warning on 2 pages%0A`),
    );

    const sarif = run(["check", "-f", "sarif"], dir);
    expect(sarif.status).toBe(1);
    const log = JSON.parse(sarif.stdout) as { runs: { properties?: { impact?: unknown } }[] };
    expect(log.runs.at(-1)?.properties?.impact).toEqual(doc.impact);
  });

  it("no record in any collection: no block, no key, no notice, no property", () => {
    dir = fixtureRepo("meta-and-lint");
    const pretty = run(["check"], dir);
    expect(pretty.status).toBe(1);
    expect(pretty.stdout).not.toContain("The pages with findings serve");
    expect(Object.keys(JSON.parse(run(["check", "-f", "json"], dir).stdout) as object)).not.toContain("impact");
    expect(run(["check", "-f", "github"], dir).stdout).not.toContain("The pages with findings serve");
    expect(run(["check", "-f", "sarif"], dir).stdout).not.toContain('"impact"');
  });

  it("a broken strategy: section is said once, though cite and the roll-up both meet it", () => {
    dir = fixtureRepo("everything");
    edit(dir, "src/limits.ts", (t) => t.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000"));
    edit(dir, "manni.config.yaml", (t) => `${t}\nstrategy:\n  paths: [x]\n`);
    const r = run(["check"], dir);
    expect(r.status).toBe(2);
    const said =
      'manni: personas and journeys left out of the report. manni.config.yaml: strategy does not carry "paths". Name a collection under collections:.';
    expect(r.stderr.split("\n").filter((line) => line === said)).toHaveLength(1);
    expect(r.stdout).not.toContain("The pages with findings serve");
  });

  it("there is no grouping flag", () => {
    dir = fixtureRepo("impact");
    const r = run(["check", "--by", "journey"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe("error: unknown option '--by'");
  });

  it("under a hook, the reply carries no roll-up", () => {
    dir = fixtureRepo("impact");
    const r = run(["check"], dir, envelope("post-tool-use-member", dir, { tool_input: { file_path: "docs/two-journeys.md" } }));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni found errors in docs\/two-journeys\.md\. /);
    expect(r.stderr).not.toContain("The pages with findings serve");
  });
});

describe.skipIf(!gitAvailable())("manni check, under a hook", () => {
  it("PostToolUse on a member page with errors: exit 2 and the report on stderr", () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", addTodo);
    const r = run(["check"], dir, envelope("post-tool-use-member", dir));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(
      r.stderr.startsWith(
        "manni found errors in docs/page.md. Fix them before you continue. The manni:fix skill says how to repair each finding.\n\n",
      ),
    ).toBe(true);
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
      /^manni lint check could not check docs\/limits\.md\. The cause is in manni's setup, not in the file\. Tell the user what it says, and leave manni\.config\.yaml as it is\.\n.+/,
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
    expect(doc.reason.startsWith(STOP_BLOCK)).toBe(true);
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

describe("manni check, judging the turn", () => {
  const runtime = resolve(root, "test", "tracevals", "fixtures", "runtime");
  const trace = (name: string): string => join(runtime, "traces", `${name}.jsonl`);
  // The count follows the fixture's rules; the sentence around it is fixed.
  const BROKE =
    /This turn broke \d+ rules? from the files and requests that governed it\. Fix the work, or say why the rule does not apply here, then finish\.\n\n/;
  const BROKE_FIRST = new RegExp(`^${BROKE.source}`);

  /** tracevals' runtime project, in a temp directory, with a home of its own. */
  function project(): { cwd: string; env: NodeJS.ProcessEnv } {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-turn-")));
    dir = tmp;
    const cwd = join(tmp, "project");
    cpSync(join(runtime, "project"), cwd, { recursive: true });
    const home = join(tmp, "home");
    return {
      cwd,
      env: { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home, MANNI_TRACEVALS_HOOKS: "1" },
    };
  }

  it("Stop on a turn that broke a rule: one block naming the file and the rule, even with no collections", () => {
    const { cwd, env } = project();
    const r = run(["check"], cwd, envelope("stop-transcript", cwd, { transcript_path: trace("breaks") }), env);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const doc = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(doc.decision).toBe("block");
    expect(doc.reason).toMatch(BROKE_FIRST);
    expect(doc.reason).toContain("CLAUDE.md\n");
    expect(doc.reason).toContain("no-force-push");
  });

  it("Stop after the repair pass: a message naming the trace", () => {
    const { cwd, env } = project();
    const input = envelope("stop-hook-active", cwd, { transcript_path: trace("breaks") });
    expect(run(["check"], cwd, input, env)).toEqual({
      stdout: `${JSON.stringify({
        systemMessage: `tracevals still finds broken rules after one repair pass. Run manni tracevals check ${trace("breaks")} to see them.`,
      })}\n`,
      stderr: "",
      status: 0,
    });
  });

  it("Stop on a turn no rule applies to: exit 0 and nothing", () => {
    const { cwd, env } = project();
    const input = envelope("stop-transcript", cwd, { transcript_path: trace("untouched") });
    expect(run(["check"], cwd, input, env)).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("without tracevals.runtime: 0078's reply alone", () => {
    const { cwd, env } = project();
    writeFileSync(join(cwd, "manni.config.yaml"), "tracevals:\n  provider: mock\n");
    const input = envelope("stop-transcript", cwd, { transcript_path: trace("breaks") });
    expect(run(["check"], cwd, input, env)).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("with the hooks off: 0078's reply alone, from a Stop or a SubagentStop", () => {
    const { cwd, env } = project();
    const off = { ...env, MANNI_TRACEVALS_HOOKS: "" };
    const stop = envelope("stop-transcript", cwd, { transcript_path: trace("breaks") });
    expect(run(["check"], cwd, stop, off)).toEqual({ stdout: "", stderr: "", status: 0 });
    const sub = envelope("subagent-stop", cwd, { transcript_path: trace("follows"), agent_transcript_path: trace("breaks") });
    expect(run(["check"], cwd, sub, off)).toEqual({ stdout: "", stderr: "", status: 0 });
  });

  it("SubagentStop judges the agent's own transcript, and runs no file check", () => {
    const { cwd, env } = project();
    const input = envelope("subagent-stop", cwd, {
      transcript_path: trace("follows"),
      agent_transcript_path: trace("breaks"),
    });
    const r = run(["check"], cwd, input, env);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { reason: string }).reason).toMatch(BROKE_FIRST);
  });

  it.skipIf(!gitAvailable())("Stop with file errors and a broken rule: 0078's paragraph first, in one block", () => {
    dir = fixtureRepo("only-docevals");
    const home = join(dir, ".home");
    const env = { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home, MANNI_TRACEVALS_HOOKS: "1" };
    edit(dir, "docs/page.md", addTodo);
    edit(dir, "manni.config.yaml", (t) => `${t}\ntracevals:\n  provider: mock\n  runtime: {}\n`);
    cpSync(join(runtime, "project", "CLAUDE.md"), join(dir, "CLAUDE.md"));
    const r = run(["check"], dir, envelope("stop-transcript", dir, { transcript_path: trace("breaks") }), env);
    expect(r.status).toBe(0);
    const { reason } = JSON.parse(r.stdout) as { reason: string };
    expect(reason.startsWith(STOP_BLOCK)).toBe(true);
    expect(reason).toMatch(new RegExp(`\\n\\n${BROKE.source}`));
  });

  it.skipIf(!gitAvailable())("Stop with file errors and the hooks off: 0078's block, with no tracevals part", () => {
    dir = fixtureRepo("only-docevals");
    const home = join(dir, ".home");
    const env = { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home };
    edit(dir, "docs/page.md", addTodo);
    edit(dir, "manni.config.yaml", (t) => `${t}\ntracevals:\n  provider: mock\n  runtime: {}\n`);
    cpSync(join(runtime, "project", "CLAUDE.md"), join(dir, "CLAUDE.md"));
    const r = run(["check"], dir, envelope("stop-transcript", dir, { transcript_path: trace("breaks") }), env);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(["decision", "reason"]);
    expect(String(doc.reason).startsWith(STOP_BLOCK)).toBe(true);
    expect(String(doc.reason)).not.toMatch(BROKE);
  });
});

describe.skipIf(!gitAvailable())("manni status", () => {
  it("by hand: the table, exit 0", () => {
    dir = fixtureRepo("only-graph");
    const r = run(["status"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^manni \S+ {3}config manni\.config\.yaml {3}collection site \(\d+ files?\)\n\n/);
    expect(r.stdout).toMatch(/^graph {6}in play {7}graph: section$/m);
    expect(r.stdout).toContain(
      "lint       not set up    no lint: section\n" +
        "                         Add a lint: section. manni lint templates lists the templates it can apply.\n",
    );
  });

  it("-f json", () => {
    dir = fixtureRepo("only-graph");
    const r = run(["status", "-f", "json"], dir);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { domains: { name: string; status: string; next?: string }[] };
    expect(Object.keys(doc)).toEqual(["version", "config", "collections", "domains"]);
    expect(doc.domains.find((d) => d.name === "lint")?.next).toBe(
      "Add a lint: section. manni lint templates lists the templates it can apply.",
    );
    expect(doc.domains.find((d) => d.name === "graph")).not.toHaveProperty("next");
  });

  it("-f sarif is a usage error: status reports setup, not findings", () => {
    dir = fixtureRepo("only-graph");
    const r = run(["status", "-f", "sarif"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe(
      "error: option '-f, --format <format>' argument 'sarif' is invalid. Allowed choices are pretty, json.",
    );
  });

  it("a missing metadata directory: exit 2, the line check prints (0126)", () => {
    dir = fixtureRepo("missing-metadata-dir");
    const r = run(["status"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: externalMetadataDir: nope-meta does not exist. Create it, or check out the repository it names.\n",
    );
  });

  it("no config: exit 2, the same message as check", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-bare-")));
    dir = bare;
    const r = run(["status"], bare);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `manni: No manni.config.yaml found from ${bare} up to the repository root. Create one there with a collections: entry for your docs.\n`,
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
      // The next steps are the config owner's, so the briefing leaves them out.
      expect(r.stdout).toMatch(/^lint {7}not set up {4}no lint: section$/m);
      expect(r.stdout).not.toContain("manni lint templates lists");
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
