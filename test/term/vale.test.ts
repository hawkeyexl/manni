/**
 * The Vale process seam (proposal 0052 § 6): what `vale --output=JSON` and
 * `vale ls-config` print, and how each exit becomes a result or a `TermError`.
 * A stub stands in for the process, so these run without Vale installed.
 */
import { describe, expect, it } from "vitest";
import { runValeJson, valeLsConfig, type ValeSpawn } from "../../src/term/core/vale.js";
import { TermError } from "../../src/term/errors.js";

interface Call {
  args: string[];
  cwd?: string;
}

function stub(result: {
  code: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}): {
  spawn: ValeSpawn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const spawn: ValeSpawn = (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    return Promise.resolve({
      code: result.code,
      signal: result.signal ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    });
  };
  return { spawn, calls };
}

/** The TermError a promise rejects with; fails the test for anything else. */
async function termError(promise: Promise<unknown>): Promise<TermError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof TermError)) throw new Error(`expected a TermError, got ${String(err)}`);
  return err;
}

const missing: ValeSpawn = () =>
  Promise.reject(Object.assign(new Error("spawn vale ENOENT"), { code: "ENOENT" }));

const ALERTS = {
  "C:\\Users\\HAWKEY~1\\Temp\\x\\kubernetes.definition.md": [
    {
      Action: { Name: "", Params: null },
      Span: [4, 13],
      Check: "Tiny.Frob",
      Description: "",
      Link: "",
      Message: "Avoid 'frobnicate'.",
      Severity: "error",
      Match: "frobnicate",
      Line: 1,
    },
  ],
};

describe("runValeJson", () => {
  it("runs vale with JSON output over the files and parses exit 0", async () => {
    const { spawn, calls } = stub({ code: 0, stdout: "{}\n" });
    const alerts = await runValeJson(["/tmp/a.definition.md", "/tmp/b.abstract.md"], { cwd: "/work" }, spawn);
    expect(alerts).toEqual({});
    expect(calls).toEqual([
      { args: ["--output=JSON", "/tmp/a.definition.md", "/tmp/b.abstract.md"], cwd: "/work" },
    ]);
  });

  it("passes --config before the files", async () => {
    const { spawn, calls } = stub({ code: 0, stdout: "{}" });
    await runValeJson(["/tmp/a.md"], { config: "/work/.vale.ini" }, spawn);
    expect(calls[0]?.args).toEqual(["--output=JSON", "--config", "/work/.vale.ini", "/tmp/a.md"]);
  });

  it("parses exit 1, where at least one alert is an error, and keeps only the fields it reads", async () => {
    const { spawn } = stub({ code: 1, stdout: JSON.stringify(ALERTS) });
    const alerts = await runValeJson(["x"], {}, spawn);
    expect(alerts).toEqual({
      "C:\\Users\\HAWKEY~1\\Temp\\x\\kubernetes.definition.md": [
        { Check: "Tiny.Frob", Message: "Avoid 'frobnicate'.", Line: 1, Span: [4, 13], Severity: "error" },
      ],
    });
  });

  it("refuses output it cannot read", async () => {
    const bad = { "a.md": [{ Check: "X.Y", Message: "m", Line: "1", Span: [1, 2], Severity: "error" }] };
    await expect(runValeJson(["x"], {}, stub({ code: 1, stdout: JSON.stringify(bad) }).spawn)).rejects.toThrow(
      TermError,
    );
    await expect(runValeJson(["x"], {}, stub({ code: 0, stdout: "not json" }).spawn)).rejects.toThrow(TermError);
    const badSeverity = { "a.md": [{ Check: "X.Y", Message: "m", Line: 1, Span: [1, 2], Severity: "fatal" }] };
    await expect(
      runValeJson(["x"], {}, stub({ code: 0, stdout: JSON.stringify(badSeverity) }).spawn),
    ).rejects.toThrow(TermError);
  });

  it("turns exit 2 into a TermError carrying Vale's stderr, trimmed", async () => {
    const { spawn } = stub({ code: 2, stderr: "\nE100 [--config] Runtime error\n\npath 'x.ini' does not exist\n\n" });
    const err = await termError(runValeJson(["x"], {}, spawn));
    expect(err.message).toContain("E100 [--config] Runtime error\n\npath 'x.ini' does not exist");
    expect(err.message).not.toMatch(/\n$/);
  });

  it("reads the text out of the JSON error Vale prints under --output=JSON", async () => {
    const stderr = JSON.stringify({ Line: 0, Path: "", Text: "E100 [.vale.ini not found] Runtime error", Code: "E100", Span: 0 });
    const err = await termError(runValeJson(["x"], {}, stub({ code: 2, stderr }).spawn));
    expect(err.message).toContain("E100 [.vale.ini not found] Runtime error");
    expect(err.message).not.toContain('"Code"');
  });

  it("says Vale is not on PATH when the binary is missing", async () => {
    const err = await termError(runValeJson(["x"], {}, missing));
    expect(err.message).toBe("vale is not on PATH. Install Vale to lint definitions.");
  });
});

