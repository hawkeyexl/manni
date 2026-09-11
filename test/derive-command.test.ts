/**
 * The `command` source: a field derived by running whatever `derive.commands`
 * names, once per run or once per document when the argv carries `{path}`.
 *
 * Every command here is `node -e <script>`, so the process seam is exercised
 * for real — argv substitution, exit codes, stdout parsing, timeouts, a
 * program that is not on PATH — with no fake binary to maintain. A script
 * that must prove it ran (or did not) writes a marker file under the temp
 * directory.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATH_PLACEHOLDER,
  argvFor,
  deriveFromCommands,
  isPerFile,
  valueOf,
} from "../src/meta/core/derive/command.js";
import type { DeriveCommand, DeriveInput } from "../src/meta/core/derive/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";

// Every case here spawns node, and a Windows runner under load takes longer
// than vitest's 5 s default for a single spawn chain.
vi.setConfig({ testTimeout: 60_000 });

const NODE = process.execPath;

/** `node -e <script> [args...]`; inside the script the extra args start at `process.argv[1]`. */
function cmd(script: string, args: string[] = [], timeoutMs = 10_000): DeriveCommand {
  return { run: [NODE, "-e", script, ...args], timeoutMs };
}

function input(label: string): DeriveInput {
  const content = "---\ntitle: T\n---\n\nbody\n";
  return {
    label,
    absPath: join("C:", ...label.split("/")),
    content,
    extracted: markdownExtractor.extract(content, label),
  };
}

const A = input("docs/a.md");
const INPUTS = [A, input("docs/sub/b.md")];

const dirs: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-derive-command-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  // Best effort, because a killed command settles before the child has
  // finished dying, and on Windows it holds this directory as its cwd until
  // it does. The temp directory is the OS's to reap; a test asserts about
  // the source's answer, not about housekeeping.
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* the OS reaps it */
    }
  }
});

describe("valueOf", () => {
  it("trims, and an empty stdout is null", () => {
    expect(valueOf("")).toBeNull();
    expect(valueOf(" \n\t\n")).toBeNull();
    expect(valueOf("  v2.1 \n")).toBe("v2.1");
  });

  it("parses stdout that is structured JSON", () => {
    expect(valueOf('{"a":1,"b":[1,2]}\n')).toEqual({ a: 1, b: [1, 2] });
    expect(valueOf('["x","y"]')).toEqual(["x", "y"]);
    expect(valueOf('"quoted"')).toBe("quoted");
  });

  it("keeps a bare scalar as text, so a version is never renumbered", () => {
    // `1.10` read as JSON is the number 1.1, and stamping that into a
    // document changes which version the page claims to be verified against.
    expect(valueOf("1.10")).toBe("1.10");
    expect(valueOf("42")).toBe("42");
    expect(valueOf("true")).toBe("true");
    expect(valueOf("0012")).toBe("0012");
  });

  it("keeps stdout that is not JSON as the trimmed string", () => {
    expect(valueOf("2026-01-10\n")).toBe("2026-01-10");
    expect(valueOf("{not json")).toBe("{not json");
  });
});

describe("isPerFile / argvFor", () => {
  it("is per file when any argv element carries {path}", () => {
    expect(PATH_PLACEHOLDER).toBe("{path}");
    expect(isPerFile({ run: ["tool", "--version"], timeoutMs: 1 })).toBe(false);
    expect(isPerFile({ run: ["tool", "{path}"], timeoutMs: 1 })).toBe(true);
    expect(isPerFile({ run: ["tool", "--file={path}"], timeoutMs: 1 })).toBe(true);
  });

  it("substitutes every {path} occurrence with the label", () => {
    const command: DeriveCommand = { run: ["tool", "{path}", "--copy", "{path}.bak", "x"], timeoutMs: 1 };
    expect(argvFor(command, "docs/a.md")).toEqual(["tool", "docs/a.md", "--copy", "docs/a.md.bak", "x"]);
    expect(argvFor({ run: ["tool", "{path}{path}"], timeoutMs: 1 }, "p")).toEqual(["tool", "pp"]);
    expect(argvFor({ run: ["tool"], timeoutMs: 1 }, "p")).toEqual(["tool"]);
  });
});

