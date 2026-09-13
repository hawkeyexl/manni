/**
 * Version pins copied into the docs: find them, judge them, rewrite them.
 *
 * Shared by `scripts/check-versions.mjs`, `scripts/sync-versions.mjs` and the
 * release plugin `scripts/release-sync-versions.mjs`, so the three cannot
 * disagree about what a pin is. The two commands are the CLI face; this module
 * owns the rules.
 *
 * A pin is a version a reader copies: `uses: hawkeyexl/manni@v2`,
 * `npx @hawkeyexl/manni@2`, a pre-commit `rev:`, a third-party action's `@vN`,
 * a `node-version:`. Each one is right on the day it is typed and wrong from
 * the release that follows, so each has a source of truth to compare against:
 *
 *   hawkeyexl/manni@vN          v<major>          package.json version
 *   hawkeyexl/manni@vX.Y.Z      v<version>        package.json version
 *   @hawkeyexl/manni@N          <major>           package.json version
 *   @hawkeyexl/manni@X.Y.Z      <version>         package.json version
 *   rev: vN / vX.Y.Z            v<version>        package.json version
 *     (only in a YAML list item whose `repo:` names hawkeyexl/manni)
 *   <owner>/<action>@vN         highest major in  .github/workflows/*.yml
 *   node-version: N / 'N' / "N" major of          package.json engines.node
 *
 * `@hawkeyexl/manni@latest` and an unpinned `@hawkeyexl/manni` are always
 * right, so they are not pins. An action no workflow uses has nothing to be
 * compared with, so it is not checked either.
 *
 * Scanned: README.md, examples/**, docs/src/content/docs/**\/*.{md,mdx}.
 * Never: docs/proposals/** and CHANGELOG.md, which are records of what was
 * true when they were written.
 *
 * A rewrite replaces the version text and nothing else, so line endings,
 * quotes and a trailing comment all survive it.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A setup problem: the sources of truth are missing, so nothing can be judged. */
export class VersionsSetupError extends Error {}

const posix = (p) => p.split(path.sep).join("/");

// ---------------------------------------------------------------------------
// Sources of truth.
// ---------------------------------------------------------------------------

/**
 * The engines.node forms a node-version pin is judged against: one lower bound,
 * written N, >=N, >=N.M or >=N.M.P, or N / N.M / N.M.P after ^ or ~, with
 * optional whitespace around it. Group 1 is its major.
 *
 * A compound range (>=20.9.0 || >=22, >=20 <25, 20 - 24) or a wildcard (*,
 * 24.x) has no single major to pin to, and picking one is a guess. The first
 * digit run of >=20.9.0 || >=22 is 20, which is not what that range means. So
 * anything else is a setup error, not a guess.
 */
const SINGLE_LOWER_BOUND = /^\s*(?:>=|\^|~)?(\d+)(?:\.\d+){0,2}\s*$/;

/**
 * Reads package.json and the workflows under `root`.
 * `version` overrides package.json's version, which is how the release plugin
 * syncs to the release it is making.
 */
export function loadSources(root, { version } = {}) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  } catch (err) {
    throw new VersionsSetupError(`could not read package.json: ${err.message}`);
  }

  const resolved = version ?? pkg.version;
  const semver = typeof resolved === "string" ? resolved.match(/^(\d+)\.\d+\.\d+/) : null;
  if (!semver) {
    throw new VersionsSetupError("package.json has no version to check pins against");
  }

  const enginesNode = pkg.engines?.node;
  if (typeof enginesNode !== "string") {
    throw new VersionsSetupError(
      "package.json has no engines.node to check node-version against",
    );
  }
  const nodeMajor = enginesNode.match(SINGLE_LOWER_BOUND)?.[1];
  if (nodeMajor === undefined) {
    throw new VersionsSetupError(
      `package.json engines.node "${enginesNode}" is not a single lower bound; node-version pins cannot be checked against it`,
    );
  }

  return {
    version: resolved,
    major: semver[1],
    enginesNode,
    nodeMajor,
    actionMajors: workflowActionMajors(root),
  };
}

