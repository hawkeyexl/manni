/**
 * `runLint` dispatching on the tool that performs the structure job.
 *
 * `--tool` and `lint.structure.tool` were parsed and validated and then
 * nothing read them: every run went to `validateDocument` whatever the config
 * said. These pin the seam - what the shared prefix settles before the branch,
 * what belongs to manni alone, and what a tool that is not manni must never
 * cause to happen.
 *
 * The second tool is a throwaway registered here rather than a name added to
 * `LINT_TOOLS`. A name there is a `--tool` value the CLI accepts, and
 * accepting one for a tool that does not exist is the silent green this seam
 * exists to prevent.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLint, type LintOptions } from "../../../src/lint/commands/lint.js";
import {
  registerStructureTool,
  type StructureToolDescriptor,
} from "../../../src/lint/tools/index.js";
import { runDitaOtValidate } from "../../../src/lint/tools/dita-ot.js";
import { ruleId } from "../../../src/lint/core/rule-id.js";
import { LintError } from "../../../src/lint/types.js";
import { errorMessage } from "../../../src/shared/errors.js";
import { at, defined } from "../helpers.js";

/** The message a run failed with, or a failure saying it did not fail. */
async function messageOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    return errorMessage(err);
  }
  throw new Error("expected the run to fail, and it did not");
}

let dir: string;
let unregister: (() => void) | null = null;

/** The name the throwaway answers to. Not a `LintTool`, deliberately. */
const OUTSIDE = "outside" as unknown as StructureToolDescriptor["name"];

function outsideTool(
  over: Partial<StructureToolDescriptor> = {},
): StructureToolDescriptor {
  return {
    name: OUTSIDE,
    label: "Outside tool",
    formats: () => [],
    walkExtensions: () => [".md"],
    probe: () => Promise.resolve({ available: false, version: null }),
    // It owns none of manni's options, which is the point: every one of them
    // is then somebody else's option under this tool.
    ownedOptions: [],
    ...over,
  };
}

function useOutsideTool(over: Partial<StructureToolDescriptor> = {}): void {
  unregister = registerStructureTool(outsideTool(over));
}

async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

const HOW_TO =
  "---\ntype: how-to\n---\n\n# Do the thing\n\n## Overview\n\nWhy.\n\n" +
  "## Install it\n\nHow.\n\n## See also\n\nLinks.\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-lint-dispatch-"));
});

afterEach(async () => {
  unregister?.();
  unregister = null;
  await rm(dir, { recursive: true, force: true });
});

describe("resolving which tool performs the job", () => {
  it("defaults to manni and lints", async () => {
    await file("guide.md", HOW_TO);
    const run = await runLint({ inputs: [dir], cwd: dir, noConfig: true });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1 });
  });

  it("takes the tool the caller named", async () => {
    await file("guide.md", HOW_TO);
    const run = await runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: "manni",
    });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1 });
  });

  it("takes the tool the config named", async () => {
    await file("guide.md", HOW_TO);
    await file("manni.config.yaml", "lint:\n  structure:\n    tool: manni\n");
    const run = await runLint({ inputs: [dir], cwd: dir });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1 });
  });

  // The message the CLI's own guard already produced, now produced by the core
  // as well: `runLint` is exported from `src/index.ts` and called in process.
  it("refuses a tool nothing implements, with the CLI's own message", async () => {
    await file("guide.md", HOW_TO);
    const run = runLint({ inputs: [dir], cwd: dir, noConfig: true, tool: "vale" });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      'Unknown --tool "vale" for structure. Use manni, dita-ot.',
    );
  });
});

