/**
 * A finished task run on disk, for the judging tests: a temp run directory
 * with `workspace/` and `docs/`, and a parsed stream. Never a real agent.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseTraceContent } from "../../src/tracevals/trace/claude.js";
import type { RunEvidence, TaskSpec } from "../../src/test/core/task-types.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "tasks");

export interface TaskRun {
  /** The run directory as `os.tmpdir()` spells it: an 8.3 short name on some Windows machines. */
  root: string;
  /** The same directory's long, canonical spelling, which the stream uses. */
  longRoot: string;
  evidence: RunEvidence;
  cleanup: () => void;
}

/** Write `files` (relative POSIX path → content) under `dir`. */
export function writeTree(dir: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/**
 * The recorded stream with its `__RUN__` placeholder pointed at `longRoot`.
 * It was recorded on Windows, so elsewhere its backslash separators become
 * slashes.
 */
export function recordedStream(name: string, longRoot: string): string {
  const raw = readFileSync(join(FIXTURES, name), "utf8");
  const placed = raw.replaceAll("__RUN__", JSON.stringify(longRoot).slice(1, -1));
  return process.platform === "win32" ? placed : placed.replaceAll("\\\\", "/");
}

/** One stream-json record per call, for traces a test writes itself. */
export const stream = {
  init: (cwd: string): string =>
    JSON.stringify({ type: "system", subtype: "init", cwd, session_id: "s1", model: "reader-model" }),
  say: (text: string): string =>
    JSON.stringify({ type: "assistant", session_id: "s1", message: { role: "assistant", content: [{ type: "text", text }] } }),
  call: (id: string, name: string, input: Record<string, unknown>): string =>
    JSON.stringify({
      type: "assistant",
      session_id: "s1",
      message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    }),
  result: (id: string, content: unknown): string =>
    JSON.stringify({
      type: "user",
      session_id: "s1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
    }),
};

export interface RunOptions {
  /** The stream: a fixture name, or lines built with `stream`. */
  trace: string | ((longRoot: string) => string[]);
  docs?: Record<string, string>;
  workspace?: Record<string, string | Buffer>;
  /** The start page, docs-relative; absent with `url`. */
  startPage?: string;
  url?: string;
  spec?: Partial<TaskSpec>;
  changes?: Partial<RunEvidence["changes"]>;
}

export function taskRun(options: RunOptions): TaskRun {
  const root = mkdtempSync(join(tmpdir(), "manni-task-judge-"));
  const longRoot = realpathSync.native(root);
  const docsDir = join(root, "docs");
  const workspaceDir = join(root, "workspace");
  writeTree(docsDir, options.docs ?? {});
  mkdirSync(workspaceDir, { recursive: true });
  writeTree(workspaceDir, options.workspace ?? {});

  const content =
    typeof options.trace === "string"
      ? recordedStream(options.trace, longRoot)
      : options.trace(longRoot).join("\n");
  const tracePath = join(root, "trace.jsonl");
  writeFileSync(tracePath, content);

  const page = options.startPage;
  const spec: TaskSpec = {
    task: "Fix the failing docs check.",
    journey: null,
    persona: null,
    start:
      options.url !== undefined
        ? { kind: "url", url: options.url }
        : {
            kind: "path",
            display: `docs/src/content/docs/${page ?? "index.mdx"}`,
            abs: join(root, "repo", "docs", "src", "content", "docs", ...(page ?? "index.mdx").split("/")),
          },
    workspaceSeed: null,
    workspaceDisplay: null,
    ...options.spec,
  };
  const evidence: RunEvidence = {
    spec,
    trace: parseTraceContent(content, tracePath),
    tracePath,
    workspaceDir,
    docsDir: options.url !== undefined ? null : docsDir,
    startCopy: options.url !== undefined || page === undefined ? null : join(docsDir, ...page.split("/")),
    account: "",
    changes: { added: [], changed: [], removed: [], ...options.changes },
    configDir: join(root, "repo"),
  };
  return {
    root,
    longRoot,
    evidence,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The recorded pass: a reader fixing `docs/install.md` from the fix page. */
export function recordedPass(spec?: Partial<TaskSpec>): TaskRun {
  return taskRun({
    trace: "stream-pass.jsonl",
    startPage: "meta/fix/index.mdx",
    docs: {
      "meta/fix/index.mdx": "---\ntitle: Fix a failing check\n---\n\nAdd the missing field, then run manni meta validate.\n",
      "meta/reference/configuration.mdx": "---\ntitle: Configuration\n---\n\nNot opened by the reader.\n",
    },
    workspace: {
      "docs/install.md":
        "---\ntitle: Install the widget\ndescription: Install the widget and run its installer.\ntype: how-to\n---\n\n# Install the widget\n\nRun the installer.\n",
      "manni.config.yaml": 'collections:\n  - name: pages\n    paths: ["docs/**/*.md"]\n',
    },
    changes: { changed: ["docs/install.md"] },
    ...(spec === undefined ? {} : { spec }),
  });
}
