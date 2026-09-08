/**
 * Derive `owner` from a CODEOWNERS file.
 *
 * Unlike `.gitignore` (see `../gitignore.ts`), CODEOWNERS is matched here
 * rather than by asking a tool. There is no `git check-codeowners`, and the
 * language is the small end of gitignore: GitHub allows no `!` negation and no
 * character ranges, there is one file rather than a stack of nested ones, and
 * the precedence rule is "last match wins". That is expressible with
 * picomatch once each pattern is rewritten the way git reads it — a pattern
 * with no slash matches at any depth, a leading `/` anchors it, a trailing
 * `/` names a directory, and any match on a directory covers what is under it.
 *
 * GitLab adds sections. Every section applies, so the owners of a file are the
 * union of the last match in each section; a section may carry default owners
 * for rules that list none, `^[Name]` marks approval optional (the owners are
 * still owners), and `[Name][n]` sets the approvals required. GitHub has no
 * sections, which is the same thing as one unnamed section.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import type { DerivedValue, SourceStatus } from "./types.js";

/** Where a CODEOWNERS file may live, in the order the forges look. */
export const CODEOWNERS_LOCATIONS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
  ".gitlab/CODEOWNERS",
] as const;

export interface CodeownersRule {
  pattern: string;
  owners: string[];
  line: number;
  /** The GitLab section the rule sits in; absent in the unnamed default section. */
  section?: string;
}

export interface CodeownersSection {
  name: string;
  optional: boolean;
  approvals?: number;
  defaultOwners: string[];
}

export interface CodeownersFile {
  path: string;
  /** As the run reports it: forward slashes, relative to the base. */
  label: string;
  rules: CodeownersRule[];
  sections: CodeownersSection[];
}

/**
 * The first existing location in `CODEOWNERS_LOCATIONS` under `root`, or the
 * explicit path resolved against `root`; null if none exists. An explicit
 * path that is missing is null rather than a fallback to the search, because
 * a config that names a file means that file.
 */
export function findCodeowners(root: string, explicit?: string): string | null {
  if (explicit !== undefined) {
    const path = resolve(root, explicit);
    return existsSync(path) ? path : null;
  }
  for (const loc of CODEOWNERS_LOCATIONS) {
    const path = resolve(root, ...loc.split("/"));
    if (existsSync(path)) return path;
  }
  return null;
}

/** `[Name]`, `^[Name]`, `[Name][2]`, each optionally followed by default owners. */
const SECTION_HEADER = /^(\^?)\[([^\]]+)\](?:\[(\d+)\])?(.*)$/;

/** Tokens split on unescaped whitespace; `\ ` stays inside its token. */
const TOKEN = /(?:\\.|[^\s\\])+/g;

/**
 * Parse CODEOWNERS text. Never throws: a line that cannot be read as a rule
 * or a section header (an unclosed `[Name`, say) is skipped, since the forge
 * would skip it too and a derived value should not fail the run over it.
 */
export function parseCodeowners(
  text: string,
  path: string,
  label: string,
): CodeownersFile {
  const rules: CodeownersRule[] = [];
  const sections: CodeownersSection[] = [];
  let current: CodeownersSection | undefined;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("[") || line.startsWith("^[")) {
      const m = SECTION_HEADER.exec(line);
      if (!m) continue;
      const [, caret, rawName, approvals, rest] = m;
      const name = (rawName ?? "").trim();
      if (name === "") continue;
      const owners = tokens(rest ?? "");
      // GitLab merges repeated headers of one section, case-insensitively.
      const existing = sections.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        if (owners.length > 0) existing.defaultOwners = owners;
        current = existing;
        continue;
      }
      const section: CodeownersSection = {
        name,
        optional: caret === "^",
        ...(approvals !== undefined ? { approvals: Number(approvals) } : {}),
        defaultOwners: owners,
      };
      sections.push(section);
      current = section;
      continue;
    }

    const [first, ...owners] = tokens(line);
    if (first === undefined) continue;
    const pattern = unescapePattern(first);
    if (pattern === "" || pattern === "/") continue;
    rules.push({
      pattern,
      owners,
      line: i + 1,
      ...(current ? { section: current.name } : {}),
    });
  }
  return { path, label, rules, sections };
}

function tokens(s: string): string[] {
  return s.match(TOKEN) ?? [];
}

/**
 * `\ ` is a literal space and `\#` a literal hash at the start; every other
 * escape is left for picomatch, where `\*` still means a literal star.
 */
