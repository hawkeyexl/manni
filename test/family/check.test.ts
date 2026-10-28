/**
 * `manni check`'s core over the partial-setup fixtures, in process.
 *
 * Each fixture sets up one slice of manni, and the rest must show as
 * `skipped` with the reason, never as a failure. The domains' reports are
 * their own reporters' output, so a report is compared against the domain
 * core's own `-f json` where the output is deterministic.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as AjvDraft04Ns from "ajv-draft-04";
import { afterEach, describe, expect, it } from "vitest";
import {
  exitCodeFor,
  hookFailure,
  hookReply,
  render,
  renderGithub,
  renderJson,
  renderPretty,
  renderSarif,
  runFamilyCheck,
  type CheckOutcome,
  type FamilyCheckRun,
} from "../../src/family/commands/check.js";
import { parseEnvelope, type Envelope } from "../../src/family/core/envelope.js";
import { FamilyError } from "../../src/family/core/in-play.js";
import { runLint } from "../../src/lint/commands/lint.js";
import { render as renderLint } from "../../src/lint/reporters/index.js";
import { runValidate } from "../../src/meta/commands/validate.js";
import { render as renderMeta } from "../../src/meta/reporters/index.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";
import { envelope, fixtureRepo, nestedFixtureRepo } from "./helpers.js";

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

/** The findings in `strategy check`'s own JSON report. */
function strategyFindings(run: FamilyCheckRun): Record<string, unknown>[] {
  const check = byCommand(run, "strategy check");
  if (!("render" in check)) throw new Error(`strategy check did not run: ${check.message}`);
  return (JSON.parse(check.render("json", false)) as { findings: Record<string, unknown>[] }).findings;
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
      { command: "strategy check", status: "skipped", message: "no strategy records in any collection" },
      { command: "graph check", status: "skipped", message: "no graph: section" },
    ]);
    expect(exitCodeFor(run)).toBe(0);
  });

  it("only .htm topics: docevals reads them and none declares evals, so it is skipped and the exit is meta's", async () => {
    dir = fixtureRepo("only-html");
    const skipped = { command: "docevals run", status: "skipped", message: "no page resolves any evals" };
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(run, "meta validate").status).toBe("pass");
    expect(byCommand(run, "docevals run")).toEqual(skipped);
    expect(exitCodeFor(run)).toBe(0);

    // A hook names the one topic an agent edited.
    const one = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["Content/index.htm"] } });
    expect(byCommand(one, "docevals run")).toEqual(skipped);
    expect(exitCodeFor(one)).toBe(0);

    edit(dir, "Content/install.htm", (t) => t.replace(/\s*<meta name="description"[^>]*>/, ""));
    const failing = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(failing, "meta validate").status).toBe("fail");
    expect(byCommand(failing, "docevals run")).toEqual(skipped);
    expect(exitCodeFor(failing)).toBe(1);
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

  it("cite's JSON report carries impact through the family verb (0105)", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-family-impact-")));
    cpSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cite", "impact"), dir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    commitAll(dir, "fixture");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    const report = JSON.parse(renderJson(run)) as {
      checks: { command: string; report?: { impact?: { id: string; pages: string[] }[] } }[];
    };
    const cite = report.checks.find((c) => c.command === "cite check");
    expect(cite?.report?.impact?.map((e) => e.id)).toEqual(["maya", "m5"]);
    expect(cite?.report?.impact?.[0]?.pages).toEqual(["pages/stale.md"]);
  }, 60000);

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
      ["strategy check", "pass"],
      ["graph check", "pass"],
    ]);
    const meta = JSON.parse(renderJson(run)) as { checks: { command: string; report?: { results: { file: string }[] } }[] };
    const files = meta.checks.find((c) => c.command === "meta validate")?.report?.results.map((r) => r.file);
    expect(files).toContain("docs/limits.md");
    expect(files).not.toContain("docs/glossary/timeout.md");
  });

  it("strategy: a record that names no record of its parent's type fails the run", async () => {
    dir = fixtureRepo("everything");
    edit(dir, "docs/strategy/m1.md", (t) => t.replace("personas: [maya]", "personas: [mya]"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(byCommand(run, "strategy check").status).toBe("fail");
    expect(strategyFindings(run)).toContainEqual(
      expect.objectContaining({ rule: "undefined-reference", file: "docs/strategy/m1.md", field: "personas" }),
    );
    expect(exitCodeFor(run)).toBe(1);
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
    for (const setWide of ["term check", "strategy check"]) {
      expect(run.checks.map((c) => c.command)).not.toContain(setWide);
    }
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

  it("changed: the per-file checks on the changes, every citation, the glossary and the strategy, never the graph", async () => {
    dir = fixtureRepo("everything");
    edit(dir, "docs/limits.md", (t) => t.replace(/^description:.*\n/m, ""));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual(["docs/limits.md"]);
    expect(byCommand(run, "meta validate").status).toBe("fail");
    for (const setWide of ["cite check", "term check", "strategy check"]) {
      expect(run.checks.map((c) => c.command)).toContain(setWide);
    }
    expect(run.checks.map((c) => c.command)).not.toContain("graph check");
  });

  it("changed: a source edit runs every citation and the strategy, and leaves the glossary alone", async () => {
    dir = fixtureRepo("everything");
    edit(dir, "src/limits.ts", (t) => t.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual([]);
    expect(run.checks.map((c) => c.command)).toEqual(["cite check", "strategy check"]);
    expect(byCommand(run, "cite check").status).toBe("fail");
  });

  it("changed: a deleted page still runs the glossary", async () => {
    dir = fixtureRepo("everything");
    rmSync(join(dir, "docs/glossary/timeout.md"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual([]);
    expect(run.checks.map((c) => c.command)).toEqual(["cite check", "term check", "strategy check"]);
  });

  it("changed: a sidecar edit alone runs the strategy, which reads the sidecar's values", async () => {
    dir = fixtureRepo("everything");
    // A {page}.meta.yaml is neither a document nor a member, so no per-file check and no glossary runs.
    edit(dir, "docs/limits.meta.yaml", (t) => t.replace("journeys: [m1]", "journeys: [m1, m9]"));
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "changed" } });
    expect(run.files).toEqual([]);
    expect(run.checks.map((c) => c.command)).toEqual(["cite check", "strategy check"]);
    expect(byCommand(run, "strategy check").status).toBe("fail");
    expect(strategyFindings(run)).toContainEqual(
      expect.objectContaining({ rule: "undefined-reference", file: "docs/limits.meta.yaml", field: "journeys" }),
    );
  });

  it("no config is an operational error the hook answers with silence", async () => {
    dir = makeTempRepo({ files: { "docs/a.md": "# a\n" } });
    const err = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FamilyError);
    expect((err as FamilyError).message).toBe(
      `No manni.config.yaml found from ${dir} up to the repository root. Create one there with a collections: entry for your docs.`,
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
      "Nothing is set up to check in manni.config.yaml. Run manni status to see what each domain needs.",
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
    expect(
      reply.stderr?.startsWith(
        "manni found errors in docs/page.md. Fix them before you continue. The manni:fix skill says how to repair each finding.\n\n",
      ),
    ).toBe(true);
    expect(reply.stderr).not.toContain("\u001b[");
  });

  it("after an edit, a check that could not run is context, not a block, with the whole message and its owner", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/limits.md"],
      checks: [{ command: "lint check", status: "error", message: "bad template\nsecond line" }],
    };
    const additionalContext =
      "manni lint check could not check docs/limits.md. The cause is in manni's setup, not in the file. " +
      "Tell the user what it says, and leave manni.config.yaml as it is.\nbad template\nsecond line";
    expect(hookReply(run, env("post-tool-use-member"))).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } })}\n`,
    });
  });

  it("a run that could not happen names manni check, its owner and the whole message", () => {
    const reply = hookFailure("bad YAML\nat line 2", env("post-tool-use-member"), "docs/page.md");
    const doc = JSON.parse(reply.stdout ?? "") as { hookSpecificOutput: { additionalContext: string } };
    expect(doc.hookSpecificOutput.additionalContext).toBe(
      "manni check could not check docs/page.md. The cause is in manni's setup, not in the file. " +
        "Tell the user what it says, and leave manni.config.yaml as it is.\nbad YAML\nat line 2",
    );
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
    expect(
      doc.reason.startsWith(
        "manni found errors in the files you changed. Fix them, then finish. The manni:fix skill says how to repair each finding.\n\nmeta validate\n",
      ),
    ).toBe(true);
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

// The meta-schema is vendored, and draft-04 is the dialect the OASIS TC
// published it in, as test/reporters.test.ts explains.
type AjvCtor = typeof import("ajv/dist/2020.js").default;
const AjvDraft04 = AjvDraft04Ns.default as unknown as AjvCtor;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validateSarif = new AjvDraft04({ allErrors: true, strict: false, validateFormats: false, logger: false }).compile(
  JSON.parse(readFileSync(join(repoRoot, "test/fixtures/sarif-2.1.0.schema.json"), "utf8")) as Record<string, unknown>,
);

interface SarifRun {
  tool: { driver: { name: string } };
  automationDetails?: { id: string };
  invocations?: {
    executionSuccessful: boolean;
    toolExecutionNotifications?: { level: string; message: { text: string } }[];
  }[];
  results: unknown[];
}

function sarifOf(text: string): { version: string; runs: SarifRun[] } {
  const log = JSON.parse(text) as { version: string; runs: SarifRun[] };
  const ok = validateSarif(log);
  expect(ok ? [] : (validateSarif.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`)).toEqual([]);
  return log;
}

