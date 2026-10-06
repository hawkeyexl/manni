/**
 * Which files govern the agent in a turn (proposal 0079, "Rule sources and
 * their triggers"). Resolution is deterministic, from the filesystem and the
 * trace; no model decides which files count.
 *
 * The list of formats is closed. Reading a file never makes it a source: a
 * README or a product docs page describes other systems, so only the known
 * formats, files named by `include`, and what a skill or an `@path` import
 * pulls in are ever returned. `exclude` removes a file from every row.
 *
 * To touch a file is to Read, Write or Edit it, anywhere in the session up to
 * the turn's end, which is Claude Code's own trigger for path-scoped rules.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { extractFrontmatter } from "../../meta/extractors/frontmatter.js";
import type { ExtractedMetadata } from "../../meta/types.js";
import { resolveArtifacts } from "../artifacts/resolve.js";
import { findGitRoot, listInTree, safeRead } from "../artifacts/fs.js";
import { extractEvals } from "../evals/extract.js";
import { windowOf } from "../graders/util.js";
import { configDir } from "../trace/discover.js";
import type { Trace } from "../trace/types.js";

export type RuleFormat =
  | "claude-md"
  | "claude-rule"
  | "agents-md"
  | "gemini-md"
  | "cursor-rule"
  | "kiro-steering"
  | "speckit-constitution"
  | "openspec-project"
  | "import"
  | "skill"
  | "slash-command"
  | "agent"
  | "designated";

/** An `ai` eval a source declares; its assertion is the rule (proposal 0079). */
export interface DeclaredRule {
  id: string;
  text: string;
  when?: Record<string, unknown>;
}

export interface RuleSource {
  /** Absolute path on disk. */
  path: string;
  /** Relative to the project root with forward slashes, or `~/…` under home. */
  displayPath: string;
  format: RuleFormat;
  /** Why the file is in scope, in words: `always`, `read`, `touched src/a.ts`. */
  trigger: string;
  content: string;
  /** sha256 of `content`, hex. */
  sha256: string;
  /** The skill a `skill` source belongs to. */
  skill?: string;
  /** Present when the file declares `ai` evals; they replace extraction. */
  declaredRules?: DeclaredRule[];
}

export interface SourceOptions {
  /** The session's working directory, where the ancestor walk starts. */
  projectDir: string;
  /** Ceiling for the ancestor walk and base of `displayPath`; default the git root. */
  projectRoot?: string;
  /** `CLAUDE_CONFIG_DIR` finds `~/.claude`; `HOME` / `USERPROFILE` find `~/.gemini` and `~/.kiro`. */
  env?: Record<string, string | undefined>;
  /** `conformance.include`: globs, relative to the project root, in scope once read. */
  include?: string[];
  /** `conformance.exclude`: globs never treated as sources, in any row. */
  exclude?: string[];
  /** Set under SubagentStop: the subagent type whose definition governs the run. */
  agentType?: string;
}

export interface ResolvedSources {
  sources: RuleSource[];
  warnings: string[];
}

/** The turn's ordinal bounds in `trace.events`, inclusive. `lastTurn` returns them. */
export interface TurnBounds {
  from: number;
  to: number;
}

/** Imports followed from a `claude-md` or `gemini-md` file, as Claude Code does. */
const MAX_IMPORT_HOPS = 4;

type Trigger =
  | { kind: "always" }
  | { kind: "read" }
  | { kind: "globs"; key: string; patterns: string[] };

interface Candidate {
  path: string;
  format: RuleFormat;
  trigger: Trigger;
}

interface Touch {
  abs: string;
  rel: string | null;
  read: boolean;
}

class Collector {
  readonly sources: RuleSource[] = [];
  readonly warnings: string[] = [];
  private readonly seen = new Set<string>();
  private readonly parsed = new Map<string, ExtractedMetadata | null>();
  private readonly excluded: (path: string) => boolean;

