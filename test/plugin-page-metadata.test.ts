/**
 * The plugin's Read hook, `plugin/manni/hooks/page-metadata.mjs`: a read of a
 * collection page hands the agent the page's stored metadata once per
 * session, and again when it changes. Every other case is silent.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "plugin/manni/hooks/page-metadata.mjs");
const FIXTURE = join(ROOT, "test/fixtures/plugin-read");

const { isDocument } = (await import(pathToFileURL(SCRIPT).href)) as { isDocument: (path: string) => boolean };

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tempDir(prefix: string): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/** A copy of the fixture, with this checkout installed as its manni. */
function project(fixture = true): string {
  const dir = tempDir("manni-read-");
  if (fixture) cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(dir, "node_modules/@hawkeyexl"), { recursive: true });
  symlinkSync(ROOT, join(dir, "node_modules/@hawkeyexl/manni"), "junction");
  return dir;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the hook in `dir` with `envelope` on stdin and `markers` as its temp directory. */
function hook(dir: string, markers: string, envelope: object): Run {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    input: JSON.stringify(envelope),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: markers, TEMP: markers, TMP: markers },
  });
}

const read = (dir: string, file: string, extra: object = {}) => ({
  hook_event_name: "PostToolUse",
  session_id: "s1",
  tool_name: "Read",
  tool_input: { file_path: join(dir, file) },
  cwd: dir,
  ...extra,
});

/** The additionalContext of a reply. */
function context(run: Run): string {
  const reply = JSON.parse(run.stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(reply.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  return reply.hookSpecificOutput.additionalContext;
}

describe("plugin Read hook", () => {
  it("gives a page's metadata once, again when it changes, and per subagent", () => {
    const dir = project();
    const markers = tempDir("manni-markers-");

    const first = hook(dir, markers, read(dir, "docs/page.md"));
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    const given = context(first);
    expect(given.split("\n")[0]).toBe("Metadata for docs/page.md, from the page and its sidecars:");
    expect(JSON.parse(given.split("\n")[1] ?? "")).toEqual({ title: "A page", owner: "maya" });

    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");

    writeFileSync(join(dir, "docs/page.meta.yaml"), "docs/page.md:\n  owner: devin\n");
    const changed = context(hook(dir, markers, read(dir, "docs/page.md")));
    expect(changed).toMatch(/^Metadata for docs\/page\.md changed since it was last given here\. This replaces it:\n/);
    expect(changed).toContain('"owner":"devin"');

    const page = join(dir, "docs/page.md");
    writeFileSync(page, `${readFileSync(page, "utf8")}\nMore body.\n`);
    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");

    const subagent = context(hook(dir, markers, read(dir, "docs/page.md", { agent_id: "a1" })));
    expect(subagent).toMatch(/^Metadata for docs\/page\.md, from the page and its sidecars:/);
    expect(hook(dir, markers, read(dir, "docs/page.md", { agent_id: "a1" })).stdout).toBe("");
    // An envelope with no agent_id is the outermost session, which already has it.
    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");
  });

  it("forgets what the session was given after a compaction", () => {
    const dir = project();
    const markers = tempDir("manni-markers-");
    context(hook(dir, markers, read(dir, "docs/page.md")));
    const compact = hook(dir, markers, { hook_event_name: "SessionStart", source: "compact", session_id: "s1" });
    expect(compact).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toMatch(/from the page and its sidecars:/);
  });

  it("is silent for a page in no collection, and without a config", () => {
    const dir = project();
    const markers = tempDir("manni-markers-");
    expect(hook(dir, markers, read(dir, "notes/outside.md"))).toMatchObject({ status: 0, stdout: "", stderr: "" });

    const bare = project(false);
    mkdirSync(join(bare, "docs"));
    writeFileSync(join(bare, "docs/page.md"), "---\ntitle: A page\n---\n");
    expect(hook(bare, markers, read(bare, "docs/page.md"))).toMatchObject({ status: 0, stdout: "" });
  });

  it("is silent when get fails, and stores nothing", () => {
    const dir = project();
    const markers = tempDir("manni-markers-");
    const page = join(dir, "docs/page.md");
    const good = readFileSync(page, "utf8");
    writeFileSync(page, "---\ntitle: [unclosed\n---\n");
    expect(hook(dir, markers, read(dir, "docs/page.md"))).toMatchObject({ status: 0, stdout: "", stderr: "" });
    writeFileSync(page, good);
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toMatch(/from the page and its sidecars:/);
  });

  it("starts no manni for a file meta does not read", () => {
    // A stub manni that leaves a trace when it runs.
    const dir = tempDir("manni-read-");
    cpSync(FIXTURE, dir, { recursive: true });
    const stub = join(dir, "node_modules/@hawkeyexl/manni");
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "bin.js" } }));
    writeFileSync(join(stub, "bin.js"), `require("node:fs").writeFileSync(${JSON.stringify(join(dir, "ran"))}, "");`);
    const markers = tempDir("manni-markers-");
    expect(hook(dir, markers, read(dir, "src/x.ts"))).toMatchObject({ status: 0, stdout: "" });
    expect(existsSync(join(dir, "ran"))).toBe(false);
    // The tripwire works: a document does start it.
    hook(dir, markers, read(dir, "docs/page.md"));
    expect(existsSync(join(dir, "ran"))).toBe(true);
  });

  it("is silent for another event, another tool, and unreadable stdin", () => {
    const dir = project();
    const markers = tempDir("manni-markers-");
    expect(hook(dir, markers, read(dir, "docs/page.md", { tool_name: "Edit" })).stdout).toBe("");
    expect(hook(dir, markers, read(dir, "docs/page.md", { hook_event_name: "PreToolUse" })).stdout).toBe("");
    const garbage = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: "not json", encoding: "utf8" });
    expect(garbage).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("reads the extensions meta reads, in any case", () => {
    expect(isDocument("/p/docs/a.md")).toBe(true);
    expect(isDocument("C:\\p\\docs\\A.MDX")).toBe(true);
    expect(isDocument("/p/topic.dita")).toBe(true);
    expect(isDocument("/p/src/x.ts")).toBe(false);
    expect(isDocument("/p/README")).toBe(false);
  });
});