describe("deriveFromCommands", () => {
  it("runs a command without {path} once and copies its value into every record", async () => {
    const dir = tempDir();
    const marker = join(dir, "ran");
    const command = cmd(
      'require("fs").appendFileSync(process.argv[1], "x"); process.stdout.write("v2.1\\n")',
      [marker],
    );
    const result = await deriveFromCommands(INPUTS, { "verified-against": command }, { cwd: dir });
    expect(result.status).toEqual({ available: true });
    expect([...result.records.keys()]).toEqual(["docs/a.md", "docs/sub/b.md"]);
    const evidence = command.run.join(" ");
    expect(result.records.get("docs/a.md")).toEqual({
      "verified-against": { value: "v2.1", source: "command", evidence },
    });
    expect(result.records.get("docs/sub/b.md")).toEqual({
      "verified-against": { value: "v2.1", source: "command", evidence },
    });
    // One spawn, however many inputs.
    expect(readFileSync(marker, "utf8")).toBe("x");
  });

  it("runs a command with {path} once per input, with that input's label", async () => {
    const command = cmd("process.stdout.write(process.argv[1])", ["{path}"]);
    const result = await deriveFromCommands(INPUTS, { where: command }, { cwd: tempDir() });
    expect(result.status).toEqual({ available: true });
    expect(result.records.get("docs/a.md")?.where).toEqual({
      value: "docs/a.md",
      source: "command",
      evidence: `${NODE} -e process.stdout.write(process.argv[1]) docs/a.md`,
    });
    expect(result.records.get("docs/sub/b.md")?.where).toMatchObject({
      value: "docs/sub/b.md",
      evidence: `${NODE} -e process.stdout.write(process.argv[1]) docs/sub/b.md`,
    });
  });

  it("parses JSON stdout into an object or a list", async () => {
    const result = await deriveFromCommands(
      [A],
      {
        obj: cmd('console.log(JSON.stringify({ tag: "v2", n: 3 }))'),
        list: cmd('console.log(JSON.stringify(["a", "b"]))'),
      },
      { cwd: tempDir() },
    );
    expect(result.status).toEqual({ available: true });
    const rec = result.records.get("docs/a.md");
    expect(rec?.obj?.value).toEqual({ tag: "v2", n: 3 });
    expect(rec?.list?.value).toEqual(["a", "b"]);
  });

  it("keeps plain stdout as a trimmed string, and an empty stdout as null", async () => {
    const result = await deriveFromCommands(
      [A],
      {
        plain: cmd('process.stdout.write("  2026-01-10 \\n\\n")'),
        empty: cmd('process.stdout.write("\\n")'),
      },
      { cwd: tempDir() },
    );
    expect(result.status).toEqual({ available: true });
    const rec = result.records.get("docs/a.md");
    expect(rec?.plain?.value).toBe("2026-01-10");
    expect(rec?.empty).toBeNull();
  });

  it("runs in the configured cwd", async () => {
    const dir = tempDir();
    const result = await deriveFromCommands(
      [A],
      { here: cmd("process.stdout.write(require('fs').realpathSync(process.cwd()))") },
      { cwd: dir },
    );
    expect(result.records.get("docs/a.md")?.here?.value).toBe(dir);
  });

  it("is unavailable on a non-zero exit, naming the exit code, the last stderr line and the field", async () => {
    const command = cmd('process.stderr.write("warming up\\nboom: no such tag\\n"); process.exit(3)');
    const result = await deriveFromCommands(INPUTS, { "verified-against": command }, { cwd: tempDir() });
    expect(result.status).toEqual({
      available: false,
      reason: `\`${command.run.join(" ")}\` failed (exit 3): boom: no such tag (derive.commands.verified-against)`,
    });
    expect(result.records.size).toBe(0);
  });

  it("says so when the failing command wrote nothing to stderr", async () => {
    const command = cmd("process.exit(1)");
    const result = await deriveFromCommands(INPUTS, { tag: command }, { cwd: tempDir() });
    expect(result.status.reason).toBe(
      `\`${command.run.join(" ")}\` failed (exit 1): no output on stderr (derive.commands.tag)`,
    );
  });

  it("is unavailable when the program is not on PATH", async () => {
    const result = await deriveFromCommands(
      INPUTS,
      { tag: { run: ["definitely-not-a-program-xyz", "--version"], timeoutMs: 5000 } },
      { cwd: tempDir() },
    );
    expect(result.status).toEqual({
      available: false,
      reason: "`definitely-not-a-program-xyz` is not on PATH (derive.commands.tag)",
    });
  });

  it("is unavailable when the command times out", async () => {
    const command = cmd("setTimeout(() => {}, 10000)", [], 200);
    const result = await deriveFromCommands(INPUTS, { slow: command }, { cwd: tempDir() });
    expect(result.status).toEqual({
      available: false,
      reason: `\`${command.run.join(" ")}\` timed out after 0.2s (derive.commands.slow)`,
    });
  });

  it("is unavailable when the command floods stdout, and does not wait for it", async () => {
    // A program writing far more than a field's value would otherwise be read
    // into memory until the run died; the cap kills it and names the field.
    //
    // The writes yield to the child's own event loop, and stop at 12 MiB. A
    // tight `for(;;) process.stdout.write(...)` never yields, so once the pipe
    // fills the child buffers every chunk in its own heap and dies of that
    // first — on Linux and macOS the parent then saw a signal, not the cap,
    // and the case passed only on Windows for the wrong reason.
    const command = cmd(
      "const s='x'.repeat(1024*1024);let n=0;" +
        "const w=()=>{if(n++<12){process.stdout.write(s);setImmediate(w);}};w();",
      [],
      60_000,
    );
    const result = await deriveFromCommands(INPUTS, { flood: command }, { cwd: tempDir() });
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("MiB; a command reports one field's value");
    expect(result.status.reason).toContain("(derive.commands.flood)");
  });

  it("returns from a timeout even when the child ignores SIGTERM", async () => {
    // `close` waits for the stdio streams as well as the exit, so a child
    // that traps the signal would hang the run past its own timeout.
    const command = cmd(
      "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000);",
      [],
      300,
    );
    const started = Date.now();
    const result = await deriveFromCommands(INPUTS, { stubborn: command }, { cwd: tempDir() });
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("timed out after 0.3s");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("stops at the first failure and spawns nothing after it", async () => {
    const dir = tempDir();
    const marker = join(dir, "second-ran");
    const result = await deriveFromCommands(
      INPUTS,
      {
        first: cmd("process.exit(3)"),
        second: cmd('require("fs").writeFileSync(process.argv[1], "x")', [marker, "{path}"]),
      },
      { cwd: dir },
    );
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("(derive.commands.first)");
    expect(existsSync(marker)).toBe(false);
  });

  it("stops a per-file command at the first input that fails", async () => {
    const dir = tempDir();
    // Fails for the first label, writes a marker for any other.
    const script =
      'if (process.argv[2] === "docs/a.md") process.exit(2); require("fs").writeFileSync(process.argv[1], process.argv[2])';
    const result = await deriveFromCommands(
      INPUTS,
      { per: cmd(script, [join(dir, "ran"), "{path}"]) },
      { cwd: dir },
    );
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("docs/a.md");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("is available with empty records when there is nothing to run or nothing to run it on", async () => {
    const none = await deriveFromCommands(INPUTS, {}, { cwd: tempDir() });
    expect(none).toEqual({ status: { available: true }, records: new Map() });
    const noInputs = await deriveFromCommands([], { tag: cmd("process.exit(9)") }, { cwd: tempDir() });
    expect(noInputs).toEqual({ status: { available: true }, records: new Map() });
  });
});
