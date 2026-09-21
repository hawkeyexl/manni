/**
 * The DITA Open Toolkit seam: how `dita` is started, and how its log is read.
 *
 * Nothing here starts DITA-OT: every test injects a stub spawn, so the suite
 * needs no JVM. What it is fed is not invented, though. The logs under
 * `test/lint/fixtures/dita-ot/logs/` are verbatim captures of DITA-OT 4.4.1
 * runs over the fixtures beside them, with only absolute paths rewritten, and
 * their README records what each one holds. Where a level or a shape no
 * captured run produced has to be covered, the input is a small literal in the
 * test that needs it rather than a log pretending to be a capture.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ditaOtCommandLine,
  ditaOtLauncher,
  foldDitaOtSeverity,
  parseDitaOtLog,
  parseDitaOtVersion,
  probeDitaOt,
  runDitaOtValidate,
  type DitaOtMessage,
  type DitaOtProcessResult,
  type DitaOtSpawn,
} from "../../../src/lint/tools/dita-ot.js";
import { structureTool } from "../../../src/lint/tools/index.js";
import { LintError } from "../../../src/lint/types.js";
import { isErrorSeverity } from "../../../src/meta/index.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const logs = join(here, "..", "fixtures", "dita-ot", "logs");

const log = (name: string): Promise<string> =>
  readFile(join(logs, `${name}.log.json`), "utf8");

/** The messages a captured log parses to, or a failure saying it did not parse. */
async function messagesOf(name: string): Promise<DitaOtMessage[]> {
  return defined(parseDitaOtLog(await log(name)), `${name} parsed`);
}

/**
 * How many objects a captured log holds, before the `code` filter sees them.
 *
 * The counts matter: these logs are captures of real `--verbose` runs, where
 * roughly 130 entries carry one or two findings between them. A test that only
 * counted findings would pass just as happily against an empty file.
 */
