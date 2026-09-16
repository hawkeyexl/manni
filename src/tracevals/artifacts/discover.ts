/**
 * Static artifact discovery: find every skill, agent definition, and
 * project-rules file in a project without a trace.
 *
 * This is the inverse of `resolveArtifacts`, which maps names a trace *used*
 * onto files. Authoring (`manni tracevals fill`) needs the whole population instead,
 * including artifacts no session has exercised yet.
 *
 * Scope is deliberately the project only — never the user's `~/.claude` or the
 * plugin store, which hold third-party files that are not this project's to
 * edit.
 */
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { stat } from "node:fs/promises";
import { extractEvals } from "../evals/extract.js";
import { TracevalsError } from "../types.js";
import { listInTree, safeRead, segments } from "./fs.js";
import { PROJECT_RULES_FILENAMES } from "./resolve.js";
import type { ArtifactType, ResolvedArtifact } from "./types.js";

export interface DiscoveredArtifact {
  artifact: ResolvedArtifact;
  /**
   * `ok` — frontmatter parsed; `unreadable` — the YAML itself is malformed;
   * `invalid` — a `metadata.evals` block that fails the published schema.
   * Only `ok` artifacts are safe to propose against.
   */
  status: "ok" | "unreadable" | "invalid";
  /** Criterion names already declared, for dedupe and cache keying. */
  existingNames: string[];
  /** The artifact opted out via `metadata.evals.skip`. */
  skip: boolean;
  error?: string;
}

export interface DiscoveryResult {
  artifacts: DiscoveredArtifact[];
  warnings: string[];
}

export interface DiscoverOptions {
  /** Project root to scan. */
  root: string;
  /**
   * Explicit files or directories. A file is taken as an artifact regardless
   * of naming convention; a directory is scanned. Defaults to scanning `root`.
   * Relative entries resolve against `cwd`, like any CLI path argument.
   */
  paths?: string[];
  /** Base for relative `paths`; defaults to the process working directory. */
  cwd?: string;
}

const SKILL_DIRS = ["skills", join("src", "skills"), join(".claude", "skills")];
const RULES_NAMES = new Set<string>(PROJECT_RULES_FILENAMES);

/** Path segments, separator-normalized, for convention matching. */
/** Which artifact type a path represents by convention, if any. */
function classify(path: string): ArtifactType | undefined {
  const name = basename(path);
  if (RULES_NAMES.has(name)) return "project-rules";
  if (name === "SKILL.md") return "skill";
  if (!name.endsWith(".md")) return undefined;
  // Candidates only — `isRecognizedSlashCommand` and `isRecognizedAgent`
  // decide whether this particular directory is one the resolver would ever
  // look in. Commands nest (an organizing subdirectory does not rename the
  // command), so any `commands` ancestor is a candidate; agents do not.
  if (segments(dirname(path)).includes("commands")) return "slash-command";
  if (segments(dirname(path)).at(-1) === "agents") return "agent";
  return undefined;
}

/**
 * `path` split into segments relative to `anchor`, or null when it escapes.
 * Slicing by prefix length silently mangles paths that are not underneath the
 * anchor, so relative() does the work.
 */