function unescapePattern(token: string): string {
  return token.replace(/\\ /g, " ").replace(/^\\#/, "#");
}

/**
 * Owners of `relPath` (repository-relative, forward slashes) under `file`,
 * with the line of the last winning rule; null when no rule in any section
 * matches. Within a section the last matching rule wins outright, a winner
 * that lists no owners takes the section's default owners, and a winner with
 * neither means "no owner" — a match that clears the field rather than a
 * miss. Across sections the winners' owners are unioned in section order,
 * first appearance kept.
 */
export function ownersFor(
  file: CodeownersFile,
  relPath: string,
): { owners: string[]; line: number } | null {
  const matchers = matchersFor(file);
  const defaults = new Map(file.sections.map((s) => [s.name, s.defaultOwners]));

  // Section order is first appearance; the unnamed default section is first.
  const order: (string | undefined)[] = [undefined, ...file.sections.map((s) => s.name)];
  const winners = new Map<string | undefined, CodeownersRule>();
  file.rules.forEach((rule, i) => {
    if (matchers[i]?.(relPath)) winners.set(rule.section, rule);
  });
  if (winners.size === 0) return null;

  const owners: string[] = [];
  let line = 0;
  for (const section of order) {
    const rule = winners.get(section);
    if (!rule) continue;
    line = rule.line;
    const chosen =
      rule.owners.length > 0
        ? rule.owners
        : (section === undefined ? undefined : defaults.get(section)) ?? [];
    for (const o of chosen) if (!owners.includes(o)) owners.push(o);
  }
  return { owners, line };
}

const matcherCache = new WeakMap<CodeownersFile, ((p: string) => boolean)[]>();

function matchersFor(file: CodeownersFile): ((p: string) => boolean)[] {
  let matchers = matcherCache.get(file);
  if (!matchers) {
    matchers = file.rules.map((r) => picomatch(toGlobs(r.pattern), PICOMATCH));
    matcherCache.set(file, matchers);
  }
  return matchers;
}

/**
 * `dot` because CODEOWNERS covers `.github/` and friends as a matter of
 * course, and gitignore's `*` never skips dotfiles. `windows: false` pins
 * posix semantics on every platform: the paths handed in are already
 * forward-slashed, and letting picomatch treat `\` as a separator on Windows
 * would silently change what a `\*` escape in the file means there.
 */
const PICOMATCH = { dot: true, windows: false } as const;

/**
 * Rewrite one CODEOWNERS pattern into the picomatch globs that read it the
 * way git does. A pattern with no slash (or only a trailing one) matches at
 * any depth, so it gets a globstar-and-slash prefix; a leading `/` or a slash
 * in the middle anchors it to the root. A match on a directory covers
 * everything under it, so a second glob with a slash-and-globstar suffix is
 * always included; a trailing `/` means *only* a directory, so the bare
 * pattern is then left out.
 */
function toGlobs(pattern: string): string[] {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  let anchored = false;
  if (p.startsWith("/")) {
    anchored = true;
    p = p.slice(1);
  } else if (p.includes("/") && !p.startsWith("**/")) {
    anchored = true;
  }
  const base = anchored || p.startsWith("**/") ? p : `**/${p}`;
  return dirOnly ? [`${base}/**`] : [base, `${base}/**`];
}

export interface CodeownersSourceOptions {
  /** Explicit path from config `derive.codeowners`, resolved against `configDir`. */
  explicit?: string;
  configDir?: string;
  /** Repository root for an input's absolute path; null when outside a repository. */
  rootOf: (absPath: string) => string | null;
}

export interface CodeownersSourceResult {
  status: SourceStatus;
  /** Keyed by label; an input outside any repository is absent. */
  records: Map<string, DerivedValue | null>;
}

const NOT_FOUND_REASON = `no CODEOWNERS file found (looked for ${CODEOWNERS_LOCATIONS.join(", ")})`;

/**
 * Derive owners for every input that sits in a repository. Inputs are grouped
 * by root and each root resolves its own file — the explicit path when the
 * config names one, otherwise the first location found under that root.
 *
 * A root with no file yields null records, and so does a run where no root
 * has one: a repository that declares no owners is a fact, not a broken
 * source, so the status stays available and carries the search as a
 * `reason` for the caller to surface as a notice. Only an explicit
 * `derive.codeowners` path that does not exist is unavailable — a configured
 * file that is missing is the operator's error, and silently answering null
 * there would be the green gate over nothing that the channel refuses.
 */
export async function deriveFromCodeowners(
  inputs: readonly { label: string; absPath: string }[],
  opts: CodeownersSourceOptions,
): Promise<CodeownersSourceResult> {
  const records = new Map<string, DerivedValue | null>();

  const explicitPath =
    opts.explicit === undefined
      ? undefined
      : resolve(opts.configDir ?? process.cwd(), opts.explicit);
  if (explicitPath !== undefined && !existsSync(explicitPath)) {
    return {
      status: { available: false, reason: `CODEOWNERS not found at ${explicitPath}` },
      records,
    };
  }

  const byRoot = new Map<string, { label: string; absPath: string }[]>();
  const rootCache = new Map<string, string | null>();
  for (const input of inputs) {
    let root = rootCache.get(input.absPath);
    if (root === undefined) {
      root = opts.rootOf(input.absPath);
      rootCache.set(input.absPath, root);
    }
    if (root === null) continue;
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(input);
    else byRoot.set(root, [input]);
  }

  let found = 0;
  const parsed = new Map<string, Promise<CodeownersFile>>();
  for (const [root, bucket] of byRoot) {
    const path = explicitPath ?? findCodeowners(root);
    if (path === null) {
      for (const input of bucket) records.set(input.label, null);
      continue;
    }
    found += 1;
    const label = toPosix(relative(opts.configDir ?? root, path));
    const key = `${path}\0${label}`;
    let file = parsed.get(key);
    if (!file) {
      file = readFile(path, "utf8").then((text) =>
        parseCodeowners(text, path, label),
      );
      parsed.set(key, file);
    }
    const owners = await file;
    for (const input of bucket) {
      const rel = toPosix(relative(root, input.absPath));
      const hit = ownersFor(owners, rel);
      records.set(
        input.label,
        hit === null
          ? null
          : {
              value: hit.owners,
              source: "codeowners",
              evidence: `${label}:${hit.line}`,
            },
      );
    }
  }

  if (byRoot.size === 0) {
    return {
      status: { available: false, reason: "no git repository contains the documents" },
      records,
    };
  }
  if (found === 0 && explicitPath === undefined) {
    return { status: { available: true, reason: NOT_FOUND_REASON }, records };
  }
  return { status: { available: true }, records };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
