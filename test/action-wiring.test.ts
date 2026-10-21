/**
 * The Action's input→argv wiring.
 *
 * This is the only part of `action.yml` nothing else can check. Whether manni
 * exits 1 on a bad file is already covered by the CLI's own integration tests
 * and by `action-smoke.yml` on a real runner. What no other test can see is
 * whether `command:` lands as argv words, whether `paths:` lands as a
 * positional, whether a two-line `schema:` becomes two `-s` flags, whether
 * `args:` survives verbatim, and where stdout and stdin go.
 *
 * The script under test is extracted from `action.yml` itself rather than
 * copied, so the test cannot pass against a version of the wiring that is no
 * longer shipped.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { bash, hasBash } from "./helpers/bash.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The `run:` block of the composite step with `id: manni`, as a runnable
 * script.
 *
 * Located by parsing the YAML and matching the step's `id`, not by scanning
 * for the first `run: |` in the file. A textual scan is correct only while
 * `action.yml` has exactly one such block; insert a cache-warm or setup step
 * above the manni one and every test below would quietly assert against the
 * wrong shell code. Parsing costs nothing and cannot pick the wrong step.
 */
function actionScript(): string {
  const doc = parseYaml(readFileSync(join(repoRoot, "action.yml"), "utf8")) as {
    runs?: { steps?: Array<{ id?: string; run?: string }> };
  };
  const step = doc.runs?.steps?.find((s) => s.id === "manni");
  if (step?.run === undefined) {
    throw new Error("action.yml has no step with `id: manni` and a `run:`");
  }
  return step.run;
}

interface RunResult {
  /** Each argument the stub `npx` received, boundaries intact. */
  args: string[];
  /** Whether the stub ran to the end (it may be unreachable under errexit). */
  reached: boolean;
  /** The same arguments space-joined, for assertions that do not care. */
  argv: string;
  /** What the stub read from its stdin, or null when it never got that far. */
  stdin: string | null;
  /** Everything the script appended to `$GITHUB_OUTPUT`. */
  githubOutput: string;
  /** The script's stdout, including the logged invocation line. */
  stdout: string;
  /** The script's stderr, where workflow-command warnings go. */
  stderr: string;
  /** The script's own exit status. */
  status: number;
  /** The temp directory the script ran in, which is also its working directory. */
  dir: string;
}

/**
 * Run the action's script with a stub `npx` that records the argv it received
 * and exits with `npxExit`.
 *
 * Invoked the way the runner invokes it, flags and all. That is not pedantry:
 * `-e` is precisely what a plain `bash run.sh` was missing. Under errexit the
 * script's `code=$?` line is unreachable, so a failing manni aborted before
 * anything reached `$GITHUB_OUTPUT`, and a harness without `-e` called that
 * green while the real runner failed on it.
 *
 * The stub writes what it saw to a log file rather than to its stdout, because
 * `output-file` redirects that stdout away from the script's. It prints
 * `REPORT` to stdout and `DIAG` to stderr, so a test can tell where each
 * stream went. `STUB_SILENT=1` makes it print nothing to stdout.
 *
 * The harness holds the script's stdin open and never writes to it. That is
 * the runner's silent pipe, the one `manni check` would wait on for a hook
 * envelope. The stub reads its stdin to EOF, so a script that forgets the
 * `/dev/null` redirect hangs the stub until the harness kills it.
 */