describe("an option belonging to a tool that is not running", () => {
  // A silently ignored option is a false green: the run reports success having
  // done something other than what was asked. #11's review already had to fix
  // one of these.
  const cases: [string, Partial<LintOptions>][] = [
    ["--template", { template: "tgdp:how-to:1.6" }],
    ["--templates", { templates: "./routes.yaml" }],
    ["--explain", { explain: true }],
    ["--as", { as: "markdown" }],
  ];

  it.each(cases)("is a usage error: %s", async (flag, over) => {
    await file("guide.md", HOW_TO);
    useOutsideTool();
    const run = runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: OUTSIDE,
      ...over,
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      `${flag} is an option of the manni tool; the structure job's tool is outside.`,
    );
  });

  // Stdin gets a sentence of its own: "option" is the wrong word for it, and
  // the advice a reader needs is what to pass instead.
  it("says so in its own words for stdin", async () => {
    useOutsideTool();
    const run = runLint({
      inputs: ["-"],
      cwd: dir,
      noConfig: true,
      tool: OUTSIDE,
      stdinContent: "# A\n",
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      "outside cannot read stdin. Name files or a map.",
    );
  });

  // The guards are derived from the descriptors, so the tool that does own an
  // option keeps it.
  it("is accepted by the tool that owns it", async () => {
    await file("guide.md", HOW_TO);
    useOutsideTool({ ownedOptions: ["--explain"] });
    const run = runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: OUTSIDE,
      explain: true,
    });
    // Past the ownership guard, so the complaint is about dispatch instead.
    await expect(run).rejects.toThrow(/No implementation/);
  });
});

describe("the prefix a non-manni tool still runs", () => {
  it("resolves its targets, and a mistyped path is still an error", async () => {
    useOutsideTool();
    const run = runLint({
      inputs: [join(dir, "typo.md")],
      cwd: dir,
      noConfig: true,
      tool: OUTSIDE,
    });
    await expect(run).rejects.toThrow(/File not found: .*typo\.md/);
  });

  it("guards an empty input set before anything else", async () => {
    useOutsideTool();
    const run = runLint({ inputs: [], cwd: dir, noConfig: true, tool: OUTSIDE });
    await expect(run).rejects.toThrow(/No files to check/);
  });

  // `--ext`'s default was `supportedExtensions()` - manni's parser registry -
  // whatever tool was running. It is the resolved tool's walk set now, which
  // is the same call for manni and a different one for anybody else.
  it("walks the extensions the resolved tool claims", async () => {
    await file("guide.md", HOW_TO);
    useOutsideTool({ walkExtensions: () => [".rst"] });
    const run = runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: OUTSIDE,
    });
    await expect(run).rejects.toThrow(/No files matched/);
    await expect(run).rejects.toThrow(/extensions: \.rst/);
  });
});

describe("work that belongs to manni alone", () => {
  // The template files were loaded and the type index built before the walk,
  // which is file I/O no other tool has any use for. A missing `templates:`
  // entry is therefore the loader's error under manni and nothing at all
  // under a tool that never reads templates.
  it("does not load the config's template files for another tool", async () => {
    await file("guide.md", HOW_TO);
    await file("manni.config.yaml", "lint:\n  templates:\n    - ./missing.yaml\n");
    useOutsideTool();
    const message = await messageOf(
      runLint({ inputs: [dir], cwd: dir, tool: OUTSIDE }),
    );
    expect(message).not.toContain("missing.yaml");
    expect(message).toMatch(/No implementation/);
  });

  it("still loads them for manni, and says so once", async () => {
    await file("guide.md", HOW_TO);
    await file("manni.config.yaml", "lint:\n  templates:\n    - ./missing.yaml\n");
    const run = runLint({ inputs: [dir], cwd: dir });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(/missing\.yaml/);
  });

  // The ordering this refactor had to preserve: a `--template` that will not
  // load is bad usage, so it exits 2 with one message rather than becoming an
  // identical finding on every page and exiting 1.
  it("refuses an unloadable --template once, before any page is linted", async () => {
    await file("a.md", HOW_TO);
    await file("b.md", HOW_TO);
    const run = runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      template: join(dir, "nope.yaml"),
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(/nope\.yaml/);
  });
});

/**
 * The DITA Open Toolkit branch.
 *
 * Nothing here starts DITA-OT. The run is given the real `runDitaOtValidate`
 * with a stub spawn, so everything between `runLint` and the process boundary
 * is the shipped code and only the launcher is faked.
 */