describe.skipIf(!gitAvailable())("renderSarif", () => {
  it("one log: each domain's own run under its category, then the manni-check run with the skips", async () => {
    dir = fixtureRepo("meta-and-lint");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(exitCodeFor(run)).toBe(1);
    const log = sarifOf(render(run, "sarif", false));
    expect(log.version).toBe("2.1.0");
    expect(log.runs.map((r) => r.automationDetails?.id)).toEqual(["manni/meta/", "manni/lint/", "manni/check/"]);

    // Each domain's run is its own -f sarif run, with the category and a default invocation added.
    const meta = await runValidate({ inputs: [], cwd: dir, skipDefaultOnly: true });
    const ownMeta = (
      JSON.parse(renderMeta("sarif", meta.results, meta.summary, { frame: meta.frame })) as { runs: SarifRun[] }
    ).runs[0];
    expect(log.runs[0]).toEqual({
      ...ownMeta,
      automationDetails: { id: "manni/meta/" },
      invocations: [{ executionSuccessful: true }],
    });
    const lint = await runLint({ inputs: [], cwd: dir });
    const ownLint = (JSON.parse(renderLint(lint, "sarif", { root: dir })) as { runs: SarifRun[] }).runs[0];
    expect(log.runs[1]).toEqual({ ...ownLint, automationDetails: { id: "manni/lint/" } });
    expect(log.runs[1]?.results).not.toEqual([]);

    expect(log.runs[2]).toMatchObject({
      tool: { driver: { name: "manni-check" } },
      results: [],
      invocations: [
        {
          executionSuccessful: true,
          toolExecutionNotifications: [
            { level: "note", message: { text: "cite check skipped: no page carries citations." } },
            { level: "note", message: { text: "docevals run skipped: no page resolves any evals." } },
            { level: "note", message: { text: "term check skipped: no terms in any collection." } },
            { level: "note", message: { text: "strategy check skipped: no strategy records in any collection." } },
            { level: "note", message: { text: "graph check skipped: no graph: section." } },
          ],
        },
      ],
    });
  });

  it("-c from another directory: every location still names a file that exists", async () => {
    dir = fixtureRepo("meta-and-lint");
    const parent = dir;
    mkdirSync(join(dir, "site"));
    for (const name of ["manni.config.yaml", "templates.yaml", "docs"]) renameSync(join(dir, name), join(dir, "site", name));
    const run = await runFamilyCheck({ cwd: dir, configPath: "site/manni.config.yaml", scope: { kind: "all" } });
    const log = JSON.parse(renderSarif(run)) as {
      runs: {
        originalUriBaseIds?: Record<string, { uri: string }>;
        results: { locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId?: string } } }[] }[];
      }[];
    };
    const located = log.runs.flatMap((r) =>
      r.results.map((res) => {
        const { uri, uriBaseId } = res.locations[0]?.physicalLocation.artifactLocation ?? { uri: "" };
        const base = uriBaseId === undefined ? pathToFileURL(`${parent}/`).href : (r.originalUriBaseIds?.[uriBaseId]?.uri ?? "");
        return fileURLToPath(new URL(uri, base));
      }),
    );
    expect(located.length).toBeGreaterThan(1);
    for (const path of located) expect(existsSync(path), path).toBe(true);
  });

  it("cite, term and strategy render SARIF, not pretty", async () => {
    dir = fixtureRepo("everything");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    const log = sarifOf(renderSarif(run));
    expect(log.runs.map((r) => r.automationDetails?.id)).toEqual([
      "manni/meta/",
      "manni/cite/",
      "manni/lint/",
      "manni/docevals/",
      "manni/term/",
      "manni/strategy/",
      "manni/graph/",
      "manni/check/",
    ]);
  });

  it("a check that could not run gets no run of its own, and the manni-check run says so", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/a.md"],
      checks: [
        { command: "meta validate", status: "skipped", message: "no meta: section" },
        { command: "lint check", status: "error", message: "bad template\nsecond line" },
      ],
    };
    const log = sarifOf(renderSarif(run));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.invocations).toEqual([
      {
        executionSuccessful: false,
        toolExecutionNotifications: [
          { level: "note", message: { text: "meta validate skipped: no meta: section." } },
          { level: "error", message: { text: "lint check could not run: bad template\nsecond line" } },
        ],
      },
    ]);
  });

  it("a reporter whose SARIF does not parse becomes an error notification", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/a.md"],
      checks: [{ command: "meta validate", status: "pass", render: () => "not sarif" }],
    };
    const log = sarifOf(renderSarif(run));
    expect(log.runs.map((r) => r.automationDetails?.id)).toEqual(["manni/check/"]);
    expect(log.runs[0]?.invocations).toEqual([
      {
        executionSuccessful: false,
        toolExecutionNotifications: [
          { level: "error", message: { text: "meta validate -f sarif printed output that is not SARIF." } },
        ],
      },
    ]);
  });

  it("a reporter whose SARIF holds no runs becomes an error notification", () => {
    const run: FamilyCheckRun = {
      status: "pass",
      files: ["docs/a.md"],
      checks: [
        { command: "meta validate", status: "pass", render: () => '{"version":"2.1.0","runs":[]}' },
      ],
    };
    const log = sarifOf(renderSarif(run));
    expect(log.runs.map((r) => r.automationDetails?.id)).toEqual(["manni/check/"]);
    expect(log.runs[0]?.invocations).toEqual([
      {
        executionSuccessful: false,
        toolExecutionNotifications: [
          { level: "error", message: { text: "meta validate -f sarif printed output that is not SARIF." } },
        ],
      },
    ]);
  });

  it("nothing ran: the manni-check run alone, with no notifications", () => {
    const log = sarifOf(renderSarif({ status: "pass", files: [], checks: [] }));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.invocations).toEqual([{ executionSuccessful: true }]);
    expect(log.runs[0]?.results).toEqual([]);
  });
});