  constructor(
    readonly cwd: string,
    readonly root: string,
    readonly home: string,
    exclude: string[],
  ) {
    const match = exclude.length > 0 ? picomatch(exclude, { dot: true }) : null;
    this.excluded = (path) => match !== null && match(this.display(path));
  }

  display(path: string): string {
    const inRoot = relPosix(this.root, path);
    if (inRoot !== null) return inRoot;
    const inHome = relPosix(this.home, path);
    if (inHome !== null) return `~/${inHome}`;
    return path.split(sep).join("/");
  }

  has(path: string): boolean {
    return this.seen.has(key(path));
  }

  /** The file's front matter, or null when it has none or it does not parse. */
  front(path: string, content: string): ExtractedMetadata | null {
    const k = key(path);
    if (this.parsed.has(k)) return this.parsed.get(k) ?? null;
    let parsed: ExtractedMetadata | null = null;
    try {
      const fm = extractFrontmatter(content, "markdown");
      parsed = fm.present ? fm : null;
    } catch (err) {
      const loose = isCursorRule(path) ? cursorFront(content) : null;
      if (loose !== null) {
        this.parsed.set(k, loose);
        return loose;
      }
      const first = (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
      this.warnings.push(
        `${this.display(path)}: front matter does not parse (${first}), so it is read as having none`,
      );
    }
    this.parsed.set(k, parsed);
    return parsed;
  }

  /** Adds a source once. Returns it, or null when excluded or already listed. */
  add(
    path: string,
    content: string,
    format: RuleFormat,
    trigger: string,
    skill?: string,
  ): RuleSource | null {
    if (this.has(path) || this.excluded(path)) return null;
    this.seen.add(key(path));
    const source: RuleSource = {
      path,
      displayPath: this.display(path),
      format,
      trigger,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    if (skill !== undefined) source.skill = skill;
    const declared = this.declared(path, content);
    if (declared !== undefined) source.declaredRules = declared;
    this.sources.push(source);
    return source;
  }

  private declared(path: string, content: string): DeclaredRule[] | undefined {
    const fm = this.front(path, content);
    if (fm === null) return undefined;
    const extracted = extractEvals(
      { name: basename(path), type: "project-rules", path, content, origin: "project" },
      fm,
    );
    if (extracted.errors.length > 0) {
      this.warnings.push(
        `${this.display(path)}: metadata.evals does not validate (${extracted.errors[0]?.message ?? "invalid"}), so it declares no rules`,
      );
      return undefined;
    }
    const rules: DeclaredRule[] = [];
    for (const entry of extracted.evals) {
      if (entry.grader !== "ai" || entry.assertion === undefined) continue;
      const rule: DeclaredRule = { id: entry.id, text: entry.assertion };
      const when = entry.options?.when;
      if (isRecord(when)) rule.when = when;
      rules.push(rule);
    }
    return rules.length > 0 ? rules : undefined;
  }
}

/** Every source whose trigger is "always", without a trace (for `prepare`). */
export async function resolveAlwaysSources(opts: SourceOptions): Promise<ResolvedSources> {
  const c = await collector(opts);
  for (const candidate of await catalog(c, opts)) {
    if (candidate.trigger.kind === "always") await addWithImports(c, candidate, "always");
  }
  await addDesignated(c, opts);
  return { sources: c.sources, warnings: c.warnings };
}

/** Every source in scope for one turn of `trace`. */
export async function resolveTurnSources(
  trace: Trace,
  turn: TurnBounds,
  opts: SourceOptions,
): Promise<ResolvedSources> {
  const c = await collector(opts);
  const touches: Touch[] = trace.fileAccesses
    .filter((a) => a.index <= turn.to)
    .map((a) => {
      const abs = resolve(c.cwd, a.path);
      return { abs, rel: relPosix(c.root, abs), read: a.op === "read" };
    });
  const wasRead = new Set(touches.filter((t) => t.read).map((t) => key(t.abs)));

  for (const candidate of await catalog(c, opts)) {
    const { trigger } = candidate;
    if (trigger.kind === "always") {
      await addWithImports(c, candidate, "always");
    } else if (trigger.kind === "read") {
      if (wasRead.has(key(candidate.path))) await addWithImports(c, candidate, "read");
    } else {
      const match = picomatch(trigger.patterns, { dot: true });
      const hit = touches.find((t) => t.rel !== null && match(t.rel));
      if (hit !== undefined && hit.rel !== null) {
        await addWithImports(c, candidate, `${trigger.key} matched ${hit.rel}`);
      }
    }
  }

  // A subdirectory's memory file applies once a file under it is touched.
  // Farther directories come first, so the nearest file reads last.
  const nested = new Map<string, string>();
  for (const touch of touches) {
    if (touch.rel === null) continue;
    for (const dir of dirsBelowCwd(c, dirname(touch.abs))) {
      if (!nested.has(dir)) nested.set(dir, touch.rel);
    }
  }
  const dirs = [...nested.keys()].sort((a, b) => a.length - b.length);
  for (const dir of dirs) {
    const touched = nested.get(dir) ?? "";
    for (const [name, format] of NESTED_FILES) {
      const path = join(dir, name);
      const content = await safeRead(path);
      if (content !== null) {
        await addWithImports(c, { path, format, trigger: { kind: "always" } }, `touched ${touched}`, content);
      }
    }
  }

  await addWindowed(c, trace, turn, touches, opts);

  await addDesignated(c, opts);
  return { sources: c.sources, warnings: c.warnings };
}

/**
 * Files named in `conformance.include`. A person chose each one to govern the
 * agent, so it applies to every turn, as a `CLAUDE.md` does. Waiting for the
 * agent to read one would let a turn that skipped it escape its rules.
 */
async function addDesignated(c: Collector, opts: SourceOptions): Promise<void> {
  const include = opts.include ?? [];
  if (include.length === 0) return;
  const match = picomatch(include, { dot: true });
  const found = await listInTree(c.root, (abs) => {
    const rel = relPosix(c.root, abs);
    return rel !== null && match(rel);
  });
  for (const abs of found) {
    if (c.has(abs)) continue;
    const content = await safeRead(abs);
    if (content === null) {
      c.warnings.push(`${c.display(abs)}: matched conformance.include but could not be read`);
      continue;
    }
    c.add(abs, content, "designated", "always");
  }
}

// ── Skills, slash commands and the agent ─────────────────────────

async function addWindowed(
  c: Collector,
  trace: Trace,
  turn: TurnBounds,
  touches: Touch[],
  opts: SourceOptions,
): Promise<void> {
  // The existing resolver settles which file a skill, command or agent names.
  // Agents spawned in a main session govern their own runs, not this turn, so
  // only the agent this run is (under SubagentStop) is asked for.
  const { artifacts } = await resolveArtifacts(
    {
      ...trace,
      agentSpawns:
        opts.agentType === undefined ? [] : [{ subagentType: opts.agentType, index: 0 }],
    },
    { projectDir: c.cwd, projectRoot: c.root, ...(opts.env ? { env: opts.env } : {}) },
  );
  for (const artifact of artifacts) {
    if (artifact.type === "agent") {
      c.add(artifact.path, artifact.content, "agent", "subagent run");
      continue;
    }
    if (artifact.type !== "skill" && artifact.type !== "slash-command") continue;
    const window = windowOf(trace, artifact);
    const overlaps = window.events.some((e) => e.index >= turn.from && e.index <= turn.to);
    if (!overlaps) continue;
    if (artifact.type === "slash-command") {
      c.add(artifact.path, artifact.content, "slash-command", "slash command window");
      continue;
    }
    c.add(artifact.path, artifact.content, "skill", "skill window", artifact.name);
    const skillDir = dirname(artifact.path);
    for (const touch of touches) {
      if (!touch.read || relPosix(skillDir, touch.abs) === null || c.has(touch.abs)) continue;
      const content = await safeRead(touch.abs);
      if (content !== null) {
        c.add(touch.abs, content, "skill", `read under skill ${artifact.name}`, artifact.name);
      }
    }
  }
}

// ── The catalog of known formats ─────────────────────────────────

/** Memory files read at cwd, each ancestor up to the root, and in their `.claude/`. */
const ANCESTOR_FILES: [string, RuleFormat][] = [
  ["CLAUDE.md", "claude-md"],
  ["CLAUDE.local.md", "claude-md"],
  [join(".claude", "CLAUDE.md"), "claude-md"],
  ["AGENTS.md", "agents-md"],
  [join(".claude", "AGENTS.md"), "agents-md"],
  ["GEMINI.md", "gemini-md"],
];

/** Memory files a touch under a subdirectory brings in. */
const NESTED_FILES: [string, RuleFormat][] = [
  ["CLAUDE.md", "claude-md"],
  ["AGENTS.md", "agents-md"],
  ["GEMINI.md", "gemini-md"],
];

async function catalog(c: Collector, opts: SourceOptions): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const userClaude = configDir(opts.env);
  const always: Trigger = { kind: "always" };

  out.push({ path: join(userClaude, "CLAUDE.md"), format: "claude-md", trigger: always });
  out.push({ path: join(c.home, ".gemini", "GEMINI.md"), format: "gemini-md", trigger: always });
  for (const dir of ancestors(c.cwd, c.root).reverse()) {
    for (const [name, format] of ANCESTOR_FILES) {
      out.push({ path: join(dir, name), format, trigger: always });
    }
  }

  // Project-level directories live at the root; a cwd below it is checked too.
  const bases = c.cwd === c.root ? [c.root] : [c.root, c.cwd];

  for (const dir of [join(userClaude, "rules"), ...bases.map((b) => join(b, ".claude", "rules"))]) {
    for (const path of await listInTree(dir, (p) => p.endsWith(".md"))) {
      out.push({ path, format: "claude-rule", trigger: await claudeRuleTrigger(c, path) });
    }
  }

  for (const base of bases) {
    const dir = join(base, ".cursor", "rules");
    for (const path of await listInTree(dir, (p) => p.endsWith(".mdc") || p.endsWith(".md"))) {
      const trigger = await cursorTrigger(c, path);
      if (trigger !== null) out.push({ path, format: "cursor-rule", trigger });
    }
  }

  for (const dir of [join(c.home, ".kiro", "steering"), ...bases.map((b) => join(b, ".kiro", "steering"))]) {
    for (const path of await listInTree(dir, (p) => p.endsWith(".md"), { maxDepth: 0 })) {
      out.push({ path, format: "kiro-steering", trigger: await kiroTrigger(c, path) });
    }
  }

  for (const base of bases) {
    out.push({
      path: join(base, ".specify", "memory", "constitution.md"),
      format: "speckit-constitution",
      trigger: always,
    });
    out.push({ path: join(base, "openspec", "project.md"), format: "openspec-project", trigger: { kind: "read" } });
  }
  return out;
}

async function frontOf(c: Collector, path: string): Promise<Record<string, unknown> | null> {
  const content = await safeRead(path);
  if (content === null) return null;
  return c.front(path, content)?.data ?? null;
}

async function claudeRuleTrigger(c: Collector, path: string): Promise<Trigger> {
  const patterns = globList((await frontOf(c, path))?.paths);
  return patterns.length > 0 ? { kind: "globs", key: "paths", patterns } : { kind: "always" };
}

/** Null for a `.md` file with no front matter, which Cursor does not read as a rule. */
async function cursorTrigger(c: Collector, path: string): Promise<Trigger | null> {
  const fm = await frontOf(c, path);
  if (fm === null && !path.endsWith(".mdc")) return null;
  if (fm?.alwaysApply === true) return { kind: "always" };
  const patterns = globList(fm?.globs);
  return patterns.length > 0 ? { kind: "globs", key: "globs", patterns } : { kind: "read" };
}

async function kiroTrigger(c: Collector, path: string): Promise<Trigger> {
  const fm = await frontOf(c, path);
  const inclusion = fm?.inclusion;
  if (inclusion === undefined || inclusion === "always") return { kind: "always" };
  if (inclusion === "fileMatch") {
    const patterns = globList(fm?.fileMatchPattern);
    if (patterns.length > 0) return { kind: "globs", key: "fileMatchPattern", patterns };
  }
  return { kind: "read" };
}

// ── Imports ──────────────────────────────────────────────────────

/** Adds a candidate and, for a memory file, what its `@path` lines import. */
async function addWithImports(
  c: Collector,
  candidate: Candidate,
  trigger: string,
  known?: string,
): Promise<void> {
  if (c.has(candidate.path)) return;
  const content = known ?? (await safeRead(candidate.path));
  if (content === null) return;
  const added = c.add(candidate.path, content, candidate.format, trigger);
  if (added === null || (candidate.format !== "claude-md" && candidate.format !== "gemini-md")) {
    return;
  }
  let frontier = [added];
  for (let hop = 1; hop <= MAX_IMPORT_HOPS && frontier.length > 0; hop += 1) {
    const next: RuleSource[] = [];
    for (const importer of frontier) {
      for (const ref of importsOf(importer.content)) {
        const path = ref.startsWith("~/")
          ? join(c.home, ref.slice(2))
          : resolve(dirname(importer.path), ref);
        if (c.has(path)) continue;
        const body = await safeRead(path);
        if (body === null) continue;
        const source = c.add(path, body, "import", `imported by ${importer.displayPath}`);
        if (source !== null) next.push(source);
      }
    }
    frontier = next;
  }
}

/** `@path` references outside code fences and code spans. */
function importsOf(content: string): string[] {
  const refs: string[] = [];
  let fenced = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const m of prose.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
      const ref = m[1]?.replace(/[.,;:!?)\]]+$/, "");
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