function relativeSegments(anchor: string, path: string): string[] | null {
  const rel = relative(resolve(anchor), resolve(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return segments(rel);
}

/**
 * Artifact name as the rest of the system refers to it: a skill by its
 * directory, an agent by its filename stem, project rules by filename.
 */
function nameFor(type: ArtifactType, path: string): string {
  if (type === "skill") return segments(dirname(path)).at(-1) ?? basename(path);
  // A slash command is referenced by its filename stem with the leading slash
  // stripped, and an organizing subdirectory does not enter the name — so
  // `commands/release/tag.md` is `tag`, the same string the trace records.
  if (type === "agent" || type === "slash-command") {
    return basename(path).replace(/\.md$/, "");
  }
  return basename(path);
}

/**
 * Slash commands live in `.claude/commands/` at any depth — the only place
 * `resolveArtifacts` looks for a project command, so discovery and resolution
 * agree on the same population.
 *
 * Deliberately narrow, for the reason `isRecognizedAgent` is: `fill` writes by
 * default, and matching any directory named `commands` would classify a docs
 * page about a CLI as an instruction artifact and edit it.
 */
function isRecognizedSlashCommand(path: string, anchor: string): boolean {
  const parts = relativeSegments(anchor, path);
  if (parts === null) return false;
  // Any `.claude/commands/` pair, not the first segment that happens to be
  // named "commands": a project with a top-level `commands/` directory would
  // otherwise fail the `at >= 1` test and have its real command files rejected.
  return parts.some(
    (part, at) =>
      part === "commands" &&
      at >= 1 &&
      parts[at - 1] === ".claude" &&
      at < parts.length - 1,
  );
}

/** A skill file must sit as `<skillsDir>/<skillName>/SKILL.md`. */
function isRecognizedSkill(path: string, anchor: string): boolean {
  const parts = relativeSegments(anchor, path);
  if (parts === null) return false;
  return SKILL_DIRS.some((dir) => {
    const want = segments(dir);
    const at = parts.length - want.length - 2;
    if (at < 0) return false;
    return want.every((part, i) => parts[at + i] === part);
  });
}

/**
 * Agent definitions live in `.claude/agents/` at any depth, or in `agents/`
 * directly at the project root — the two places `resolveArtifacts` looks.
 *
 * This is deliberately narrow. Matching any directory named `agents` would
 * classify ordinary prose in `docs/agents/` as an agent definition, and `fill`
 * writes by default, so the mistake would edit unrelated files.
 */
function isRecognizedAgent(path: string, anchor: string): boolean {
  const parts = relativeSegments(anchor, path);
  if (parts === null) return false;
  if (parts.length === 2 && parts[0] === "agents") return true;
  return (
    parts.length >= 3 &&
    parts.at(-3) === ".claude" &&
    parts.at(-2) === "agents"
  );
}

async function readOne(
  path: string,
  type: ArtifactType,
): Promise<DiscoveredArtifact | null> {
  const content = await safeRead(path);
  if (content === null) return null;
  const artifact: ResolvedArtifact = {
    name: nameFor(type, path),
    type,
    path,
    content,
    origin: "project",
  };

  try {
    const extracted = await extractEvals(artifact);
    if (extracted.errors.length > 0) {
      const first = extracted.errors[0];
      return {
        artifact,
        status: "invalid",
        existingNames: [],
        skip: false,
        error: `metadata.evals is invalid: ${first?.message ?? "schema error"}`,
      };
    }
    return {
      artifact,
      status: "ok",
      existingNames: extracted.evals.map((e) => e.id),
      skip: extracted.skip,
    };
  } catch (err) {
    // docmeta throws on malformed YAML. A half-written artifact must not take
    // down a scan of the whole project.
    return {
      artifact,
      status: "unreadable",
      existingNames: [],
      skip: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function discoverArtifacts(
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const root = resolve(options.root);
  const warnings: string[] = [];
  const cwd = options.cwd ?? process.cwd();
  const targets = options.paths?.length
    ? options.paths.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)))
    : [root];

  const files = new Map<string, ArtifactType>();

  for (const target of targets) {
    let info;
    try {
      info = await stat(target);
    } catch {
      throw new TracevalsError(`no such file or directory: ${target}`);
    }

    if (info.isFile()) {
      // An explicit file is taken at its word; convention only supplies the
      // type, and an unrecognized name is treated as project rules.
      files.set(target, classify(target) ?? "project-rules");
      continue;
    }

    // Convention is anchored at the directory being scanned, so
    // `fill packages/api` treats that package as its own project rather than
    // silently finding nothing.
    const found = await listInTree(target, (path) => {
      const type = classify(path);
      if (type === undefined) return false;
      if (type === "skill") return isRecognizedSkill(path, target);
      if (type === "agent") return isRecognizedAgent(path, target);
      if (type === "slash-command") {
        return isRecognizedSlashCommand(path, target);
      }
      return true;
    });
    for (const path of found) {
      const type = classify(path);
      if (type !== undefined) files.set(path, type);
    }
  }

  const artifacts: DiscoveredArtifact[] = [];
  for (const [path, type] of files) {
    const discovered = await readOne(path, type);
    if (discovered === null) {
      warnings.push(`could not read ${path}`);
      continue;
    }
    if (discovered.status !== "ok") {
      warnings.push(`${path}: ${discovered.error ?? discovered.status}`);
    }
    artifacts.push(discovered);
  }
  return { artifacts, warnings };
}