describe("linting with DITA Open Toolkit", () => {
  /** One log object, in the shape `--logger=json` writes. */
  function message(over: Record<string, unknown>): Record<string, unknown> {
    return { timestamp: "2026-09-21T09:20:11.002+02:00", ...over };
  }

  /** A run whose launcher writes `log` for every target it is given. */
  function ditaOt(
    log: Record<string, unknown>[],
    over: { code?: number; stderr?: string } = {},
  ): NonNullable<LintOptions["runDitaOt"]> {
    return (opts) =>
      runDitaOtValidate({
        ...opts,
        spawn: async (_launcher, args) => {
          const flag = "--logfile=";
          const logfile = args.find((arg) => arg.startsWith(flag));
          if (logfile !== undefined) {
            await writeFile(logfile.slice(flag.length), JSON.stringify(log));
          }
          return {
            code: over.code ?? 0,
            stdout: "",
            stderr: over.stderr ?? "",
          };
        },
      });
  }

  /** A coded error pointing at a file of this run's own. */
  function errorAt(path: string): Record<string, unknown> {
    return message({
      level: "ERROR",
      code: "DOTX010E",
      location: pathToFileURL(path).href,
      line: 11,
      row: 7,
      msg: "Could not retrieve the conref target.",
    });
  }

  /**
   * A validate that records the target set it was handed and answers with one
   * error against each target. The recording is the point: how many
   * invocations a set of paths becomes is a fact about the caller, and running
   * the real `runDitaOtValidate` over a stub spawn would hide it behind a
   * scratch directory.
   */
  function recordingDitaOt(): {
    validate: NonNullable<LintOptions["runDitaOt"]>;
    calls: string[][];
  } {
    const calls: string[][] = [];
    const validate: NonNullable<LintOptions["runDitaOt"]> = (opts) => {
      calls.push([...opts.targets]);
      return Promise.resolve(
        opts.targets.map((target) => ({
          target,
          messages: [
            {
              code: "DOTX010E",
              severity: "error" as const,
              message: "Could not retrieve the conref target.",
              file: target,
              line: 11,
              column: 7,
            },
          ],
        })),
      );
    };
    return { validate, calls };
  }

  it("reports a target with no findings as a pass", async () => {
    await file("docs.ditamap", "<map/>\n");
    const run = await runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([message({ level: "INFO", msg: "BUILD SUCCESSFUL" })]),
    });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1, failed: 0 });
    expect(at(run.results, 0).findings).toEqual([]);
  });

  // One map can produce findings for many topics, so results are grouped by
  // the file each message named rather than by the file that was invoked.
  it("groups findings by the file the log named", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const topic = await file("topic.dita", "<topic/>\n");
    const run = await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([errorAt(topic)]),
    });

    const files = run.results.map((r) => r.file);
    expect(files).toContain("topic.dita");
    expect(files).toContain("docs.ditamap");
    const found = defined(
      run.results.find((r) => r.file === "topic.dita"),
      "topic result",
    );
    expect(found.success).toBe(false);
    expect(at(found.findings, 0)).toMatchObject({
      type: "DOTX010E",
      severity: "error",
    });
    // The map itself was checked and had nothing of its own to answer for.
    const mapResult = defined(
      run.results.find((r) => r.file === "docs.ditamap"),
      "map result",
    );
    expect(mapResult.success).toBe(true);
  });

  it("carries DITA-OT's code as the finding's rule id", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const run = await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([errorAt(map)]),
    });
    expect(ruleId(at(at(run.results, 0).findings, 0).type)).toBe(
      "manni:lint/structure/DOTX010E",
    );
  });

  // The log's `row` is the column. Read as a row it lands every finding on the
  // wrong line, and nothing downstream would notice.
  it("puts the log's `row` in the finding's column", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const run = await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([errorAt(map)]),
    });
    const { position } = at(at(run.results, 0).findings, 0);
    expect(position.start.line).toBe(11);
    expect(position.start.column).toBe(7);
  });

  it("attributes a message with no location to the invoked target", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const run = await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([
        message({ level: "ERROR", code: "DOTJ046E", msg: "Unresolved." }),
      ]),
    });
    expect(run.results).toHaveLength(1);
    const result = at(run.results, 0);
    expect(result.file).toBe("docs.ditamap");
    expect(at(result.findings, 0).position).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    });
  });

  // `success` is "no error-severity finding", the rule manni's branch applies,
  // so a warning-only file stays green.
  it("passes a file whose findings are all warnings", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const run = await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([
        message({ level: "WARN", code: "DOTX057W", msg: "Link target." }),
      ]),
    });
    expect(at(run.results, 0).success).toBe(true);
    expect(run.summary).toMatchObject({ checked: 1, passed: 1, failed: 0 });
  });

  // A topic checked on its own resolves fewer references than the same topic
  // checked through its map. It is still checked, so this is a notice and not
  // a skip: calling it a skip would be false.
  it("says so when a topic is checked without its map", async () => {
    const topic = await file("topic.dita", "<topic/>\n");
    const notices: string[] = [];
    await runLint({
      inputs: [topic],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      onNotice: (notice) => notices.push(notice),
      runDitaOt: ditaOt([]),
    });
    expect(notices).toEqual([
      "checked topic.dita without a map; references outside it are not resolved.",
    ]);
  });

  it("says nothing of the kind for a map", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const notices: string[] = [];
    await runLint({
      inputs: [map],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      onNotice: (notice) => notices.push(notice),
      runDitaOt: ditaOt([]),
    });
    expect(notices).toEqual([]);
  });

  /**
   * Two spellings of one map are one map, end to end.
   *
   * The answer has to be one invocation and one result. Two results would be
   * worse than wasteful: only one of them can receive the findings, so the
   * other reports the same file as a clean pass.
   *
   * Where that is settled is worth knowing. `resolveTargetSet` already
   * normalizes every input to one cwd-relative posix path and keeps them in a
   * set, so the spellings collapse before the dita-ot branch sees them, and
   * `lintWithDitaOt`'s own deduplication is a second belt on the same
   * trousers. This pins the guarantee rather than either mechanism, so it
   * holds whichever of the two is doing the work.
   */
  it("checks a map named twice under two spellings once", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const { validate, calls } = recordingDitaOt();
    const run = await runLint({
      inputs: [map, `./${basename(map)}`],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: validate,
    });

    expect(calls).toHaveLength(1);
    expect(at(calls, 0)).toHaveLength(1);
    // One entry, and it is the failing one. Before the dedupe the second
    // spelling seeded a result of its own that no finding ever reached.
    expect(run.results).toHaveLength(1);
    expect(at(run.results, 0).success).toBe(false);
    expect(run.summary).toMatchObject({ checked: 1, passed: 0, failed: 1 });
  });

  // The other half of the same rule: collapsing is by path, so two maps that
  // are genuinely two maps are still both handed over.
  it("checks two different maps as two targets", async () => {
    const first = await file("first.ditamap", "<map/>\n");
    const second = await file("second.ditamap", "<map/>\n");
    const { validate, calls } = recordingDitaOt();
    const run = await runLint({
      inputs: [first, second],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: validate,
    });

    expect(calls).toHaveLength(1);
    expect(at(calls, 0)).toHaveLength(2);
    expect(run.results.map((r) => r.file).sort()).toEqual([
      "first.ditamap",
      "second.ditamap",
    ]);
  });

  // The walk set is the descriptor's, so a directory collects maps alone.
  it("walks maps and leaves the topics beside them to the map", async () => {
    await file("docs.ditamap", "<map/>\n");
    await file("topic.dita", "<topic/>\n");
    const run = await runLint({
      inputs: [dir],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([]),
    });
    expect(run.results.map((r) => r.file)).toEqual(["docs.ditamap"]);
  });

  // `tools.dita-ot.home` is read from the family key, resolved against the
  // config's own directory, and a home with no launcher is named.
  it("reads tools.dita-ot.home from the family config", async () => {
    await file("docs.ditamap", "<map/>\n");
    await file("manni.config.yaml", "tools:\n  dita-ot:\n    home: ./nope\n");
    const run = runLint({
      inputs: [dir],
      cwd: dir,
      tool: "dita-ot",
      runDitaOt: (opts) =>
        runDitaOtValidate({
          ...opts,
          spawn: () => {
            throw new Error("the launcher must not be started");
          },
        }),
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      /no DITA Open Toolkit at ".*nope"\. tools\.dita-ot\.home must be a DITA-OT installation directory\./,
    );
  });

  it("takes the tool the config named", async () => {
    await file("docs.ditamap", "<map/>\n");
    await file("manni.config.yaml", "lint:\n  structure:\n    tool: dita-ot\n");
    const run = await runLint({
      inputs: [dir],
      cwd: dir,
      runDitaOt: ditaOt([]),
    });
    expect(run.summary).toMatchObject({ checked: 1, passed: 1 });
  });

  /**
   * A `ditaOt` that also records the target list each invocation was handed.
   *
   * What the tool is *not* given is the assertion: a file it cannot read that
   * reaches the launcher comes back with an empty log, which reads as a clean
   * pass for a file nothing looked at.
   */
  function recording(log: Record<string, unknown>[] = []): {
    targets: string[][];
    runDitaOt: NonNullable<LintOptions["runDitaOt"]>;
  } {
    const targets: string[][] = [];
    const validate = ditaOt(log);
    return {
      targets,
      runDitaOt: (opts) => {
        targets.push([...opts.targets]);
        return validate(opts);
      },
    };
  }

  /**
   * Only the formats the descriptor declares are handed to the tool.
   *
   * `manni lint structure notes.md` under `tool: dita-ot` reported `✓ notes.md`,
   * 1 passed, exit 0. DITA-OT shrugged at a file it does not read and logged
   * nothing to disagree with, and an empty log is how a clean target looks.
   */
  it("skips a target in a format it does not read, and passes the rest", async () => {
    const map = await file("docs.ditamap", "<map/>\n");
    const notes = await file("notes.md", "# Notes\n");
    const { targets, runDitaOt } = recording();
    const run = await runLint({
      inputs: [map, notes],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt,
    });

    // The launcher saw the map and only the map. Names rather than paths:
    // the walker spells a target its own way, and which file it was is what
    // this is about.
    expect(targets.map((list) => list.map((t) => basename(t)))).toEqual([
      ["docs.ditamap"],
    ]);
    const skipped = defined(
      run.results.find((r) => basename(r.file) === "notes.md"),
      "notes.md result",
    );
    // Not a pass. A file that was never checked is neither passing nor
    // failing, and calling it a pass is the false green itself.
    expect(skipped.success).toBe(false);
    expect(skipped.skipped).toBe("unsupported-format");
    expect(skipped.reason).toBe(
      'dita-ot does not read ".md". It reads .ditamap, .dita, .xml.',
    );
    expect(run.summary).toMatchObject({ checked: 1, passed: 1, skipped: 1 });
  });

  // No JVM for an empty list: a run with nothing the tool can read has no
  // question to ask it.
  it("starts nothing when every target is in a format it cannot read", async () => {
    const notes = await file("notes.md", "# Notes\n");
    const { targets, runDitaOt } = recording();
    const run = runLint({
      inputs: [notes],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt,
    });
    await expect(run).rejects.toThrow(/Nothing was checked/);
    expect(targets).toEqual([]);
  });

  /**
   * "Nothing was checked" guards every tool, not just manni's branch.
   *
   * It sat at the end of the manni branch, so the dita-ot run that skipped
   * every file it was given reported "0 files checked, 1 skipped" and exited
   * 0 - a clean CI job over a docset nothing looked at.
   */
  it("refuses a run it skipped every file of, rather than reporting a clean one", async () => {
    const notes = await file("notes.md", "# Notes\n");
    const message = await messageOf(
      runLint({
        inputs: [notes],
        cwd: dir,
        noConfig: true,
        tool: "dita-ot",
        runDitaOt: ditaOt([]),
      }),
    );
    expect(message).toContain("Nothing was checked");
    expect(message).toContain("1 is in a format dita-ot does not read");
  });

  it("is a LintError, so the run exits 2 rather than 0", async () => {
    await file("notes.md", "# Notes\n");
    const run = runLint({
      inputs: [join(dir, "notes.md")],
      cwd: dir,
      noConfig: true,
      tool: "dita-ot",
      runDitaOt: ditaOt([]),
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
  });

  /**
   * The advice follows the tool, because `--as` is manni's option and every
   * one of manni's options is a usage error under `dita-ot`. Telling a
   * dita-ot user to pass `--as` is advice that answers with a second refusal.
   */
  it("offers --as only to the tool that owns it", async () => {
    const notes = await file("notes.md", "# Notes\n");
    const unsupported = await file("notes.xyz", "whatever\n");

    const underDitaOt = await messageOf(
      runLint({
        inputs: [notes],
        cwd: dir,
        noConfig: true,
        tool: "dita-ot",
        runDitaOt: ditaOt([]),
      }),
    );
    expect(underDitaOt).not.toContain("--as");
    expect(underDitaOt).toContain(
      'target files in a format "manni lint tools" lists',
    );

    // manni's own branch keeps the offer, because there the flag works.
    const underManni = await messageOf(
      runLint({ inputs: [unsupported], cwd: dir, noConfig: true }),
    );
    expect(underManni).toContain("Nothing was checked");
    expect(underManni).toContain("pass --as <format> to force one");
  });
});