// ── Helpers ──────────────────────────────────────────────────────

async function collector(opts: SourceOptions): Promise<Collector> {
  const cwd = resolve(opts.projectDir);
  const root = resolve(opts.projectRoot ?? (await findGitRoot(cwd)) ?? cwd);
  return new Collector(cwd, root, homeDir(opts.env), opts.exclude ?? []);
}

function homeDir(env: Record<string, string | undefined> = process.env): string {
  const set = process.platform === "win32" ? (env.USERPROFILE ?? env.HOME) : env.HOME;
  return resolve(set ?? homedir());
}

/** cwd and each ancestor up to the root, nearest first. */
function ancestors(cwd: string, root: string): string[] {
  const dirs: string[] = [];
  let current = cwd;
  for (let depth = 0; depth < 32; depth += 1) {
    dirs.push(current);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/** `dir` and its ancestors inside the root that are not cwd or above it. */
function dirsBelowCwd(c: Collector, dir: string): string[] {
  const dirs: string[] = [];
  let current = dir;
  for (let depth = 0; depth < 64; depth += 1) {
    if (relPosix(c.root, current) === null || relPosix(current, c.cwd) !== null) break;
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/** One glob, a comma-separated string, or a list. Commas inside braces stay. */
function isCursorRule(path: string): boolean {
  return path.split(sep).join("/").includes("/.cursor/rules/");
}

/**
 * Cursor reads its front matter line by line, so `globs: **\/*.ts` is a rule
 * there and invalid YAML (an alias) here. This reads the three keys Cursor
 * defines the way Cursor does, as `key: rest of line`.
 */
function cursorFront(content: string): ExtractedMetadata | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (block === undefined) return null;
  const data: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^(description|globs|alwaysApply):\s*(.*)$/.exec(line);
    const name = m?.[1];
    const value = m?.[2]?.trim();
    if (name === undefined || value === undefined) continue;
    data[name] = name === "alwaysApply" ? value === "true" : value;
  }
  if (Object.keys(data).length === 0) return null;
  return { data, present: true, format: "markdown", lineFor: () => undefined };
}

function globList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  }
  if (typeof value !== "string") return [];
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

/** `path` relative to `base` with forward slashes, or null when outside it. */
function relPosix(base: string, path: string): string | null {
  const rel = relative(base, path);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function key(path: string): string {
  const abs = resolve(path);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