const LS_CONFIG = {
  BlockIgnores: {},
  SBaseStyles: {
    "*.md": ["Voices", "Direct", "Moose", "Terms"],
    "*.{md,mdx,txt}": ["Voices", "Direct", "Moose"],
  },
  RootINI: "C:\\Users\\me\\project/.vale.ini",
  Paths: ["C:\\Users\\me\\AppData\\Local\\vale\\styles", "C:\\Users\\me\\project\\.github\\styles"],
  ConfigFiles: ["C:\\Users\\me\\project/.vale.ini"],
};

describe("valeLsConfig", () => {
  it("runs ls-config in cwd and returns the styles directory, root ini and section styles", async () => {
    const { spawn, calls } = stub({ code: 0, stdout: JSON.stringify(LS_CONFIG) });
    const resolved = await valeLsConfig({ cwd: "/work/docs" }, spawn);
    expect(calls).toEqual([{ args: ["ls-config"], cwd: "/work/docs" }]);
    expect(resolved).toEqual({
      stylesPath: "C:\\Users\\me\\project\\.github\\styles",
      rootIni: "C:\\Users\\me\\project/.vale.ini",
      baseStyles: LS_CONFIG.SBaseStyles,
    });
  });

  it("passes --config before ls-config, and falls back to the config files when RootINI is empty", async () => {
    const { spawn, calls } = stub({
      code: 0,
      stdout: JSON.stringify({ ...LS_CONFIG, RootINI: "", SBaseStyles: null }),
    });
    const resolved = await valeLsConfig({ cwd: "/work", config: "/work/.vale.ini" }, spawn);
    expect(calls[0]?.args).toEqual(["--config", "/work/.vale.ini", "ls-config"]);
    expect(resolved).toEqual({
      stylesPath: "C:\\Users\\me\\project\\.github\\styles",
      rootIni: "C:\\Users\\me\\project/.vale.ini",
      baseStyles: {},
    });
  });

  it("returns null when Vale finds no config file", async () => {
    const stderr = "E100 [.vale.ini not found] Runtime error\n\nno config file found\n\nExecution stopped with code 1.\n";
    await expect(valeLsConfig({ cwd: "/work" }, stub({ code: 2, stderr }).spawn)).resolves.toBeNull();
  });

  it("throws for any other failure, with Vale's stderr", async () => {
    const stderr = "E100 [--config] Runtime error\n\npath 'missing.ini' does not exist\n";
    const err = await termError(valeLsConfig({ cwd: "/work", config: "missing.ini" }, stub({ code: 2, stderr }).spawn));
    expect(err.message).toContain("path 'missing.ini' does not exist");
  });

  it("refuses output with no styles directory", async () => {
    const { spawn } = stub({ code: 0, stdout: JSON.stringify({ ...LS_CONFIG, Paths: [] }) });
    await expect(valeLsConfig({ cwd: "/work" }, spawn)).rejects.toThrow(TermError);
  });

  it("says Vale is not on PATH, and how to do without it, when the binary is missing", async () => {
    const err = await termError(valeLsConfig({ cwd: "/work" }, missing));
    expect(err.message).toBe("vale is not on PATH. Install Vale, or pass -o <styles directory>.");
  });
});

/**
 * A run a signal ended, which Vale itself never gets to describe.
 *
 * Node reports the exit code as `null` for a signal kill, so the seam has to
 * recognise that shape and say what ended the run. "exit code null" names
 * nothing a reader can act on, and the signal is the only account there is:
 * a killed Vale writes no message of its own.
 */
describe("a run a signal ended", () => {
  it("names the signal rather than reporting a null exit code", async () => {
    const { spawn } = stub({ code: null, signal: "SIGKILL" });
    const err = await termError(runValeJson(["a.md"], {}, spawn));
    expect(err.message).toContain("killed by SIGKILL");
    expect(err.message).not.toContain("null");
  });

  it("prefers what Vale said to the signal that ended it", async () => {
    // Vale got far enough to explain itself, so its own words are the better
    // message even though the run was then killed.
    const { spawn } = stub({
      code: null,
      signal: "SIGTERM",
      stderr: '{"Text":"config file not found"}',
    });
    const err = await termError(runValeJson(["a.md"], {}, spawn));
    expect(err.message).toContain("config file not found");
    expect(err.message).not.toContain("SIGTERM");
  });

  it("still reads ls-config's no-config case out of a killed run", async () => {
    // The `NO_CONFIG` test runs on `failureText`, so the signal wording must
    // not displace stderr that Vale did manage to write.
    const { spawn } = stub({
      code: null,
      signal: "SIGKILL",
      stderr: "no config file found",
    });
    await expect(valeLsConfig({ cwd: "." }, spawn)).resolves.toBeNull();
  });
});
