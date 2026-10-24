/**
 * What is set up, and so what `manni check` runs.
 *
 * There are no keys of the family's own. A domain is in play when its own
 * section of `manni.config.yaml` exists, or when the content carries its
 * declarations. Nothing manni would apply by default counts as set up:
 *
 * | Domain | In play when |
 * |---|---|
 * | meta | a file's schema set is more than the built-in defaults: `meta:` covers it, or it names its own `$schema` |
 * | cite | a page carries citations |
 * | lint | `lint:` exists |
 * | docevals | a page resolves evals, from `docevals:` or its own declarations |
 * | term | the collections hold a term |
 * | strategy | the collections hold a record of type audience, persona or journey |
 * | graph | `graph:` exists |
 * | tracevals | `tracevals.runtime` exists; it judges the turn a Stop or SubagentStop hook ends |
 * | a11y | never run by `check`: it needs a running site |
 * | test | never run by `check`: it runs the pages' shell steps and synthetic users |
 *
 * Only members of a declared collection are file-checked. tracevals judges a
 * turn, not files, so it needs no collection.
 */
import { relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CollectionConfig } from "../../shared/collections.js";
import {
  findFamilyConfigFile,
  readFamilyConfigFile,
  type ConfigFile,
} from "../../shared/config-file.js";
import { ToolError } from "../../shared/errors.js";
import { memberOf, retainMembers } from "../../meta/core/collections.js";
import { resolveTargetSet } from "../../meta/internal.js";

/** An operational error of `manni check` or `manni status`: exit 2. */
export class FamilyError extends ToolError {
  constructor(
    message: string,
    /** Set for the two conditions a hook answers with silence. */
    readonly quiet = false,
  ) {
    super(message);
    this.name = "FamilyError";
  }
}

export function noConfigError(cwd: string): FamilyError {
  return new FamilyError(
    `No manni.config.yaml found from ${cwd} up to the repository root. Create one there with a collections: entry for your docs.`,
    true,
  );
}

export function nothingSetUpError(): FamilyError {
  return new FamilyError(
    "Nothing is set up to check in manni.config.yaml. Run manni status to see what each domain needs.",
    true,
  );
}

/** The domains `check` can run, in the order it runs and reports them. */
export const DOMAINS = ["meta", "cite", "lint", "docevals", "term", "strategy", "graph"] as const;
export type Domain = (typeof DOMAINS)[number];

/** Each domain's check, as `check` names it. */
export const COMMANDS: Readonly<Record<Domain, string>> = {
  meta: "meta validate",
  cite: "cite check",
  lint: "lint check",
  docevals: "docevals run",
  term: "term check",
  strategy: "strategy check",
  graph: "graph check",
};

/** Why a domain is not in play, as both `check` and `status` say it. */
export const NOT_SET_UP: Readonly<Record<Domain, string>> = {
  meta: "no meta: section",
  cite: "no page carries citations",
  lint: "no lint: section",
  docevals: "no page resolves any evals",
  term: "no terms in any collection",
  strategy: "no strategy records in any collection",
  graph: "no graph: section",
};

/**
 * What would put each domain in play, as `status` says it. It is advice for
 * whoever owns the config, so the SessionStart briefing leaves it out.
 */
export const NEXT: Readonly<Record<Domain, string>> = {
  meta: "Add a meta: section that names your schemas. manni meta schemas lists the built-in ones.",
  cite: "Pin a sentence to its source with manni cite add.",
  lint: "Add a lint: section. manni lint templates lists the templates it can apply.",
  docevals: "Add a docevals: section, or declare evals in a page's frontmatter.",
  term: "Add a page with type: term to a collection.",
  strategy: "Add a page with type: journey to a collection.",
  graph: "Run manni graph init to add a starter graph: section.",
};

/** Why every domain is not set up when the config declares no collections, and what to do. */
export const NO_COLLECTIONS = "no collections: in manni.config.yaml";
export const NO_COLLECTIONS_NEXT = "Add a collections: entry that names your docs.";

/** Why `meta` skips files when `meta:` exists but covers none of them. */
export const META_DEFAULTS_ONLY = "only the built-in default schemas cover these files";

/**
 * The domains `check` does not run here: why, and what to run instead.
 * tracevals leaves this list when `tracevals.runtime` exists (`Family.runtime`).
 */
export const NOT_CHECKED: ReadonlyArray<readonly [name: string, reason: string, next: string]> = [
  ["a11y", "needs a running site and a browser", "Run manni site preview, then manni a11y check."],
  // Doc Detective runs the shell steps pages carry, so a hook never starts it.
  ["test", "runs the pages' shell steps and synthetic users", "Run manni test procedures or manni test tasks."],
  [
    "tracevals",
    "judges recorded sessions with a model",
    "Run manni tracevals run over sessions, or add tracevals.runtime to judge each turn.",
  ],
];

/** `1 page`, `2 pages`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export interface Family {
  file: ConfigFile;
  /**
   * The config each domain core is handed, so every one reads this file
   * rather than discovering its own: as typed, or as discovery found it,
   * relative to `cwd`.
   */
  configPath: string;
  /** The top-level keys of the file: `meta`, `lint`, `graph`, … */
  sections: ReadonlySet<string>;
  /** `tracevals.runtime` exists: tracevals judges each turn under the hooks. */
  runtime: boolean;
  collections: readonly CollectionConfig[];
}

function toError(message: string): FamilyError {
  return new FamilyError(message);
}

export async function loadFamily(cwd: string, configPath?: string): Promise<Family> {
  const file =
    configPath === undefined
      ? await findFamilyConfigFile(cwd, toError)
      : await readFamilyConfigFile(configPath, cwd, toError);
  if (file === null) throw noConfigError(cwd);
  // Already parsed once by the loader, which would have thrown on bad YAML.
  const doc = parseYaml(file.text) as unknown;
  const top = record(doc);
  const sections = new Set(top === undefined ? [] : Object.keys(top));
  const tracevals = record(top?.tracevals);
  // The old `conformance` key counts too. tracevals' loader refuses it and
  // names `runtime`, and only a tracevals in play loads that config, so a
  // config not yet migrated reaches `status` as an error, not as a silent skip.
  const runtime = tracevals?.runtime !== undefined || tracevals?.conformance !== undefined;
  return { file, configPath: configPath ?? file.source, sections, runtime, collections: file.collections };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A path as a label relative to `cwd`, posix, the way the domains print one. */
export function labelFrom(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/");
}

/** The collections a file at `label` (relative to `cwd`) belongs to. */
export function collectionsOf(family: Family, cwd: string, label: string): string[] {
  return memberOf(family.collections, family.file.dir, cwd, label);
}

/** Every member of every collection, labelled from `cwd`. */
export async function listMembers(family: Family, cwd: string): Promise<string[]> {
  const dir = family.file.dir;
  const { files } = await resolveTargetSet({
    inputs: family.collections.flatMap((c) => c.paths),
    cwd: dir,
    allowEmpty: true,
  });
  return retainMembers(files, (label) => memberOf(family.collections, dir, dir, label)).map(
    (label) => labelFrom(cwd, resolve(dir, label)),
  );
}
