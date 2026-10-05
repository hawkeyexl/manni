/**
 * `manni check`'s core over the partial-setup fixtures, in process.
 *
 * Each fixture sets up one slice of manni, and the rest must show as
 * `skipped` with the reason, never as a failure. The domains' reports are
 * their own reporters' output, so a report is compared against the domain
 * core's own `-f json` where the output is deterministic.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exitCodeFor,
  hookFailure,
  hookReply,
  renderGithub,
  renderJson,
  renderPretty,
  runFamilyCheck,
  type CheckOutcome,
  type FamilyCheckRun,
} from "../../src/family/commands/check.js";
import { parseEnvelope, type Envelope } from "../../src/family/core/envelope.js";
import { FamilyError } from "../../src/family/core/in-play.js";
import { runValidate } from "../../src/meta/commands/validate.js";
import { render as renderMeta } from "../../src/meta/reporters/index.js";
import { gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";
import { envelope, fixtureRepo } from "./helpers.js";

let dir: string | undefined;
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

function byCommand(run: FamilyCheckRun, command: string): CheckOutcome {
  const found = run.checks.find((c) => c.command === command);
  if (found === undefined) throw new Error(`no ${command} in ${run.checks.map((c) => c.command).join(", ")}`);
  return found;
}

function edit(root: string, rel: string, change: (text: string) => string): void {
  const path = join(root, rel);
  writeFileSync(path, change(readFileSync(path, "utf8")));
}

function env(name: string): Envelope {
  const parsed = parseEnvelope(envelope(name));
  if (parsed === undefined) throw new Error(`${name} is not an envelope`);
  return parsed;
}

describe.skipIf(!gitAvailable())("runFamilyCheck", () => {
  it("only docevals: docevals runs, every other domain is skipped with its reason", async () => {
    dir = fixtureRepo("only-docevals");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(run.status).toBe("pass");
    expect(byCommand(run, "docevals run").status).toBe("pass");
    expect(run.checks.filter((c) => c.status === "skipped")).toEqual([
      { command: "meta validate", status: "skipped", message: "no meta: section" },
      { command: "cite check", status: "skipped", message: "no page carries citations" },
      { command: "lint check", status: "skipped", message: "no lint: section" },
      { command: "term check", status: "skipped", message: "no terms in any collection" },
      { command: "graph check", status: "skipped", message: "no graph: section" },
    ]);
    expect(exitCodeFor(run)).toBe(0);
  });

  it("an untyped page missing description passes where meta: is absent", async () => {
    dir = fixtureRepo("only-docevals");
    const page = readFileSync(join(dir, "docs/page.md"), "utf8");
    expect(page).not.toMatch(/^description:/m);
    expect(page).not.toMatch(/^type:/m);
    // meta on its own would judge the page by its default schemas, and fail it.
    const alone = await runValidate({ inputs: [], cwd: dir });
    expect(alone.summary.failed).toBeGreaterThan(0);

    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/page.md"] } });
    expect(byCommand(run, "meta validate").status).toBe("skipped");
    expect(run.status).toBe("pass");
  });

  it("only docevals: an eval error fails the run", async () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", (t) => `${t}\nTODO: finish this.\n`);
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(run, "docevals run").status).toBe("fail");
    expect(run.status).toBe("fail");
    expect(exitCodeFor(run)).toBe(1);
  });

  it("only citations: cite is in play by the page's citation, and a changed source fails it", async () => {
    dir = fixtureRepo("only-citations");
    const clean = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(clean, "cite check").status).toBe("pass");
    expect(byCommand(clean, "docevals run")).toMatchObject({ status: "skipped", message: "no page resolves any evals" });

    edit(dir, "src/limits.ts", (t) => t.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000"));
    const drifted = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(drifted, "cite check").status).toBe("fail");
  });

  it("a session that only deletes a cited source still runs the set-wide checks", async () => {
    dir = fixtureRepo("only-citations");
    rmSync(join(dir, "src/limits.ts"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(byCommand(run, "cite check").status).toBe("fail");
  });

  it("a page that does not parse fails nothing where meta is not set up", async () => {
    dir = fixtureRepo("only-docevals");
    writeFileSync(join(dir, "docs/broken.md"), "---\ntitle: [unclosed\n---\n# Broken\n");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/broken.md"] } });
    expect(byCommand(run, "meta validate").status).toBe("skipped");
  });

  it("a member that is not a document is left out of the per-file checks", async () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "manni.config.yaml", (t) => t.replace('"docs/**/*.md"', '"docs/**"'));
    writeFileSync(join(dir, "docs/diagram.svg"), "<svg/>\n");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/diagram.svg", "docs/page.md"] } });
    expect(run.files).toEqual(["docs/page.md"]);
    expect(run.checks.filter((c) => c.status === "error")).toEqual([]);
  });

  it("only graph: graph builds in memory and checks, writing no file", async () => {
    dir = fixtureRepo("only-graph");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(run, "graph check").status).toBe("pass");
    expect(() => readFileSync(join(dir ?? "", ".manni/graph/graph.ttl"))).toThrow();

    edit(dir, "docs/a.md", (t) => t.replace("title: A\n", "title: A\ngraph:\n  label: A\n  broader: [B]\n"));
    edit(dir, "docs/b.md", (t) => t.replace("title: B\n", "title: B\ngraph:\n  label: B\n  broader: [A]\n"));
    const cycle = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(cycle, "graph check").status).toBe("fail");
  });

  it("everything: every domain runs, and meta leaves out the page only the defaults cover", async () => {
    dir = fixtureRepo("everything");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(run.checks.map((c) => [c.command, c.status])).toEqual([
      ["meta validate", "pass"],
      ["cite check", "pass"],
      ["lint check", "pass"],
      ["docevals run", "pass"],
      ["term check", "pass"],
      ["graph check", "pass"],
    ]);
    const meta = JSON.parse(renderJson(run)) as { checks: { command: string; report?: { results: { file: string }[] } }[] };
    const files = meta.checks.find((c) => c.command === "meta validate")?.report?.results.map((r) => r.file);
    expect(files).toContain("docs/limits.md");
    expect(files).not.toContain("docs/glossary/timeout.md");
  });

  it("each report is the domain's own -f json output", async () => {
    dir = fixtureRepo("everything");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/limits.md"] } });
    const own = await runValidate({ inputs: ["docs/limits.md"], cwd: dir });
    const report = (JSON.parse(renderJson(run)) as { checks: { command: string; report?: unknown }[] }).checks.find(
      (c) => c.command === "meta validate",
    )?.report;
    expect(report).toEqual(JSON.parse(renderMeta("json", own.results, own.summary)));
  });

  it("a check that cannot run is an error, and the others still run", async () => {
    dir = fixtureRepo("everything");
    writeFileSync(join(dir, "templates.yaml"), "templates:\n  concept:\n    heading: 7\n");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(run, "lint check").status).toBe("error");
    expect(byCommand(run, "graph check").status).toBe("pass");
    expect(exitCodeFor(run)).toBe(2);
  });

  it("paths: only collection members are checked, and the rest are named in one notice", async () => {
    dir = fixtureRepo("only-docevals");
    const notices: string[] = [];
    const run = await runFamilyCheck({
      cwd: dir,
      scope: { kind: "paths", paths: ["docs/page.md", "README.md"] },
      onNotice: (m) => notices.push(m),
    });
    expect(run.files).toEqual(["docs/page.md"]);
    expect(notices).toContain("Skipped 1 file outside every collection: README.md");
    // The set-wide checks are not part of a per-file scope.
    expect(run.checks.map((c) => c.command)).not.toContain("term check");
  });

  it("paths: nothing but non-members runs no check", async () => {
    dir = fixtureRepo("only-docevals");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["CLAUDE.md"] }, onNotice: () => undefined });
    expect(run.checks).toEqual([]);
    expect(run.files).toEqual([]);
  });

  it("changed: a clean tree runs nothing", async () => {
    dir = fixtureRepo("everything");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run).toEqual({ status: "pass", files: [], checks: [] });
  });

  it("changed: the per-file checks on the changes, plus every set-wide check", async () => {
    dir = fixtureRepo("everything");
    edit(dir, "docs/limits.md", (t) => t.replace(/^description:.*\n/m, ""));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual(["docs/limits.md"]);
    expect(byCommand(run, "meta validate").status).toBe("fail");
    for (const setWide of ["cite check", "term check", "graph check"]) {
      expect(run.checks.map((c) => c.command)).toContain(setWide);
    }
  });

  it("changed: a source edit runs every citation, and leaves the glossary and the graph alone", async () => {
    dir = fixtureRepo("everything");
    edit(dir, "src/limits.ts", (t) => t.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual([]);
    expect(run.checks.map((c) => c.command)).toEqual(["cite check"]);
    expect(byCommand(run, "cite check").status).toBe("fail");
  });

  it("changed: a deleted page still runs the glossary and the graph", async () => {
    dir = fixtureRepo("everything");
    rmSync(join(dir, "docs/glossary/timeout.md"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual([]);
    expect(run.checks.map((c) => c.command)).toEqual(["cite check", "term check", "graph check"]);
  });

  it("no config is an operational error the hook answers with silence", async () => {
    dir = makeTempRepo({ files: { "docs/a.md": "# a\n" } });
    const err = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FamilyError);
    expect((err as FamilyError).message).toBe(
      `No manni.config.yaml found from ${dir} up to the repository root. manni check runs the checks it sets up.`,
    );
    expect((err as FamilyError).quiet).toBe(true);
  });

  it("nothing set up is an operational error", async () => {
    dir = makeTempRepo({
      files: {
        "manni.config.yaml": 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n',
        "docs/a.md": "---\ntitle: A\n---\n# A\n",
      },
    });
    const err = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }).catch((e: unknown) => e);
    expect((err as FamilyError).message).toBe(
      "Nothing is set up to check in manni.config.yaml. manni status says what each domain needs.",
    );
  });
});

describe.skipIf(!gitAvailable())("rendering", () => {
  it("pretty: each check under its command, then the skipped lines and the summary", async () => {
    dir = fixtureRepo("only-docevals");
    const text = renderPretty(await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }), false);
    expect(text.startsWith("docevals run\n")).toBe(true);
    expect(text).toMatch(/^skipped {2}lint check +no lint: section$/m);
    expect(text).toMatch(/\n\n\d+ checks over 1 file: 0 failed, \d+ skipped$/);
  });

  it("json: one object, each check's status, report or message", async () => {
    dir = fixtureRepo("only-docevals");
    const doc = JSON.parse(renderJson(await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }))) as {
      status: string;
      files: string[];
      checks: Record<string, unknown>[];
    };
    expect(doc.status).toBe("pass");
    expect(doc.files).toEqual(["docs/page.md"]);
    for (const check of doc.checks) {
      expect(Object.keys(check).sort()).toEqual(
        check.status === "skipped" || check.status === "error"
          ? ["command", "message", "status"]
          : ["command", "report", "status"],
      );
    }
  });

  it("github: the domains' own annotations, concatenated", async () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", (t) => `${t}\nTODO: finish this.\n`);
    const text = renderGithub(await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }));
    expect(text).toMatch(/^::error /m);
  });
});

describe.skipIf(!gitAvailable())("hookReply", () => {
  it("after an edit with errors: exit 2, the sentence, then the report with color off", async () => {
    dir = fixtureRepo("only-docevals");
    edit(dir, "docs/page.md", (t) => `${t}\nTODO: finish this.\n`);
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/page.md"] } });
    const reply = hookReply(run, env("post-tool-use-member"));
    expect(reply.exitCode).toBe(2);
    expect(reply.stdout).toBeUndefined();
    expect(reply.stderr?.startsWith("manni found errors in docs/page.md. Fix them before you continue.\n\n")).toBe(true);
    expect(reply.stderr).not.toContain("\u001b[");
  });

  it("after an edit, a check that could not run is context, not a block", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/limits.md"],
      checks: [{ command: "lint check", status: "error", message: "bad template\nsecond line" }],
    };
    expect(hookReply(run, env("post-tool-use-member"))).toEqual({
      exitCode: 0,
      stdout:
        '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"manni lint check could not check docs/limits.md: bad template"}}\n',
    });
  });

  const failing: FamilyCheckRun = {
    status: "fail",
    files: ["docs/limits.md"],
    checks: [{ command: "meta validate", status: "fail", render: () => "docs/limits.md\n  ✖ /description" }],
  };

  it("before stopping, errors block once", () => {
    const reply = hookReply(failing, env("stop"));
    expect(reply.exitCode).toBe(0);
    const doc = JSON.parse(reply.stdout ?? "") as { decision: string; reason: string };
    expect(doc.decision).toBe("block");
    expect(doc.reason.startsWith("manni found errors in the files you changed. Fix them, then finish.\n\nmeta validate\n")).toBe(true);
  });

  it("a block carries the failing checks' reports, not the passing ones", () => {
    const mixed: FamilyCheckRun = {
      ...failing,
      checks: [...failing.checks, { command: "docevals run", status: "pass", render: () => "PASSING OUTPUT" }],
    };
    expect(hookReply(mixed, env("post-tool-use-member")).stderr).not.toContain("PASSING OUTPUT");
    expect(hookReply(mixed, env("stop")).stdout).not.toContain("PASSING OUTPUT");
  });

  it("before stopping after one repair pass, the user gets a message and the agent stops", () => {
    expect(hookReply(failing, env("stop-hook-active"))).toEqual({
      exitCode: 0,
      stdout: '{"systemMessage":"manni still reports errors after one repair pass. Run manni check to see them."}\n',
    });
  });

  it("clean, or nothing ran: exit 0 and nothing", () => {
    const clean: FamilyCheckRun = { status: "pass", files: [], checks: [] };
    expect(hookReply(clean, env("post-tool-use-member"))).toEqual({ exitCode: 0 });
    expect(hookReply(clean, env("stop"))).toEqual({ exitCode: 0 });
  });

  it("a run that could not happen never exits 2", () => {
    expect(hookFailure("bad YAML", env("post-tool-use-member"), "docs/page.md").exitCode).toBe(0);
    expect(hookFailure("bad YAML", env("stop"), undefined)).toEqual({ exitCode: 0 });
  });
});

describe("renderJson", () => {
  it("keeps the rest of the output when one reporter's JSON does not parse", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/a.md"],
      checks: [
        { command: "meta validate", status: "pass", render: () => "not json" },
        { command: "cite check", status: "pass", render: () => '{"ok":true}' },
      ],
    };
    const doc = JSON.parse(renderJson(run)) as { checks: unknown[] };
    expect(doc.checks).toEqual([
      { command: "meta validate", status: "error", message: "meta validate -f json printed output that is not JSON" },
      { command: "cite check", status: "pass", report: { ok: true } },
    ]);
  });
});