async function entryCount(name: string): Promise<number> {
  const parsed = JSON.parse(await log(name)) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${name} is not an array log`);
  return (parsed as unknown[]).length;
}

interface Call {
  launcher: string;
  args: string[];
  cwd?: string;
}

interface Stub {
  spawn: DitaOtSpawn;
  calls: Call[];
}

/** A spawn that records what it was given and answers however the test says. */
function stub(
  answer: (call: Call) => DitaOtProcessResult | Promise<DitaOtProcessResult>,
): Stub {
  const calls: Call[] = [];
  const spawn: DitaOtSpawn = async (launcher, args, opts) => {
    const call: Call = {
      launcher,
      args,
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    };
    calls.push(call);
    return await answer(call);
  };
  return { spawn, calls };
}

const ok = (over: Partial<DitaOtProcessResult> = {}): DitaOtProcessResult => ({
  code: 0,
  stdout: "",
  stderr: "",
  ...over,
});

/** The value of a `--flag=value` argument, or a failure naming the flag. */
function valueOf(args: string[], flag: string): string {
  const prefix = `${flag}=`;
  return defined(
    args.find((arg) => arg.startsWith(prefix)),
    flag,
  ).slice(prefix.length);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A home holding a launcher, so a failure is read as the launcher's own rather
 * than as "there is no DITA-OT here".
 */
async function fakeHome(): Promise<string> {
  const home = join(dir, "dita-ot");
  const launcher = ditaOtLauncher(home);
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(launcher, "");
  return home;
}

/** A start failure, the shape Node reports when there is no such binary. */
const enoent = (): never => {
  throw Object.assign(new Error("spawn dita ENOENT"), { code: "ENOENT" });
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-dita-ot-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the captured logs", () => {
  // DITA-OT writes hundreds of INFO progress lines, and `code` is its own
  // marker that a message is a diagnostic. A clean build must therefore yield
  // nothing at all, not a notice per line of chatter - and with `--verbose`
  // there are 128 lines of chatter here to get that wrong on.
  it("find nothing in a clean build, all 128 entries of it", async () => {
    await expect(entryCount("clean")).resolves.toBe(128);
    await expect(messagesOf("clean")).resolves.toEqual([]);
  });

  it("read a coded error with a full location", async () => {
    const messages = await messagesOf("broken-conref");
    expect(messages).toHaveLength(1);
    expect(at(messages, 0)).toMatchObject({
      code: "DOTX010E",
      severity: "error",
      file: "/repo/broken-conref.dita",
      line: 10,
      column: 59,
    });
    expect(at(messages, 0).message).toContain(
      "Unable to find the @conref target",
    );
    // The predicate a run's exit code follows. An error blocks a CI job.
    expect(isErrorSeverity(at(messages, 0))).toBe(true);
  });

  it("drop every entry that carries no code", async () => {
    // 134 entries in, one finding out. The other 133 are progress.
    await expect(entryCount("broken-conref")).resolves.toBe(134);
    await expect(messagesOf("broken-conref")).resolves.toHaveLength(1);
  });

  // DITA-OT reports an undefined key reference at INFO, which is why the run
  // asks for `--verbose`: the default verbosity drops this entry entirely.
  it("read an INFO-level finding as a notice, which does not fail a run", async () => {
    await expect(entryCount("undefined-key")).resolves.toBe(136);
    const messages = await messagesOf("undefined-key");
    expect(messages).toHaveLength(1);
    expect(at(messages, 0)).toMatchObject({
      code: "DOTJ047I",
      severity: "notice",
      file: "/repo/undefined-key.dita",
      line: 10,
      column: 50,
    });
    // A notice annotates a CI job rather than blocking it, and that difference
    // is the whole point of folding INFO onto `notice` instead of dropping it.
    expect(isErrorSeverity(at(messages, 0))).toBe(false);
  });

  it("read two coded errors from one run, one of them with no location", async () => {
    await expect(entryCount("dead-xref")).resolves.toBe(137);
    const messages = await messagesOf("dead-xref");
    expect(messages.map((m) => [m.code, m.severity])).toEqual([
      ["DOTX008E", "error"],
      ["DOTX031E", "error"],
    ]);
    // The resource-load error names its file in the message text and nowhere
    // else: no `location`, no `line`, no `row`. It is still a finding.
    const unplaced = at(messages, 0);
    expect(unplaced.file).toBeUndefined();
    expect(unplaced.line).toBeUndefined();
    expect(unplaced.column).toBeUndefined();
    expect(unplaced.message).toContain("cannot be loaded");
    expect(at(messages, 1)).toMatchObject({
      file: "/repo/dead-xref.dita",
      line: 10,
      column: 56,
    });
  });
});

describe("the severity fold", () => {
  // ERROR and INFO are the two levels the captured logs carry, and the tests
  // above pin those against real output. The rest are tested here, as the pure
  // function they are, rather than in a log nobody's DITA-OT ever wrote.
  it("maps the levels the captured logs carry", () => {
    expect(foldDitaOtSeverity("ERROR")).toBe("error");
    expect(foldDitaOtSeverity("INFO")).toBe("notice");
  });

  it("maps the levels no captured log happens to carry", () => {
    expect(foldDitaOtSeverity("FATAL")).toBe("error");
    expect(foldDitaOtSeverity("WARN")).toBe("warning");
  });

  it("drops the levels that are build chatter", () => {
    expect(foldDitaOtSeverity("DEBUG")).toBeNull();
    expect(foldDitaOtSeverity("TRACE")).toBeNull();
  });

  // A level manni does not know is not silently promoted to a finding.
  it("drops a level it does not know", () => {
    expect(foldDitaOtSeverity("VERBOSE")).toBeNull();
  });

  it("drops a DEBUG or TRACE message even when it carries a code", () => {
    const text = JSON.stringify([
      { timestamp: "t", level: "DEBUG", code: "DOTX010E", msg: "noisy" },
      { timestamp: "t", level: "TRACE", code: "DOTX057W", msg: "noisier" },
    ]);
    expect(parseDitaOtLog(text)).toEqual([]);
  });
});

describe("the log's `row` field", () => {
  // The logger's regex takes group 2 as the line and group 3 as the column,
  // and writes the column out under the name `row`. Read as a row, every
  // finding lands on the wrong line, which is the easiest thing here to get
  // wrong and the hardest to notice.
  it("is the column, not a second line", () => {
    const text = JSON.stringify([
      {
        timestamp: "t",
        level: "ERROR",
        code: "DOTX010E",
        location: "file:/repo/a.dita",
        line: 11,
        row: 7,
        msg: "x",
      },
    ]);
    const messages = defined(parseDitaOtLog(text), "parsed");
    expect(at(messages, 0).line).toBe(11);
    expect(at(messages, 0).column).toBe(7);
  });
});

describe("a `location` file URI", () => {
  it("reads DITA-OT's one-slash form", () => {
    const target = join(dir, "topic.dita");
    const oneSlash = pathToFileURL(target).href.replace("file:///", "file:/");
    const text = JSON.stringify([
      {
        timestamp: "t",
        level: "ERROR",
        code: "DOTX010E",
        location: oneSlash,
        line: 2,
        row: 1,
        msg: "x",
      },
    ]);
    const messages = defined(parseDitaOtLog(text), "parsed");
    expect(at(messages, 0).file).toBe(target);
  });

  // The suite runs on Windows too, where `fileURLToPath` refuses a POSIX-rooted
  // file URI outright. DITA-OT on a POSIX host writes exactly that.
  it("reads a POSIX-rooted URI on any platform", () => {
    const text = JSON.stringify([
      {
        timestamp: "t",
        level: "WARN",
        code: "DOTX057W",
        location: "file:/repo/docs/a.dita",
        msg: "x",
      },
    ]);
    const messages = defined(parseDitaOtLog(text), "parsed");
    expect(at(messages, 0).file).toBe("/repo/docs/a.dita");
  });

  it("decodes an escaped character", () => {
    const text = JSON.stringify([
      {
        timestamp: "t",
        level: "WARN",
        code: "DOTX057W",
        location: "file:/repo/my%20docs/a.dita",
        msg: "x",
      },
    ]);
    const messages = defined(parseDitaOtLog(text), "parsed");
    expect(at(messages, 0).file).toBe("/repo/my docs/a.dita");
  });
});

describe("a log that is not a log", () => {
  it("is unparseable rather than empty", () => {
    expect(parseDitaOtLog("BUILD FAILED\n")).toBeNull();
    expect(parseDitaOtLog('{"level":"INFO"}')).toBeNull();
  });
});

describe("the version", () => {
  it("is read out of whatever the launcher printed", () => {
    expect(parseDitaOtVersion("DITA-OT version 4.4.1\n")).toBe("4.4.1");
    expect(parseDitaOtVersion("4.2\n")).toBe("4.2");
  });

  it("is null when nothing in the output looks like one", () => {
    expect(parseDitaOtVersion("dita\n")).toBeNull();
  });
});

describe("locating the launcher", () => {
  it("is the bare name when no home is configured", () => {
    expect(ditaOtLauncher(undefined, "linux")).toBe("dita");
    expect(ditaOtLauncher(undefined, "win32")).toBe("dita.bat");
  });

  it("is `bin/dita` inside the home when one is", () => {
    expect(ditaOtLauncher("/opt/dita-ot", "linux")).toBe(
      join("/opt/dita-ot", "bin", "dita"),
    );
    expect(ditaOtLauncher("C:\\dita-ot", "win32")).toBe(
      join("C:\\dita-ot", "bin", "dita.bat"),
    );
  });
});

describe("the command line", () => {
  it("starts a POSIX launcher directly, with an argv array", () => {
    const line = ditaOtCommandLine("/opt/dita-ot/bin/dita", [
      "--input=/repo/a.ditamap",
      "--format=dita",
    ]);
    expect(line).toEqual({
      command: "/opt/dita-ot/bin/dita",
      argv: ["--input=/repo/a.ditamap", "--format=dita"],
      verbatim: false,
    });
  });

  // `shell: true` would join the argv into one string with no quoting, and the
  // argv here carries user-supplied paths.
  it("routes a .bat through cmd.exe, quoted, never through a shell string", () => {
    const line = ditaOtCommandLine("C:\\dita ot\\bin\\dita.bat", [
      "--input=C:\\my docs\\a.ditamap",
      "--format=dita",
    ]);
    expect(line.command.toLowerCase()).toContain("cmd");
    expect(line.verbatim).toBe(true);
    expect(line.argv.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(line.argv).toHaveLength(4);
    expect(at(line.argv, 3)).toBe(
      '""C:\\dita ot\\bin\\dita.bat" "--input=C:\\my docs\\a.ditamap" "--format=dita""',
    );
  });
});

describe("running DITA-OT", () => {
  // The whole invocation, in order, because each flag is load-bearing and none
  // of them is obvious. `--format=dita` runs the preprocessing chain, which is
  // where conref, keyref and link resolution happen; `dita validate` resolves
  // no references and accepts none of the logging flags. `--verbose` is what
  // keeps an INFO-level finding in the log. `--output` and `--temp` are named
  // so the transformation's output lands in the scratch tree and not the
  // user's. And it is an argv array, never a string a shell would re-split.
  it("invokes the launcher once per target, with the whole argv", async () => {
    const { spawn, calls } = stub((call) =>
      writeFile(valueOf(call.args, "--logfile"), "[]").then(() => ok()),
    );
    await runDitaOtValidate({
      targets: [join(dir, "a.ditamap"), join(dir, "b.ditamap")],
      cwd: dir,
      spawn,
    });

    expect(calls).toHaveLength(2);
    const first = at(calls, 0);
    expect(Array.isArray(first.args)).toBe(true);
    expect(first.launcher).toBe(ditaOtLauncher(undefined));
    const scratch = dirname(valueOf(first.args, "--logfile"));
    const argvFor = (index: number, target: string): string[] => [
      `--input=${target}`,
      "--format=dita",
      `--output=${join(scratch, `out-${String(index)}`)}`,
      `--temp=${join(scratch, `temp-${String(index)}`)}`,
      "--logger=json",
      `--logfile=${join(scratch, `${String(index)}.json`)}`,
      "--verbose",
    ];
    expect(first.args).toEqual(argvFor(0, join(dir, "a.ditamap")));
    // A log file per target, so one invocation cannot read another's findings.
    expect(at(calls, 1).args).toEqual(argvFor(1, join(dir, "b.ditamap")));
  });

  // DITA-OT publishes no exit-code contract, and the captured runs show it in
  // both directions: the real `broken-conref` run reported an ERROR finding
  // and still exited 0. Where the log accounts for the exit, as an
  // error-severity finding does, the log is the verdict at either code.
  //
  // The non-zero half is the one that matters. Real findings must not turn
  // into an operational failure the moment DITA-OT also exits non-zero for
  // them, or the exit-code guard below would trade one false report for
  // another.
  it.each([0, 1])("reports what the log says at exit code %i", async (code) => {
    const text = await log("broken-conref");
    const { spawn } = stub((call) =>
      writeFile(valueOf(call.args, "--logfile"), text).then(() =>
        ok({ code, stderr: code === 0 ? "" : "BUILD FAILED" }),
      ),
    );
    const results = await runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      spawn,
    });
    expect(at(results, 0).messages).toHaveLength(1);
    expect(at(at(results, 0).messages, 0).code).toBe("DOTX010E");
    // The severity is what accounts for the non-zero exit, so it is asserted
    // here rather than left to the parse tests above.
    expect(at(at(results, 0).messages, 0).severity).toBe("error");
  });

  /**
   * The false green from a real run, and the reason the exit code is read at
   * all. A `.ditamap` that is not well-formed makes DITA-OT exit 1 while
   * writing a perfectly readable 28-entry log whose only coded entries are
   * `DOTJ030I` at `INFO`. The fatal parse error appears in neither the log nor
   * stdout nor stderr, so trusting the parse reported the file as passing and
   * the whole run exited 0.
   */
  it("refuses a non-zero exit that no error in the log accounts for", async () => {
    const target = join(dir, "a.ditamap");
    const noticesOnly = JSON.stringify([
      { timestamp: "t", level: "INFO", code: "DOTJ030I", msg: "Processing." },
    ]);
    const { spawn } = stub((call) =>
      writeFile(valueOf(call.args, "--logfile"), noticesOnly).then(() =>
        ok({ code: 1, stderr: "BUILD FAILED" }),
      ),
    );
    const run = runDitaOtValidate({
      targets: [target],
      cwd: dir,
      home: await fakeHome(),
      spawn,
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    // The target is named: one run walks many, and a message that did not say
    // which one leaves the reader nothing to run DITA-OT on.
    await expect(run).rejects.toThrow(
      `DITA Open Toolkit failed on ${target}: BUILD FAILED. ` +
        `Run it directly on that file to see why.`,
    );
  });

  // The guard reads the exit code, not the findings: a notice is not an error,
  // but at exit 0 there is nothing for it to account for.
  it("keeps a notice-only log at a zero exit", async () => {
    const text = await log("undefined-key");
    const { spawn } = stub((call) =>
      writeFile(valueOf(call.args, "--logfile"), text).then(() => ok()),
    );
    const results = await runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      spawn,
    });
    expect(at(results, 0).messages.map((m) => [m.code, m.severity])).toEqual([
      ["DOTJ047I", "notice"],
    ]);
  });

  it("is an operational failure only when the log is missing too", async () => {
    const target = join(dir, "a.ditamap");
    const { spawn } = stub(() => ok({ code: 1, stderr: "  Java not found  " }));
    const run = runDitaOtValidate({
      targets: [target],
      cwd: dir,
      home: await fakeHome(),
      spawn,
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      `DITA Open Toolkit failed on ${target}: Java not found.`,
    );
  });

  it("is clean when the log is missing and the exit code is zero", async () => {
    const { spawn } = stub(() => ok());
    const results = await runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      spawn,
    });
    expect(at(results, 0).messages).toEqual([]);
  });

  it("removes its scratch directory when the run succeeds", async () => {
    let scratch = "";
    const { spawn } = stub((call) => {
      scratch = dirname(valueOf(call.args, "--logfile"));
      return writeFile(valueOf(call.args, "--logfile"), "[]").then(() => ok());
    });
    await runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      spawn,
    });
    expect(scratch).not.toBe("");
    await expect(exists(scratch)).resolves.toBe(false);
  });

  it("removes its scratch directory when the run throws", async () => {
    let scratch = "";
    const { spawn } = stub((call) => {
      scratch = dirname(valueOf(call.args, "--logfile"));
      return ok({ code: 2, stderr: "boom" });
    });
    await expect(
      runDitaOtValidate({
        targets: [join(dir, "a.ditamap")],
        cwd: dir,
        home: await fakeHome(),
        spawn,
      }),
    ).rejects.toThrow(LintError);
    expect(scratch).not.toBe("");
    await expect(exists(scratch)).resolves.toBe(false);
  });

  it("names the missing binary rather than raising a start failure", async () => {
    const { spawn } = stub(enoent);
    const run = runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      spawn,
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      "dita is not on PATH. Install DITA Open Toolkit to lint structure, or set tools.dita-ot.home.",
    );
  });

  it("starts the launcher inside a configured home", async () => {
    const home = await fakeHome();
    const { spawn, calls } = stub((call) =>
      writeFile(valueOf(call.args, "--logfile"), "[]").then(() => ok()),
    );
    await runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      home,
      spawn,
    });
    expect(at(calls, 0).launcher).toBe(ditaOtLauncher(home));
  });

  it("names a home that holds no launcher, without starting anything", async () => {
    const { spawn, calls } = stub(() => ok());
    const home = join(dir, "not-dita-ot");
    const run = runDitaOtValidate({
      targets: [join(dir, "a.ditamap")],
      cwd: dir,
      home,
      spawn,
    });
    await expect(run).rejects.toBeInstanceOf(LintError);
    await expect(run).rejects.toThrow(
      `no DITA Open Toolkit at "${home}". tools.dita-ot.home must be a DITA-OT installation directory.`,
    );
    expect(calls).toEqual([]);
  });
});

describe("the probe", () => {
  it("reports what is missing rather than throwing", async () => {
    const { spawn } = stub(enoent);
    await expect(probeDitaOt({ cwd: dir }, spawn)).resolves.toEqual({
      available: false,
      version: null,
    });
  });

  it("asks the launcher for its version", async () => {
    const { spawn, calls } = stub(() =>
      ok({ stdout: "DITA-OT version 4.4.1\n" }),
    );
    await expect(probeDitaOt({ cwd: dir }, spawn)).resolves.toEqual({
      available: true,
      version: "4.4.1",
    });
    expect(at(calls, 0).args).toEqual(["--version"]);
  });

  it("is available with no version when the output says nothing useful", async () => {
    const { spawn } = stub(() => ok({ stdout: "dita\n" }));
    await expect(probeDitaOt({ cwd: dir }, spawn)).resolves.toEqual({
      available: true,
      version: null,
    });
  });

  // A launcher that starts and fails is not one this checkout can lint with -
  // on Windows a missing `dita.bat` is cmd.exe's non-zero exit, not an ENOENT.
  it("is unavailable when the launcher exits non-zero", async () => {
    const { spawn } = stub(() => ok({ code: 9009, stderr: "not recognized" }));
    await expect(probeDitaOt({ cwd: dir }, spawn)).resolves.toEqual({
      available: false,
      version: null,
    });
  });

  it("is unavailable when a configured home holds no launcher", async () => {
    const { spawn, calls } = stub(() => ok());
    const probe = probeDitaOt(
      { cwd: dir, tools: { "dita-ot": { home: "nope" } }, configDir: dir },
      spawn,
    );
    await expect(probe).resolves.toEqual({ available: false, version: null });
    expect(calls).toEqual([]);
    expect(resolve(dir, "nope")).toContain("nope");
  });
});

describe("the descriptor", () => {
  const ditaOt = defined(structureTool("dita-ot"), "dita-ot descriptor");

  it("lists DITA as its one format", () => {
    expect(ditaOt.formats()).toEqual([
      {
        name: "dita",
        label: "DITA",
        extensions: [".ditamap", ".dita", ".xml"],
        kinds: [],
      },
    ]);
  });

  // Maps only, deliberately: DITA-OT takes one `--input` per invocation, so
  // walking every topic would pay a JVM start per topic. A named `.dita`
  // still works, because named files bypass the filter.
  it("walks maps and nothing else", () => {
    expect(ditaOt.walkExtensions()).toEqual([".ditamap"]);
  });

  it("owns no options, so every one of manni's is refused under it", () => {
    expect(ditaOt.ownedOptions).toEqual([]);
  });

  it("is labelled for a reader", () => {
    expect(ditaOt.label).toBe("DITA Open Toolkit");
  });
});