async function runAction(env: Record<string, string>, npxExit = 0): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "manni-action-"));
  mkdirSync(join(dir, "bin"));
  const stub = join(dir, "bin", "npx");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      // One line per argument, not `$*`. Joining on a space destroys the
      // boundaries (`a b` and `a`,`b` print identically), and the boundaries
      // are the whole subject here. Two tests passed against a script that
      // split them wrongly before this changed.
      'for a in "$@"; do echo "ARG:$a" >> "$STUB_LOG"; done',
      'printf "STDIN:%s\\n" "$(cat)" >> "$STUB_LOG"',
      'echo END >> "$STUB_LOG"',
      '[ "${STUB_SILENT:-}" = 1 ] || echo REPORT',
      "echo DIAG >&2",
      `exit ${String(npxExit)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(stub, 0o755);
  writeFileSync(join(dir, "run.sh"), actionScript(), "utf8");
  const outFile = join(dir, "out");
  const log = join(dir, "stub.log");

  const child = spawn(bash, ["--noprofile", "--norc", "-eo", "pipefail", "run.sh"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: "out",
      STUB_LOG: "stub.log",
      MANNI_COMMAND: "",
      MANNI_PATHS: "",
      MANNI_SCHEMA: "",
      MANNI_CONFIG: "",
      MANNI_FORMAT: "",
      MANNI_OUTPUT_FILE: "",
      MANNI_VERSION: "latest",
      MANNI_ARGS: "",
      ...env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  // Under vitest's 5 s test timeout. A killed run counts as never reaching the
  // stub's end, because the stub can still finish once its stdin is destroyed.
  const killer = setTimeout(() => child.kill(), 3000);
  const status = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? -1);
    });
  });
  clearTimeout(killer);
  child.stdin.destroy();

  const lines = !child.killed && existsSync(log) ? readFileSync(log, "utf8").split("\n") : [];
  const args = lines.filter((l) => l.startsWith("ARG:")).map((l) => l.slice("ARG:".length));
  const stdinLine = lines.find((l) => l.startsWith("STDIN:"));
  return {
    args,
    reached: lines.includes("END"),
    argv: args.join(" "),
    stdin: stdinLine === undefined ? null : stdinLine.slice("STDIN:".length),
    githubOutput: existsSync(outFile) ? readFileSync(outFile, "utf8") : "",
    stdout,
    stderr,
    status,
    dir,
  };
}

/** Run the action's script and return the arguments the stub `npx` saw. */
async function argsFor(env: Record<string, string>): Promise<string[]> {
  const { args, reached, status } = await runAction(env);
  if (!reached) throw new Error(`npx was never reached (exit ${String(status)})`);
  return args;
}

/** Run the action's script and return just the argv the stub `npx` saw. */
async function argvFor(env: Record<string, string>): Promise<string> {
  return (await argsFor(env)).join(" ");
}

/** The argv before manni's own words. */
const NPX = ["--yes", "@hawkeyexl/manni@latest"];
/** The command every case ran before `command:` existed, now spelled out. */
const META = { MANNI_COMMAND: "meta validate" };

describe.skipIf(!hasBash)("action.yml command input", () => {
  it("runs check when command is unset", async () => {
    expect(await argsFor({})).toEqual([...NPX, "check"]);
  });

  it("runs check when command is empty, with format appended", async () => {
    expect(await argsFor({ MANNI_COMMAND: "", MANNI_FORMAT: "github" })).toEqual([
      ...NPX,
      "check",
      "--format",
      "github",
    ]);
  });

  it("runs the command it is given", async () => {
    expect(await argsFor({ MANNI_COMMAND: "cite check", MANNI_PATHS: "docs/" })).toEqual([
      ...NPX,
      "cite",
      "check",
      "docs/",
    ]);
  });

  it("splits the command on any run of whitespace", async () => {
    expect(await argsFor({ MANNI_COMMAND: "  lint   structure " })).toEqual([
      ...NPX,
      "lint",
      "structure",
    ]);
  });

  it("never shell-evaluates the command", async () => {
    // `$(…)` and `;` would run something if the value went through a shell.
    // Word-splitting alone hands them to manni as literal words, and manni
    // rejects them as an unknown command.
    const res = await runAction({ MANNI_COMMAND: "check $(touch pwned) ; touch pwned2" });
    expect(res.args).toEqual([...NPX, "check", "$(touch", "pwned)", ";", "touch", "pwned2"]);
    expect(existsSync(join(res.dir, "pwned"))).toBe(false);
    expect(existsSync(join(res.dir, "pwned2"))).toBe(false);
  });

  it("does not glob-expand the command", async () => {
    const res = await runAction({ MANNI_COMMAND: "*" });
    expect(res.args).toEqual([...NPX, "*"]);
  });

  it("passes schema to any command, and lets the CLI judge it", async () => {
    const res = await runAction({ MANNI_COMMAND: "check", MANNI_SCHEMA: "./page.schema.json" });
    expect(res.args).toEqual([...NPX, "check", "-s", "./page.schema.json"]);
    expect(res.stdout).not.toContain("::error::");
    expect(res.stderr).not.toContain("::error::");
  });

  it("omits --format when format is empty", async () => {
    const args = await argsFor({ MANNI_COMMAND: "site build", MANNI_FORMAT: "" });
    expect(args).toEqual([...NPX, "site", "build"]);
  });

  it("passes format as --format", async () => {
    expect(await argsFor({ MANNI_FORMAT: "sarif" })).toEqual([...NPX, "check", "--format", "sarif"]);
  });

  it("runs manni with stdin from /dev/null, not the runner's pipe", async () => {
    // The harness holds a silent pipe open. Without the redirect the stub's
    // `cat` waits on it, and so would `manni check` reading for a hook envelope.
    const res = await runAction({});
    expect(res.reached).toBe(true);
    expect(res.stdin).toBe("");
  });

  it("logs the command words before the run", async () => {
    const res = await runAction({ MANNI_FORMAT: "github" });
    expect(res.stdout).toContain("manni check --format github\n");
  });

  it("logs a quoted path the way it reaches manni", async () => {
    const res = await runAction({ ...META, MANNI_PATHS: "docs/\nguides/my notes/" });
    expect(res.stdout).toContain("manni meta validate docs/ guides/my\\ notes/\n");
  });
});

describe.skipIf(!hasBash)("action.yml output-file input", () => {
  it("sends stdout to the file and leaves stderr in the log", async () => {
    const res = await runAction({ MANNI_FORMAT: "sarif", MANNI_OUTPUT_FILE: "manni.sarif" });
    expect(readFileSync(join(res.dir, "manni.sarif"), "utf8")).toBe("REPORT\n");
    expect(res.stdout).not.toContain("REPORT");
    expect(res.stderr).toContain("DIAG");
  });

  it("creates a missing directory for the file", async () => {
    const res = await runAction({ MANNI_FORMAT: "sarif", MANNI_OUTPUT_FILE: "reports/ci/manni.sarif" });
    expect(readFileSync(join(res.dir, "reports", "ci", "manni.sarif"), "utf8")).toBe("REPORT\n");
  });

  it("removes the file when manni wrote nothing to it", async () => {
    const res = await runAction(
      { MANNI_FORMAT: "sarif", MANNI_OUTPUT_FILE: "manni.sarif", STUB_SILENT: "1" },
      2,
    );
    expect(existsSync(join(res.dir, "manni.sarif"))).toBe(false);
    expect(res.githubOutput).toContain("exit-code=2");
    expect(res.status).toBe(2);
  });

  it("logs the redirect after the command words", async () => {
    const res = await runAction({
      MANNI_COMMAND: "cite check",
      MANNI_PATHS: "docs/",
      MANNI_FORMAT: "sarif",
      MANNI_OUTPUT_FILE: "cite.sarif",
    });
    expect(res.stdout).toContain("manni cite check docs/ --format sarif > cite.sarif\n");
  });

  it("warns that the github format writes no annotations to a file, and runs", async () => {
    const res = await runAction({ MANNI_FORMAT: "github", MANNI_OUTPUT_FILE: "out.txt" });
    expect(res.stderr).toContain(
      "::warning::output-file sends the github format's workflow commands to out.txt, so no annotations appear. Pick another format to write a file.",
    );
    expect(res.reached).toBe(true);
    expect(readFileSync(join(res.dir, "out.txt"), "utf8")).toBe("REPORT\n");
  });

  it("does not warn for another format", async () => {
    const res = await runAction({ MANNI_FORMAT: "json", MANNI_OUTPUT_FILE: "manni.json" });
    expect(res.stderr).not.toContain("::warning::");
  });

  it("writes stdout to the log when unset", async () => {
    const res = await runAction({});
    expect(res.stdout).toContain("REPORT");
  });
});

describe.skipIf(!hasBash)("action.yml input wiring", () => {
  it("runs the same argv as before command existed, for meta validate", async () => {
    // The pre-`command:` Action ran exactly this for these inputs.
    // `command: meta validate` is how a consumer restores it, so it has to match.
    expect(
      await argsFor({
        ...META,
        MANNI_PATHS: "docs/**/*.md",
        MANNI_SCHEMA: "./schemas/page.schema.json",
        MANNI_FORMAT: "github",
      }),
    ).toEqual([
      ...NPX,
      "meta",
      "validate",
      "docs/**/*.md",
      "-s",
      "./schemas/page.schema.json",
      "--format",
      "github",
    ]);
  });

  it("passes a glob through literally, without shell expansion", async () => {
    // The first version of this action expanded it. Bash word-splitting also
    // globs, so `docs/**/*.md` arrived as several hundred resolved paths: the
    // runner's view of the tree substituted for manni's own expansion, which
    // applies extension filtering and gitignore rules the shell knows nothing
    // about. Caught here, not by review.
    const argv = await argvFor({ ...META, MANNI_PATHS: "docs/**/*.md" });
    expect(argv).toContain("validate docs/**/*.md");
    expect(argv).not.toContain(".mdx");
  });

  it("still splits several paths on whitespace", async () => {
    // `set -f` must disable globbing without disabling word-splitting.
    expect(await argvFor({ ...META, MANNI_PATHS: "docs/ README.md" })).toContain(
      "validate docs/ README.md",
    );
  });

  it("expands a multi-line schema input into one -s per ref", async () => {
    const argv = await argvFor({ ...META, MANNI_SCHEMA: "google:okf:0.1\n./local.schema.json" });
    expect(argv).toContain("-s google:okf:0.1");
    expect(argv).toContain("-s ./local.schema.json");
  });

  it("ignores blank lines in the schema input", async () => {
    // A YAML block scalar routinely ends with a trailing newline; turning that
    // into a bare `-s` would make manni fail on an empty ref.
    const argv = await argvFor({ ...META, MANNI_SCHEMA: "google:okf:0.1\n\n" });
    expect(argv.match(/-s/g) ?? []).toHaveLength(1);
  });

  it("maps config and format to their flags", async () => {
    const argv = await argvFor({
      ...META,
      MANNI_CONFIG: "manni.config.yaml",
      MANNI_FORMAT: "sarif",
    });
    expect(argv).toContain("-c manni.config.yaml");
    expect(argv).toContain("--format sarif");
  });

  it("appends args verbatim, last", async () => {
    const argv = await argvFor({
      ...META,
      MANNI_PATHS: "docs/",
      MANNI_ARGS: "--allow-empty --no-gitignore",
    });
    expect(argv.endsWith("--allow-empty --no-gitignore")).toBe(true);
  });

  it("honours the version input, so the smoke test can point at a local build", async () => {
    expect(await argvFor({ MANNI_VERSION: "./hawkeyexl-manni-1.0.0.tgz" })).toContain(
      "@hawkeyexl/manni@./hawkeyexl-manni-1.0.0.tgz",
    );
  });

  it("omits every flag whose input is empty", async () => {
    // The failure this prevents: `-c ""` or `--format ""`, which the CLI
    // rejects with exit 2. That is an action that breaks when an optional
    // input is simply not set.
    const args = await argsFor({ ...META, MANNI_PATHS: "docs/" });
    expect(args).toEqual([...NPX, "meta", "validate", "docs/"]);
  });

  // The `exit-code` output is the whole reason `continue-on-error: true` is
  // usable with this action, and the failing case is the only one anybody
  // reaches for it. Under the runner's `bash -e`, the script's `code=$?` line
  // is unreachable once manni exits non-zero, so this asserted nothing at
  // all until the harness above started passing `-e`.
  it("reports a non-zero manni exit through the exit-code output", async () => {
    const res = await runAction({ MANNI_PATHS: "docs/" }, 1);
    expect(res.githubOutput).toContain("exit-code=1");
    expect(res.status).toBe(1);
  });

  it("reports a usage error as exit-code 2", async () => {
    const res = await runAction({ MANNI_COMMAND: "lint chek" }, 2);
    expect(res.githubOutput).toContain("exit-code=2");
    expect(res.status).toBe(2);
  });

  it("reports a clean run as exit-code 0", async () => {
    const res = await runAction({ MANNI_PATHS: "docs/" }, 0);
    expect(res.githubOutput).toContain("exit-code=0");
    expect(res.status).toBe(0);
  });

  it("takes a newline-separated paths input one path per line", async () => {
    // Word-splitting cannot express a path containing a space at all, and
    // `schema` already uses lines for exactly that reason. Without this,
    // `docs/my notes/*.md` silently becomes `docs/my` and `notes/*.md`: two
    // paths the consumer never named, neither of which exists.
    const args = await argsFor({ ...META, MANNI_PATHS: "docs/my notes/*.md\nREADME.md" });
    expect(args).toEqual([...NPX, "meta", "validate", "docs/my notes/*.md", "README.md"]);
  });

  it("takes a newline-separated args input one argument per line", async () => {
    const args = await argsFor({
      ...META,
      MANNI_PATHS: "docs/",
      MANNI_ARGS: "--exclude\n*.draft.md",
    });
    expect(args.slice(-2)).toEqual(["--exclude", "*.draft.md"]);
  });

  it("warns when a single-line input carries shell quotes", async () => {
    // The silent failure this replaces, measured against the real CLI:
    // `--exclude '**/recipes.mdx'` reports "4 files checked";
    // `--exclude '"**/recipes.mdx"'` reports "5 files checked". manni
    // accepts the quoted value, excludes nothing, and exits 0. Nothing can
    // recover the intent at this layer, so the least it can do is say so.
    const res = await runAction({
      ...META,
      MANNI_PATHS: "docs/",
      MANNI_ARGS: '--exclude "*.draft.md"',
    });
    expect(res.stderr).toContain("::warning::");
    expect(res.stderr).toContain("args contains a quote character");
  });

  it("does not warn on an unquoted input", async () => {
    const res = await runAction({
      ...META,
      MANNI_PATHS: "docs/",
      MANNI_ARGS: "--exclude *.draft.md",
    });
    expect(res.stderr).not.toContain("::warning::");
  });

  it("logs no phantom argument when argv is empty", async () => {
    // A consumer relying entirely on the config, with `format: ""`, reaches
    // npx with the command words alone. `printf ' %q'` on an empty array
    // prints `''`, which reads as an empty positional argument being passed,
    // and this line exists to tell them what actually ran.
    const res = await runAction(META);
    expect(res.stdout).toContain("manni meta validate\n");
    expect(res.stdout).not.toContain("validate ''");
  });
});

describe("action.yml inputs", () => {
  const doc = parseYaml(readFileSync(join(repoRoot, "action.yml"), "utf8")) as {
    description?: unknown;
    inputs?: Record<string, { default?: unknown } | undefined>;
  };

  it("defaults version to latest", () => {
    // A major pinned here goes stale at the next major release, and nobody
    // bumps it by hand: it sat at `"0"` through 1.0.0 and 2.0.0, so every
    // consumer on the default ran the 0.x CLI. `latest` cannot go stale.
    expect(doc.inputs?.version?.default).toBe("latest");
  });

  it("declares nine inputs, command defaulting to check and output-file to nothing", () => {
    expect(Object.keys(doc.inputs ?? {}).sort()).toEqual(
      ["args", "command", "config", "format", "node-version", "output-file", "paths", "schema", "version"],
    );
    expect(doc.inputs?.command?.default).toBe("check");
    expect(doc.inputs?.["output-file"]?.default).toBeUndefined();
    expect(doc.inputs?.format?.default).toBe("github");
  });

  it("describes itself as the family gate", () => {
    expect(doc.description).toBe(
      "Run manni in CI: every check a repository has set up, or any one manni command",
    );
  });
});
