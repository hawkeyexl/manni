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
const RECORDS = join(ROOT, "test/fixtures/get-records");

const { isDocument, KEY_FIELDS, LIMIT } = (await import(pathToFileURL(SCRIPT).href)) as {
  isDocument: (path: string) => boolean;
  KEY_FIELDS: string[];
  LIMIT: number;
};

/** 0103's reply: its lead, then the stored fields as JSON, in page order. */
const FIRST = (file: string, values: object): string =>
  `Metadata for ${file}, from the page and its sidecars:\n${JSON.stringify(values)}`;
const CHANGED = (file: string, values: object): string =>
  `Metadata for ${file} changed since it was last given here. This replaces it:\n${JSON.stringify(values)}`;
const REFERENCES_LEAD =
  "The page names these records. Read a record's file for its details, or run manni strategy get <id>, which also lists the pages that name it:";

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

/** A copy of a fixture, `plugin-read` by default, with this checkout installed as its manni. */
function project(fixture: string | false = FIXTURE): string {
  const dir = tempDir("manni-read-");
  if (fixture !== false) cpSync(fixture, dir, { recursive: true });
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
    // The fixture names no record, so the reply is 0103's, byte for byte.
    expect(given).toBe(FIRST("docs/page.md", { title: "A page", owner: "maya" }));

    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");

    writeFileSync(join(dir, "docs/page.meta.yaml"), "docs/page.md:\n  owner: devin\n");
    const changed = context(hook(dir, markers, read(dir, "docs/page.md")));
    expect(changed).toMatch(/^Metadata for docs\/page\.md changed since it was last given here\. This replaces it:\n/);
    expect(changed).toContain('"owner":"devin"');
    expect(changed).toBe(CHANGED("docs/page.md", { title: "A page", owner: "devin" }));

    const page = join(dir, "docs/page.md");
    writeFileSync(page, `${readFileSync(page, "utf8")}\nMore body.\n`);
    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");

    const subagent = context(hook(dir, markers, read(dir, "docs/page.md", { agent_id: "a1" })));
    expect(subagent).toMatch(/^Metadata for docs\/page\.md, from the page and its sidecars:/);
    expect(subagent).toBe(FIRST("docs/page.md", { title: "A page", owner: "devin" }));
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
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toBe(
      FIRST("docs/page.md", { title: "A page", owner: "maya" }),
    );
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
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toBe(
      FIRST("docs/page.md", { title: "A page", owner: "maya" }),
    );
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

describe("plugin Read hook: a page that names records", () => {
  const PAGE_VALUES = {
    title: "A page",
    description: "A page that names its readers.",
    lifecycle: "published",
    audiences: ["docs-engineers"],
    owner: "maya",
    personas: ["Maya"],
    journeys: ["m1", "m9"],
  };
  const REFERENCES = [
    "audience docs-engineers strategy/audiences/docs-engineers.md",
    "persona maya strategy/personas/maya.md",
    "journey m1 strategy/journeys/m1.md",
  ];
  const isKey = (field: string): boolean => KEY_FIELDS.includes(field);

  /** Every key field before every other field. */
  function keyFirst(keys: string[]): void {
    const firstOther = keys.findIndex((k) => !isKey(k));
    if (firstOther !== -1) expect(keys.slice(firstOther).filter(isKey)).toEqual([]);
  }

  it("gives key fields first, then a reference per record, with no closing line", () => {
    const dir = project(RECORDS);
    const markers = tempDir("manni-markers-");
    const given = context(hook(dir, markers, read(dir, "docs/page.md")));
    const lines = given.split("\n");
    expect(lines[0]).toBe("Metadata for docs/page.md, from the page and its sidecars:");
    const json = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
    expect(json).toEqual(PAGE_VALUES);
    keyFirst(Object.keys(json));
    expect(lines[2]).toBe(REFERENCES_LEAD);
    expect(lines.slice(3)).toEqual(REFERENCES);
    expect(given).not.toMatch(/Maya, docs engineer|trigger|Set up the docs|This leaves out/);

    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");
    // A record edit changes no reference, so the page is not given again.
    const m1 = join(dir, "strategy/journeys/m1.md");
    writeFileSync(m1, readFileSync(m1, "utf8").replace("Set up the docs", "Stand up the docs"));
    expect(hook(dir, markers, read(dir, "docs/page.md")).stdout).toBe("");

    // The record's own read gives its fields and its own references.
    const record = context(hook(dir, markers, read(dir, "strategy/journeys/m1.md"))).split("\n");
    expect(JSON.parse(record[1] ?? "")).toMatchObject({ title: "Stand up the docs", trigger: "A new repository." });
    expect(record.slice(2)).toEqual([REFERENCES_LEAD, "persona maya strategy/personas/maya.md"]);

    // A subagent has a context of its own, and a compaction forgets.
    expect(context(hook(dir, markers, read(dir, "docs/page.md", { agent_id: "a1" })))).toBe(given);
    hook(dir, markers, { hook_event_name: "SessionStart", source: "compact", session_id: "s1" });
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toBe(given);
  });

  it("leaves out the largest non-key fields to stay under LIMIT, and says how to print them", () => {
    const dir = project(RECORDS);
    const markers = tempDir("manni-markers-");
    const page = join(dir, "docs/page.md");
    const big = "x".repeat(LIMIT - 100);
    writeFileSync(page, readFileSync(page, "utf8").replace("owner: maya\n", `owner: maya\nnotes: ${big}\nextra: ${big}\n`));
    const given = context(hook(dir, markers, read(dir, "docs/page.md")));
    expect(given.length).toBeLessThanOrEqual(LIMIT);
    const lines = given.split("\n");
    const json = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
    for (const field of Object.keys(PAGE_VALUES)) expect(json).toHaveProperty([field]);
    expect(json).not.toHaveProperty("notes");
    expect(json).not.toHaveProperty("extra");
    keyFirst(Object.keys(json));
    expect(lines.slice(2, -1)).toEqual([REFERENCES_LEAD, ...REFERENCES]);
    expect(lines.at(-1)).toBe(
      "This leaves out notes and extra to stay under Claude Code's limit of 10,000 characters. manni meta get notes,extra --no-derived docs/page.md prints them.",
    );

    // One big field: only it leaves, and a tie goes to the later field.
    writeFileSync(page, readFileSync(page, "utf8").replace(`extra: ${big}\n`, ""));
    const one = context(hook(dir, tempDir("manni-markers-"), read(dir, "docs/page.md")));
    expect(one.length).toBeLessThanOrEqual(LIMIT);
    expect(one.split("\n").at(-1)).toBe(
      "This leaves out notes to stay under Claude Code's limit of 10,000 characters. manni meta get notes --no-derived docs/page.md prints them.",
    );
  });

  it("gives 0103's reply when an older manni prints no records", () => {
    const dir = tempDir("manni-read-");
    cpSync(RECORDS, dir, { recursive: true });
    const stub = join(dir, "node_modules/@hawkeyexl/manni");
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "bin.js" } }));
    const entry = [{ file: "docs/page.md", present: true, collections: ["pages"], values: PAGE_VALUES }];
    writeFileSync(join(stub, "bin.js"), `process.stdout.write(${JSON.stringify(JSON.stringify(entry))});`);
    const given = context(hook(dir, tempDir("manni-markers-"), read(dir, "docs/page.md")));
    expect(given).toBe(FIRST("docs/page.md", PAGE_VALUES));
  });

  it("gives 0103's reply, over the cap included, for a page that names no record", () => {
    const dir = project(RECORDS);
    const markers = tempDir("manni-markers-");
    const notes = "x".repeat(LIMIT + 1);
    writeFileSync(join(dir, "docs/plain.md"), `---\ntitle: A plain page\nnotes: ${notes}\n---\n`);
    const given = context(hook(dir, markers, read(dir, "docs/plain.md")));
    expect(given).toBe(FIRST("docs/plain.md", { title: "A plain page", notes }));
    expect(given.length).toBeGreaterThan(LIMIT);

    expect(hook(dir, markers, read(dir, "notes/outside.md"))).toMatchObject({ status: 0, stdout: "", stderr: "" });

    writeFileSync(join(dir, "docs/page.meta.yaml"), "docs/page.md:\n  journeys: [m9]\n");
    writeFileSync(join(dir, "docs/page.md"), "---\ntitle: A page\n---\n");
    expect(context(hook(dir, markers, read(dir, "docs/page.md")))).toBe(
      FIRST("docs/page.md", { title: "A page", journeys: ["m9"] }),
    );
  });
});