/** The roll-up's rows as `type:id`, in order. */
const rows = (run: FamilyCheckRun): string[] => (run.impact ?? []).map((e) => `${e.type}:${e.id}`);

function entry(run: FamilyCheckRun, id: string): NonNullable<FamilyCheckRun["impact"]>[number] {
  const found = run.impact?.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no ${id} in ${rows(run).join(", ")}`);
  return found;
}

/** The files a check placed its findings on. */
function placed(run: FamilyCheckRun, command: string): string[] {
  const check = byCommand(run, command);
  return "render" in check ? (check.findings ?? []).map((f) => f.file) : [];
}

describe.skipIf(!gitAvailable())("the roll-up by persona and journey (0109)", () => {
  it("counts each check's findings under every persona and journey its page names, worst first, drafts last", async () => {
    dir = fixtureRepo("impact");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" }, impact: true });
    expect(rows(run)).toEqual(["persona:devin", "persona:maya", "journey:m2", "journey:m1", "journey:d1"]);

    // Two checks report on two-journeys.md, and its findings count under both its journeys.
    const twoJourneys = join(dir, "docs", "two-journeys.md");
    const onIt = ["meta validate", "docevals run"].map((c) => placed(run, c).filter((f) => f === twoJourneys).length);
    expect(onIt.every((n) => n > 0)).toBe(true);
    expect(entry(run, "m1").errors).toBe(onIt.reduce((a, b) => a + b, 0));
    expect(entry(run, "m2").errors).toBe(entry(run, "m1").errors);

    // The warning in sidecar.meta.yaml counts on sidecar.md, and pages are sorted labels.
    expect(placed(run, "strategy check")).toContain(join(dir, "docs", "sidecar.meta.yaml"));
    expect(entry(run, "m2")).toMatchObject({ warnings: 1, pages: ["docs/sidecar.md", "docs/two-journeys.md"] });

    // A draft journey with more errors still comes after the live ones.
    expect(entry(run, "d1").errors).toBeGreaterThan(entry(run, "m1").errors);
    expect(entry(run, "d1").lifecycle).toBe("draft");

    // A page that names nobody counts nowhere, and the counts sum to findings.
    for (const e of run.impact ?? []) {
      expect(e.pages).not.toContain("docs/untagged.md");
      expect(e.errors + e.warnings + e.notices).toBe(e.findings);
    }
  }, 60000);

  it("lists a record's pages sorted, whatever order the checks reported them in", async () => {
    dir = fixtureRepo("impact");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" }, impact: true });
    // m2 is named by two-journeys.md and sidecar.md. meta runs before strategy, so
    // two-journeys.md's finding arrives before the one in sidecar.meta.yaml.
    const b = join(dir, "docs", "two-journeys.md");
    const a = [join(dir, "docs", "sidecar.md"), join(dir, "docs", "sidecar.meta.yaml")];
    const arrival = run.checks
      .flatMap((c) => ("render" in c ? (c.findings ?? []) : []))
      .map((f) => f.file)
      .filter((f) => f === b || a.includes(f));
    expect(arrival[0]).toBe(b);
    expect(entry(run, "m2").pages).toEqual(["docs/sidecar.md", "docs/two-journeys.md"]);
  }, 60000);

  it("is never built unless asked, as under a hook, and a hook's reply is the same either way", async () => {
    dir = fixtureRepo("impact");
    const scope = { kind: "paths", paths: ["docs/two-journeys.md"] } as const;
    const asked = await runFamilyCheck({ cwd: dir, scope: { ...scope, paths: [...scope.paths] }, impact: true });
    const plain = await runFamilyCheck({ cwd: dir, scope: { ...scope, paths: [...scope.paths] } });
    expect(asked.impact).not.toBeUndefined();
    expect(plain.impact).toBeUndefined();
    expect(hookReply(asked, env("post-tool-use-member"))).toEqual(hookReply(plain, env("post-tool-use-member")));
    expect(hookReply(asked, env("stop"))).toEqual(hookReply(plain, env("stop")));
  }, 60000);

  it("paths: counts only the named pages' findings, with records from every collection", async () => {
    dir = fixtureRepo("impact");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "paths", paths: ["docs/draft.md"] }, impact: true });
    expect(rows(run)).toEqual(["persona:devin", "journey:d1"]);
  }, 60000);

  it("with no record in any collection, every format prints what it prints unasked", async () => {
    dir = fixtureRepo("meta-and-lint");
    const asked = await runFamilyCheck({ cwd: dir, scope: { kind: "all" }, impact: true });
    const plain = await runFamilyCheck({ cwd: dir, scope: { kind: "all" } });
    expect(asked.status).toBe("fail");
    expect(asked.impact).toBeUndefined();
    for (const format of ["pretty", "json", "github", "sarif"] as const) {
      expect(render(asked, format, false)).toBe(render(plain, format, false));
    }
  }, 60000);

  it("a clean run carries no roll-up", async () => {
    dir = fixtureRepo("everything");
    const run = await runFamilyCheck({ cwd: dir, scope: { kind: "all" }, impact: true });
    expect(run.status).toBe("pass");
    expect(run.impact).toBeUndefined();
  }, 60000);

  it("a broken strategy: section is one notice, and the checks keep their verdicts", async () => {
    dir = fixtureRepo("impact");
    edit(dir, "manni.config.yaml", (t) => `${t}\nstrategy:\n  paths: [x]\n`);
    const notices: string[] = [];
    const run = await runFamilyCheck({
      cwd: dir,
      scope: { kind: "all" },
      impact: true,
      onNotice: (m) => notices.push(m),
    });
    expect(run.impact).toBeUndefined();
    expect(byCommand(run, "strategy check").status).toBe("error");
    expect(byCommand(run, "meta validate").status).toBe("fail");
    expect(notices).toContain(
      'personas and journeys left out of the report. manni.config.yaml: strategy does not carry "paths". Name a collection under collections:.',
    );
  }, 60000);

  describe("each domain places its finding on the page, one directory below the repository root", () => {
    // The check, the file its finding comes from, and the change that makes it report.
    const cases: [string, string, (text: string) => string][] = [
      ["meta validate", "docs/limits.md", (t) => t.replace(/^description:.*\n/m, "")],
      ["cite check", "src/limits.ts", (t) => t.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000")],
      ["lint check", "templates.yaml", (t) => t.replace("min: 1", "min: 5")],
      ["docevals run", "docs/limits.md", (t) => `${t}\nTODO: finish this.\n`],
      ["term check", "docs/limits.md", (t) => t.replace("concepts: [timeout]", "concepts: [timeout, deadline]")],
      ["strategy check", "docs/limits.meta.yaml", (t) => t.replace("journeys: [m1]", "journeys: [m1, m9]")],
      [
        "graph check",
        "docs/limits.md",
        (t) => t.replace("title: Limits\n", "title: Limits\ngraph:\n  label: Limits\n  broader: [Limits]\n"),
      ],
    ];
    for (const [command, file, change] of cases) {
      it(command, async () => {
        const nested = nestedFixtureRepo("everything");
        dir = nested.root;
        edit(nested.dir, file, change);
        const run = await runFamilyCheck({ cwd: nested.dir, scope: { kind: "all" }, impact: true });
        const page = join(nested.dir, "docs", "limits.md");
        const sidecar = join(nested.dir, "docs", "limits.meta.yaml");
        expect(placed(run, command).length).toBeGreaterThan(0);
        expect(placed(run, command).filter((f) => f !== page && f !== sidecar)).toEqual([]);
        expect(rows(run)).toEqual(["persona:maya", "journey:m1"]);
        expect(entry(run, "m1").pages).toEqual(["docs/limits.md"]);
      }, 60000);
    }
  });
});

describe("rendering the roll-up (0109)", () => {
  const impact: NonNullable<FamilyCheckRun["impact"]> = [
    { type: "persona", id: "maya", title: "Maya", findings: 2, errors: 2, warnings: 0, notices: 0, pages: ["docs/a.md"] },
    {
      type: "journey",
      id: "m1",
      title: "Set up",
      findings: 2,
      errors: 1,
      warnings: 1,
      notices: 0,
      pages: ["docs/a.md", "docs/b.md"],
    },
  ];
  const own: Record<string, string> = {
    pretty: "meta report",
    json: "{}",
    github: "::error file=docs/a.md::x",
    sarif: '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"manni"}},"results":[]}]}',
  };
  const base: FamilyCheckRun = {
    status: "fail",
    files: ["docs/a.md", "docs/b.md"],
    checks: [
      { command: "meta validate", status: "fail", render: (format) => own[format] ?? "" },
      { command: "lint check", status: "skipped", message: "no lint: section" },
    ],
  };
  const run: FamilyCheckRun = { ...base, impact };

  it("pretty: one block after the not-run lines and before the summary, its heading bold only with color", () => {
    expect(renderPretty(run, false).split("\n\n")).toEqual([
      "meta validate\nmeta report",
      "skipped  lint check   no lint: section",
      [
        "The pages with findings serve 1 persona and 1 journey.",
        "  maya   Maya     2 errors on 1 page",
        "  m1     Set up   1 error and 1 warning on 2 pages",
      ].join("\n"),
      "2 checks over 2 files: 1 failed, 1 skipped",
    ]);
    expect(renderPretty(run, true)).toContain("\u001b[1mThe pages with findings serve");
    expect(renderPretty(run, true)).toContain("\n  maya   Maya");
    expect(renderPretty(base, false).split("\n\n")).toHaveLength(3);
  });

  it("json: impact after checks, absent when empty", () => {
    const doc = JSON.parse(renderJson(run)) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["status", "files", "checks", "impact"]);
    expect(doc.impact).toEqual(impact);
    expect(Object.keys(JSON.parse(renderJson(base)) as object)).toEqual(["status", "files", "checks"]);
  });

  it("github: one notice first, titled with the heading, then each check's own lines", () => {
    const lines = renderGithub(run).split("\n");
    expect(lines[0]).toBe(
      "::notice title=The pages with findings serve 1 persona and 1 journey.::maya Maya: 2 errors on 1 page%0Am1 Set up: 1 error and 1 warning on 2 pages",
    );
    expect(lines.slice(1)).toEqual(renderGithub(base).split("\n"));
    expect(renderGithub(base).startsWith("::notice")).toBe(false);
  });

  it("sarif: the manni-check run carries properties.impact, the JSON array; every other run is unchanged", () => {
    const log = sarifOf(renderSarif(run)) as { runs: (SarifRun & { properties?: { impact?: unknown } })[] };
    const plain = sarifOf(renderSarif(base)) as { runs: (SarifRun & { properties?: unknown })[] };
    expect(log.runs.at(-1)?.properties?.impact).toEqual((JSON.parse(renderJson(run)) as { impact: unknown }).impact);
    expect(log.runs.slice(0, -1)).toEqual(plain.runs.slice(0, -1));
    expect(plain.runs.at(-1)?.properties).toBeUndefined();
  });
});
