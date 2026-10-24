/**
 * What the judge sees of a finished run (proposal plan §4.6): the trace, the
 * workspace's changes and the docs the reader had. Built once per run, and
 * every judged eval reads the same text.
 *
 * Every block is redacted before it is cut, as tracevals' own render does, so
 * a cap never leaves the prefix of a secret behind.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { makeRedactor } from "../../tracevals/judge/redact.js";
import type { TraceEvent } from "../../tracevals/trace/types.js";
import type { RunEvidence, TaskSpec } from "./task-types.js";

export const MAX_TOOL_RESULT_CHARS = 2_000;
export const MAX_FILE_CHARS = 4_000;
export const MAX_WORKSPACE_CHARS = 20_000;
export const MAX_DOCS_CHARS = 40_000;

const scrub = makeRedactor();

/**
 * Redact, then cut to `max`, saying how much was left out. The note says the
 * cut is the judge's copy: a judge once read "left out" as the reader having
 * skimmed, and failed a constraint over it.
 */
function clip(text: string, max: number): string {
  const safe = scrub(text);
  if (safe.length <= max) return safe;
  return `${safe.slice(0, max)} [manni shortened this for the judge; the reader received ${String(safe.length - max)} more characters]`;
}

/** A page the reader had: its name in the `docs` list and its text. */
interface DocPage {
  name: string;
  text: string;
}

export interface Evidence {
  /** The judge's view of the run, §4.6's three sections. */
  text: string;
  /** The docs section alone, as it appears inside `text`. */
  docsText: string;
  /** The pages in `docsText`, start page first: docs-relative POSIX paths, or URLs. */
  docs: string[];
}

export function renderEvidence(evidence: RunEvidence): Evidence {
  const results = toolResults(evidence.trace.events);
  const { text: docsText, docs } = renderDocs(evidence, results);
  const text = [
    "## The trace",
    renderTrace(evidence, results),
    "## The workspace",
    renderWorkspace(evidence),
    "## The docs the reader had",
    docsText,
  ].join("\n\n");
  return { text, docsText, docs };
}

/**
 * The task as the reader was told it: the task, what started it, when it is
 * done, and where to start. The judge reads it as the source its evals come
 * from.
 */
export function taskBrief(evidence: RunEvidence): string {
  const { spec } = evidence;
  const lines = [spec.task];
  if (spec.journey?.trigger !== undefined) lines.push(`What started this: ${spec.journey.trigger}`);
  if (spec.journey?.successCriteria !== undefined) {
    lines.push(`You're done when: ${spec.journey.successCriteria.text}`);
  }
  lines.push(`Start here: ${startName(evidence)}`);
  return [...lines, "", whoTheReaderIs(spec)].join("\n");
}

/** The start page as the docs list names it: docs-relative, or the URL. */
function startName(evidence: RunEvidence): string {
  const { start } = evidence.spec;
  if (start.kind === "url") return start.url;
  if (evidence.docsDir !== null && evidence.startCopy !== null) {
    return toPosix(relative(real(evidence.docsDir), real(evidence.startCopy)));
  }
  return start.display;
}

/**
 * Who the reader played, so `followed-the-docs` can tell what the persona
 * already knew from what it guessed. Never the record's body.
 */
function whoTheReaderIs(spec: TaskSpec): string {
  const p = spec.persona;
  if (p === null) return "The reader: someone new to this product, with the task above and no other context.";
  const lines = [`The reader: ${[p.title ?? p.id, p.description].filter(Boolean).join(". ")}`];
  if (p.role !== undefined) lines.push(`Role: ${p.role}`);
  if (p.proficiency.length > 0) lines.push(`Already good at: ${p.proficiency.join("; ")}`);
  if (p.prerequisites.length > 0) lines.push(`Knows before starting: ${p.prerequisites.join("; ")}`);
  return lines.join("\n");
}

/** A tool result's text and the call it answers, keyed by `tool_use_id`. */
interface ToolResult {
  id: string;
  text: string;
}

/**
 * Each tool result in the stream, in order, keyed by the event it rode in.
 * One user record can carry several results.
 */
function toolResults(events: TraceEvent[]): Map<number, ToolResult[]> {
  const out = new Map<number, ToolResult[]>();
  for (const event of events) {
    if (event.kind !== "tool_result") continue;
    const message = event.raw.message;
    const content = isRecord(message) ? message.content : undefined;
    if (!Array.isArray(content)) continue;
    const found: ToolResult[] = [];
    for (const block of content as unknown[]) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      found.push({ id: block.tool_use_id, text: resultText(block.content) });
    }
    out.set(event.index, found);
  }
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as unknown[])
    .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
    .filter((t) => t !== "")
    .join("\n");
}