/** `owner/action` (lowercased) -> the highest major any workflow `uses:`. */
function workflowActionMajors(root) {
  const dir = path.join(root, ".github", "workflows");
  const majors = new Map();
  if (!existsSync(dir)) return majors;

  const uses = /^\s*(?:-\s+)?uses:\s*(["']?)([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)@v(\d+)(?:\.\d+)*\1(?:\s|$)/;
  for (const name of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    for (const line of readFileSync(path.join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(uses);
      if (!m) continue;
      const key = m[2].toLowerCase();
      const major = Number(m[3]);
      if (!majors.has(key) || majors.get(key) < major) majors.set(key, major);
    }
  }
  return majors;
}

// ---------------------------------------------------------------------------
// Scanned files.
// ---------------------------------------------------------------------------

/** Relative posix paths of every scanned file under `root`, sorted. */
export function scannedFiles(root) {
  const files = [];
  const walk = (rel, keep) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    // `Dirent.parentPath` needs Node 20+; package.json engines.node requires >=24.
    for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = posix(path.relative(root, path.join(entry.parentPath, entry.name)));
      if (keep(file)) files.push(file);
    }
  };

  if (existsSync(path.join(root, "README.md"))) files.push("README.md");
  walk("examples", () => true);
  walk(path.join("docs", "src", "content", "docs"), (f) => /\.mdx?$/.test(f));

  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------------------
// Recognising pins.
// ---------------------------------------------------------------------------

// After a version: not more of the version, and not the rest of a word. A
// sentence-ending period is fine; `.1` is not.
const END = String.raw`(?![\w-]|\.\d)`;

const MANNI_ACTION = new RegExp(
  String.raw`(?<![\w@/.-])hawkeyexl/manni@v(\d+(?:\.\d+\.\d+)?)${END}`,
  "dgi",
);
const MANNI_NPM = new RegExp(
  String.raw`(?<![\w/-])@hawkeyexl/manni@(\d+(?:\.\d+\.\d+)?)${END}`,
  "dgi",
);
const ACTION = new RegExp(
  String.raw`(?<![\w@/.-])([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+)@v(\d+)${END}`,
  "dg",
);
const REV = /^([ \t]*(?:-[ \t]+)?)rev:[ \t]*(["']?)v(\d+(?:\.\d+\.\d+)?)\2(?=[ \t]*(?:#.*)?\r?$)/dgm;
const NODE_VERSION = /(?<![\w-])node-version:[ \t]*(["']?)(\d+)\1(?![\w.])/dg;

const REPO_NAMES_MANNI = /(?:^|[/:])hawkeyexl\/manni(?:\.git)?\/?$/i;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * Whether the YAML list item holding the `rev:` on `lines[at]` has a `repo:`
 * naming hawkeyexl/manni. `keyColumn` is where the `rev` key starts. The item
 * runs from its `- ` line to the next line indented less than its keys, and
 * never past a code fence.
 */
function revIsManni(lines, at, keyColumn) {
  const indent = (line) => line.match(/^[ \t]*/)[0].length;
  const itemStart = (line) => {
    const m = line.match(/^([ \t]*-[ \t]+)[\w-]+:/);
    return m !== null && m[1].length === keyColumn;
  };
  const namesManni = (line) => {
    const m = line.match(/^([ \t]*(?:-[ \t]+)?)repo:(.*)$/);
    if (!m || m[1].length !== keyColumn) return false;
    const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
    return REPO_NAMES_MANNI.test(value);
  };

  let start = at;
  if (!itemStart(lines[at])) {
    for (let i = at - 1; i >= 0; i--) {
      const line = lines[i];
      if (FENCE.test(line)) break;
      if (line.trim() === "") continue;
      if (indent(line) >= keyColumn) {
        start = i;
        continue;
      }
      if (itemStart(line)) start = i;
      break;
    }
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && (FENCE.test(line) || (line.trim() !== "" && indent(line) < keyColumn))) break;
    if (namesManni(line)) return true;
  }
  return false;
}

/**
 * Every pin in `text`, in source order. Each carries the offsets of its
 * version text only, the version it should be, and the words a message needs.
 */
export function findPins(text, sources) {
  const pins = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const add = (match, group, wanted, render, reason) => {
    const [start, end] = match.indices[group];
    const current = match[group];
    pins.push({
      start,
      end,
      line: lineOf(match.index),
      current,
      wanted,
      stale: current !== wanted,
      before: render(current),
      after: render(wanted),
      reason,
    });
  };

  for (const m of text.matchAll(MANNI_ACTION)) {
    const exact = m[1].includes(".");
    add(
      m,
      1,
      exact ? sources.version : sources.major,
      (v) => `hawkeyexl/manni@v${v}`,
      exact ? `package.json is ${sources.version}` : `package.json major is ${sources.major}`,
    );
  }

  for (const m of text.matchAll(MANNI_NPM)) {
    const exact = m[1].includes(".");
    add(
      m,
      1,
      exact ? sources.version : sources.major,
      (v) => `@hawkeyexl/manni@${v}`,
      exact ? `package.json is ${sources.version}` : `package.json major is ${sources.major}`,
    );
  }

  for (const m of text.matchAll(ACTION)) {
    const key = m[1].toLowerCase();
    if (key === "hawkeyexl/manni") continue; // the package rules own it
    const highest = sources.actionMajors.get(key);
    if (highest === undefined) continue; // nothing to compare with
    add(
      m,
      2,
      String(highest),
      (v) => `${m[1]}@v${v}`,
      `.github/workflows use v${highest}`,
    );
  }

  // Without the CR a CRLF line ends in, so `.` and `$` behave per line.
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  for (const m of text.matchAll(REV)) {
    const line = lineOf(m.index);
    if (!revIsManni(lines, line - 1, m[1].length)) continue;
    const q = m[2];
    add(m, 3, sources.version, (v) => `rev: ${q}v${v}${q}`, `package.json is ${sources.version}`);
  }

  for (const m of text.matchAll(NODE_VERSION)) {
    const q = m[1];
    add(
      m,
      2,
      sources.nodeMajor,
      (v) => `node-version: ${q}${v}${q}`,
      `package.json engines.node is ${sources.enginesNode}`,
    );
  }

  return pins.sort((a, b) => a.start - b.start);
}

/** `text` with every stale pin's version text replaced by the wanted one. */
export function applyPins(text, pins) {
  let out = text;
  for (const pin of [...pins].filter((p) => p.stale).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, pin.start) + pin.wanted + out.slice(pin.end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The operations the commands and the plugin share.
// ---------------------------------------------------------------------------

/** Every scanned file's pins. Throws VersionsSetupError. */
export function scanVersions(root, options) {
  const sources = loadSources(root, options);
  return scannedFiles(root).map((file) => {
    const text = readFileSync(path.join(root, file), "utf8");
    return { file, text, pins: findPins(text, sources) };
  });
}

/**
 * Rewrites every stale pin in place. Returns one edit per rewritten pin and
 * the number of files written. Throws VersionsSetupError before writing
 * anything.
 */
export function syncVersions(root, options) {
  const scanned = scanVersions(root, options);
  const edits = [];
  let files = 0;
  for (const { file, text, pins } of scanned) {
    const stale = pins.filter((p) => p.stale);
    if (stale.length === 0) continue;
    writeFileSync(path.join(root, file), applyPins(text, pins));
    files += 1;
    for (const pin of stale) edits.push({ file, line: pin.line, before: pin.before, after: pin.after });
  }
  return { edits, files };
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