function renderTrace(evidence: RunEvidence, results: Map<number, ToolResult[]>): string {
  const { trace } = evidence;
  const callName = new Map<string, string>();
  const lines: string[] = [];
  for (const event of trace.events) {
    switch (event.kind) {
      case "user":
        if (event.text) lines.push(`[user] ${clip(event.text, MAX_TOOL_RESULT_CHARS)}`);
        break;
      case "assistant":
        if (event.text) lines.push(`[assistant] ${clip(event.text, MAX_TOOL_RESULT_CHARS)}`);
        break;
      case "tool_call": {
        const name = event.toolName ?? "?";
        if (typeof event.raw.id === "string") callName.set(event.raw.id, name);
        const input = JSON.stringify(event.raw.input ?? {});
        lines.push(`[tool] ${name} ${clip(input, MAX_TOOL_RESULT_CHARS)}`);
        break;
      }
      case "tool_result":
        for (const r of results.get(event.index) ?? []) {
          lines.push(`[result of ${callName.get(r.id) ?? r.id}] ${clip(r.text, MAX_TOOL_RESULT_CHARS)}`);
        }
        break;
      default:
        break;
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(no events)";
}

function renderWorkspace(evidence: RunEvidence): string {
  const { added, changed, removed } = evidence.changes;
  const lines: string[] = [];
  if (added.length > 0) lines.push(`added: ${added.join(", ")}`);
  if (changed.length > 0) lines.push(`changed: ${changed.join(", ")}`);
  if (removed.length > 0) lines.push(`removed: ${removed.join(", ")}`);
  if (lines.length === 0) return "No file was added, changed or removed.";

  let room = MAX_WORKSPACE_CHARS;
  for (const file of [...added, ...changed]) {
    const content = readText(join(evidence.workspaceDir, file));
    if (content === undefined) continue;
    if (room <= 0) {
      lines.push(`\n### ${file}\n[left out: the workspace's ${String(MAX_WORKSPACE_CHARS)}-character limit is reached]`);
      continue;
    }
    const body = clip(content, Math.min(MAX_FILE_CHARS, room));
    room -= Math.min(content.length, MAX_FILE_CHARS, room);
    lines.push(`\n### ${file}\n${body}`);
  }
  return lines.join("\n");
}

/**
 * The start page, then each page the reader opened, in order and once each:
 * a Read inside the docs copy, or a WebFetch and what it returned.
 */
function renderDocs(
  evidence: RunEvidence,
  results: Map<number, ToolResult[]>,
): { text: string; docs: string[] } {
  const { trace, spec, docsDir, startCopy } = evidence;
  const fetched = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const list of results.values()) for (const r of list) byId.set(r.id, r.text);

  const pages: DocPage[] = [];
  const seen = new Set<string>();
  const add = (key: string, page: DocPage | undefined): void => {
    if (page === undefined || seen.has(key)) return;
    seen.add(key);
    pages.push(page);
  };
  const docsRoot = docsDir === null ? null : real(docsDir);
  const docPage = (file: string): DocPage | undefined => {
    if (docsRoot === null) return undefined;
    const rel = relative(docsRoot, real(file));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
    const text = readText(file);
    return text === undefined ? undefined : { name: toPosix(rel), text };
  };

  // WebFetch results by URL, for a URL start the reader fetched.
  for (const event of trace.events) {
    if (event.kind !== "tool_call" || event.toolName !== "WebFetch") continue;
    const url = inputOf(event).url;
    const id = event.raw.id;
    if (typeof url === "string" && typeof id === "string" && !fetched.has(url)) {
      fetched.set(url, byId.get(id) ?? "");
    }
  }

  if (spec.start.kind === "url") {
    const text = fetched.get(spec.start.url);
    if (text !== undefined) add(urlKey(spec.start.url), { name: spec.start.url, text });
  } else if (startCopy !== null) {
    add(pathKey(startCopy), docPage(startCopy));
  }

  for (const event of trace.events) {
    if (event.kind !== "tool_call") continue;
    const input = inputOf(event);
    if (event.toolName === "Read" && typeof input.file_path === "string") {
      add(pathKey(input.file_path), docPage(input.file_path));
    } else if (event.toolName === "WebFetch" && typeof input.url === "string") {
      add(urlKey(input.url), { name: input.url, text: fetched.get(input.url) ?? "" });
    }
  }

  const blocks: string[] = [];
  const docs: string[] = [];
  let room = MAX_DOCS_CHARS;
  for (const page of pages) {
    if (room <= 0) break;
    blocks.push(`### ${page.name}\n${clip(page.text, room)}`);
    room -= page.text.length;
    docs.push(page.name);
  }
  return {
    text: blocks.length > 0 ? blocks.join("\n\n") : "The reader opened no page of the docs.",
    docs,
  };
}

function inputOf(event: TraceEvent): Record<string, unknown> {
  const input = event.raw.input;
  return isRecord(input) ? input : {};
}

/**
 * One spelling per file. The stream can name the docs copy by its 8.3 short
 * form on Windows (`C:\Users\HAWKEY~1\...`) and the long form elsewhere, and
 * Windows paths compare without case.
 */
function pathKey(file: string): string {
  const key = real(file);
  return process.platform === "win32" ? `file:${key.toLowerCase()}` : `file:${key}`;
}

function urlKey(url: string): string {
  return `url:${url}`;
}

/** The long, canonical spelling of a path that exists; the resolved one otherwise. */
function real(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return resolve(file);
  }
}

/** A text file's contents, or undefined for a missing or binary one. */
function readText(file: string): string | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return undefined;
  }
  if (bytes.subarray(0, 8_000).includes(0)) return undefined;
  return bytes.toString("utf8");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
