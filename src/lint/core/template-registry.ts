/**
 * Source of truth for templates. Holds the built-in doctype templates
 * (addressed by `vendor:name:version`-style ids) and knows how to load any
 * template reference - a built-in id, a local `.yaml`/`.yml`/`.json` path, or
 * an `http(s)` URL, optionally naming one template inside a file with a `#`
 * fragment (`./templates.yaml#how-to`).
 *
 * Two ordering decisions are load-bearing:
 *
 *  - A file is dereferenced *before* it is validated. `$ref` is how a template
 *    file shares one section rule between templates, and a section rule is
 *    `additionalProperties: false`, so any `$ref` still standing at validation
 *    time would be reported as an unexpected key.
 *  - `instructions` is looked for by hand *before* Ajv runs. The schema rejects
 *    it too (`not: {required: ["instructions"]}`), but a raw schema error says
 *    nothing useful about where the feature went; scanning the parsed data
 *    directly is both more reliable than reverse-engineering which Ajv error
 *    came from the `not` keyword and the only way to quote the author's own
 *    instruction back at them in the migration snippet.
 *
 * `extends` is deliberately *not* resolved by `loadTemplate`. Inheritance needs
 * a resolver that knows what a relative ref is relative to, which only the
 * caller knows, so `resolveExtends` takes that resolver as an argument.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { packageRoot } from "../../shared/package-root.js";
import { parse as parseYaml } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import * as AjvNs from "ajv";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import { LintError } from "../types.js";
import { errorMessage } from "../../shared/errors.js";
import { warn } from "../../shared/warn.js";
import { BLOCK_KINDS, isWildcard, occurrenceRange } from "./template.js";
import type {
  BlockRule,
  ListItemsRule,
  Occurrences,
  Rule,
  Template,
  TemplateFile,
} from "./template.js";
import templateFileSchema from "../../../schemas/lint/template.json" with { type: "json" };
import tgdpManifest from "../../../templates/lint/tgdp/manifest.json" with { type: "json" };

// ajv is CommonJS with a default export; under NodeNext the constructable
// value lives on `.default`. Cast through the named default type so tsc sees a
// constructor.
type AjvCtor = typeof import("ajv").default;
const Ajv = AjvNs.default as unknown as AjvCtor;

/**
 * Options for both `dereference` calls, named so the two cannot drift apart.
 *
 * `resolve.external: false` confines `$ref` to the file it is written in. A
 * template file is untrusted input - `loadTemplateFile` will fetch one over
 * `http(s)`, and a local one is only as trustworthy as whoever wrote it, who is
 * not necessarily whoever runs the lint. The dereferencer resolves a `$ref` by
 * reading the file or making the request it names, from the linting host and
 * with its privileges. Left on, `$ref: /etc/passwd` or
 * `$ref: http://169.254.169.254/latest/meta-data/` in a template turned a lint
 * run into an arbitrary read, and a remote template into one that reports back
 * what it found.
 *
 * Nothing in the template DSL wants it. `$ref` is documented as how one file
 * shares a section rule between its own templates, and reuse *across* files is
 * what `extends` is for - which goes through `loadTemplate`, is re-based against
 * the declaring file, and is cycle-checked. Same-document (`#/...`) pointers are
 * untouched; an external one is left standing instead, and the schema then
 * rejects it as an unexpected `$ref` key rather than following it.
 */
const DEREFERENCE_OPTIONS = { resolve: { external: false } };

export interface BuiltinInfo {
  id: string;
  title: string;
  types: string[];
}

/**
 * Built-in doctype templates.
 *
 * The manifest is a JSON import, so it is bundled and `listBuiltins()` stays
 * synchronous. The templates themselves are YAML files beside it, read on
 * demand: they are meant to be opened, read, and copied by anyone writing their
 * own template, and YAML is the format that survives that. They ship at the
 * package root as `templates/lint/**`, listed in `files`, and are found by
 * walking up from this module to `package.json`, which works identically from
 * source and from the built package.
 */
interface ManifestEntry {
  id: string;
  file: string;
  title: string;
  types: string[];
  /** Upstream file this was derived from, for provenance. */
  source?: string;
}

interface Manifest {
  vendor: string;
  upstream: string;
  pin: string;
  templates: ManifestEntry[];
}

const MANIFESTS: Manifest[] = [tgdpManifest];

const BUILTINS = new Map<string, ManifestEntry>();
for (const manifest of MANIFESTS) {
  for (const entry of manifest.templates) BUILTINS.set(entry.id, entry);
}

/** Parsed built-ins, keyed by id. Populated on first load. */
const builtinCache = new Map<string, Template>();

export function listBuiltins(): BuiltinInfo[] {
  return [...BUILTINS.values()].map((entry) => ({
    id: entry.id,
    title: entry.title,
    types: entry.types,
  }));
}

/**
 * Locate a built-in's YAML at the package root.
 *
 * The templates ship as `templates/lint/**` beside `package.json`. Resolving
 * from the package root rather than from `import.meta.url` is what keeps one
 * path correct both in the repo, where this module sits under
 * `src/lint/core/`, and in the bundle, where it sits in `dist/`.
 */
async function readBuiltinFile(id: string, file: string): Promise<string> {
  const path = join(packageRoot(import.meta.url), "templates", "lint", file);
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new LintError(
      `Built-in template "${id}" is registered but its file could not be read (${path}): ${errorMessage(err)}`,
    );
  }
}

/**
 * Read, validate, and cache one built-in.
 *
 * Built-ins go through exactly the same schema validation as a user's file. A
 * template we ship is not more trustworthy than one you write - it is only
 * better tested - and a shipped template that violates its own schema should
 * fail loudly here rather than behave strangely during matching.
 */
async function loadBuiltin(id: string): Promise<Template> {
  const cached = builtinCache.get(id);
  if (cached) return cached;

  // Every caller checks `BUILTINS.has` first, so this is an internal
  // invariant rather than a user error - but it fails loudly all the same,
  // because the alternative is a `TypeError` several lines later on a field
  // of `undefined`.
  const entry = BUILTINS.get(id);
  if (!entry) {
    throw new LintError(`No built-in template is registered under "${id}".`);
  }
  const raw = await readBuiltinFile(id, entry.file);

  // The same guard `loadTemplateFile` applies to an outside file. A built-in
  // is ours and should never fail it, which is the point: if one ever does,
  // this says which file and what it held, rather than letting `dereference`
  // report something opaque about a value it did not expect.
  const parsed: unknown = parseYaml(raw);
  if (!isRecord(parsed)) {
    throw new LintError(
      `Built-in template "${id}" (${entry.file}) is not a template file: ` +
        `expected an object at the top level, got ${
          parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed
        }.`,
    );
  }

  const file = validateTemplateFile(
    await dereference<Record<string, unknown>>(parsed, DEREFERENCE_OPTIONS),
    entry.file,
  );
  const names = Object.keys(file.templates ?? {});
  const template = file.templates?.[names[0] ?? ""];
  if (!template || names.length !== 1) {
    throw new LintError(
      `Built-in template "${id}" must define exactly one template, found ${names.length}.`,
    );
  }

  // `types` lives in the manifest so the type map can be built without reading
  // every YAML file; mirror it onto the template so both agree.
  const resolved: Template = { types: entry.types, ...template };
  builtinCache.set(id, resolved);
  return resolved;
}

export type RefKind = "builtin" | "file" | "url";

/**
 * A built-in id looks like `seg(:seg)+` using only [a-z0-9._-] segments, with
 * no path separators and no template-file extension. This deliberately
 * excludes Windows paths (`C:\...`), URLs, and `.yaml`/`.yml`/`.json` files so
 * a typo'd built-in is reported as an unknown id rather than silently treated
 * as a missing file.
 */
const BUILTIN_ID = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)+$/i;

const FILE_EXTENSIONS = [".yaml", ".yml", ".json"];

export function classifyRef(ref: string): { kind: RefKind; ref: string } {
  if (/^https?:\/\//i.test(ref)) return { kind: "url", ref };
  const lower = ref.toLowerCase();
  if (
    !ref.includes("/") &&
    !ref.includes("\\") &&
    !FILE_EXTENSIONS.some((ext) => lower.endsWith(ext)) &&
    BUILTIN_ID.test(ref)
  ) {
    return { kind: "builtin", ref };
  }
  return { kind: "file", ref };
}

/** Default network timeout for fetching a remote (`http(s)`) template file. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LoadTemplateOptions {
  /** Abort a remote fetch after this many ms (default 10_000). */
  timeoutMs?: number;
}

/* -------------------------------------------------------------------------- *
 * Validation
 * -------------------------------------------------------------------------- */

// `useDefaults` is deliberately off, and the schema declares no `default`
// anywhere. A default Ajv writes into the data is indistinguishable from a
// value the author typed, so it beats the parent's real value in an `extends`
// merge. Every default in this format lives in the code that reads it
// (`occurrenceRange`), where an absent key stays absent.
const ajv = new Ajv();

let compiled: ValidateFunction | null = null;

function fileValidator(): ValidateFunction {
  compiled ??= ajv.compile(templateFileSchema as SchemaObject);
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `instructions` key found in a template file, and where it lives. */
interface InstructionsHit {
  /** Dotted path to the rule carrying it, e.g. `templates.how-to.sections.title`. */
  path: string;
  /** Suggested eval name, kebab-cased from the path. */
  name: string;
  /** The instruction strings, verbatim. */
  values: string[];
}

/** The strings in an `instructions:` value, whatever shape it was written in. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Name for the suggested eval: the path with the structural keys (`templates`,
 * `sections`) dropped, kebab-cased. `templates.how-to.sections.title` becomes
 * `how-to-title`.
 */
function suggestEvalName(segments: string[]): string {
  const name = segments
    .filter((segment) => segment !== "templates" && segment !== "sections")
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "section-instructions";
}

/**
 * First `instructions` key anywhere in a parsed template file.
 *
 * Dereferencing can make two rules share one object, and a self-referential
 * `$ref` can make the tree cyclic, hence the `seen` set.
 */
function findInstructions(
  node: unknown,
  segments: string[] = [],
  seen = new WeakSet(),
): InstructionsHit | null {
  if (typeof node !== "object" || node === null) return null;
  if (seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const hit = findInstructions(item, [...segments, String(index)], seen);
      if (hit) return hit;
    }
    return null;
  }

  const record = node as Record<string, unknown>;

  // Only a section's own `instructions` *property* is the legacy key. Inside a
  // `sections:` map the keys are section names the author chose, and a section
  // legitimately called "instructions" - TGDP's README doctype wants one - must
  // not be mistaken for it. So descend into a `sections` map without testing
  // its keys, and test the property everywhere else.
  const insideSectionsMap = segments.at(-1) === "sections";
  if (!insideSectionsMap && "instructions" in record) {
    return {
      path: segments.join("."),
      name: suggestEvalName(segments),
      values: stringsOf(record.instructions),
    };
  }
  for (const [key, value] of Object.entries(record)) {
    const hit = findInstructions(value, [...segments, key], seen);
    if (hit) return hit;
  }
  return null;
}

/**
 * The message a template still carrying `instructions` gets: what replaced the
 * feature, and the config to paste, with the author's own instruction in it.
 */
function instructionsMessage(source: string, hit: InstructionsHit): string {
  const assertion = hit.values[0] ?? "";
  return [
    `${source}: "${hit.path}" uses \`instructions\`, which manni lint no longer evaluates — structure checking is deterministic. Move it to a manni docevals assertion eval in manni.config.yaml:`,
    "",
    "  docevals:",
    "    evals:",
    `      ${hit.name}:`,
    `        assertion: ${assertion}`,
    "        grader: ai",
  ].join("\n");
}

/* -------------------------------------------------------------------------- *
 * Refusing a v1 file
 *
 * v1 never shipped, so there is no migration mode and no alias. What there is
 * instead is a sentence per key naming the v2 spelling, because a v1 file is
 * what anyone who tried the format early still has on disk. Left to the schema
 * these all read as "must NOT have additional properties", which says nothing
 * about where the key went.
 *
 * The scan runs before Ajv, for the same reason the `instructions` scan does.
 * -------------------------------------------------------------------------- */

/** v1 keys that are gone outright, and what to write instead. */
const V1_KEYS: Record<string, string> = {
  required: '"required" is not a template key. A rule is optional with "min: 0".',
  additionalSections:
    '"additionalSections" is not a template key. v2 has no equivalent, so drop it.',
  code_blocks: '"code_blocks" is not a template key. The v2 spelling is "codeBlocks".',
};

const V1_SECTIONS_MAP =
  '"sections" is a list of rules, not a map. Name each rule with "id" and list them in order.';

const V1_REPEAT_BOOLEAN =
  '"repeat" is a list of rules, not a boolean. A rule repeats through "min" and "max".';

const V1_PARAGRAPH_PATTERNS =
  '"patterns" is not a paragraphs key. The v2 spelling is "pattern", one regular expression.';

/**
 * The first v1 key anywhere under `templates` or `components`.
 *
 * `info` is skipped: it is free-form by contract, so a key of one of these
 * names in it is the author's own metadata rather than a template rule.
 *
 * A node carrying a `sections` *map* returns before its children are walked.
 * Inside such a map the keys are section names the author chose, and a v1
 * template with a section named `required` must not be reported as using the
 * `required` key.
 */
function findV1Key(node: unknown, seen = new WeakSet()): string | null {
  if (typeof node !== "object" || node === null) return null;
  if (seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findV1Key(item, seen);
      if (hit) return hit;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  for (const [key, message] of Object.entries(V1_KEYS)) {
    if (key in record) return message;
  }
  if (isRecord(record.sections)) return V1_SECTIONS_MAP;
  if (typeof record.repeat === "boolean") return V1_REPEAT_BOOLEAN;
  if (isRecord(record.paragraphs) && "patterns" in record.paragraphs) {
    return V1_PARAGRAPH_PATTERNS;
  }

  for (const value of Object.values(record)) {
    const hit = findV1Key(value, seen);
    if (hit) return hit;
  }
  return null;
}

function findV1File(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return findV1Key(data.templates) ?? findV1Key(data.components);
}

/* -------------------------------------------------------------------------- *
 * Checks JSON Schema cannot express
 *
 * Three of these compare two siblings, which draft-07 has no keyword for, and
 * one compiles a regular expression, which it has no opinion about. The fifth
 * is a warning rather than an error: the template is legal, and only its author
 * can say whether the ambiguity is intended.
 * -------------------------------------------------------------------------- */

/** How a rule is named in a message: its id where it has one, else its path. */
function ruleLabel(rule: Rule, path: string): string {
  return rule.id === undefined ? path : `"${rule.id}"`;
}

/**
 * `max` below `min`, where the author wrote both.
 *
 * Only where both are written. `min` defaults to one, so comparing against the
 * default would refuse `max: 0`, which is how the format spells "none of
 * these".
 */
function checkRange(range: Occurrences, source: string, label: string): void {
  const { min, max } = range;
  if (min !== undefined && max !== undefined && max < min) {
    throw new LintError(`${source}: rule ${label} sets max ${max} below min ${min}.`);
  }
}

/**
 * Whether two rules claim the same occurrence range, the one comparison the
 * ambiguity warning below needs. Compares what `occurrenceRange` resolves
 * `min`/`max` to, not the raw (possibly absent) fields, so a written `min: 1`
 * and an absent `min` - both one occurrence by default - count as the same.
 */
function sameOccurrenceRange(a: Occurrences, b: Occurrences): boolean {
  const rangeA = occurrenceRange(a);
  const rangeB = occurrenceRange(b);
  return rangeA.min === rangeB.min && rangeA.max === rangeB.max;
}

/** Compile an author's pattern here, so a broken one names the file it is in. */
function checkPattern(pattern: string | undefined, source: string): void {
  if (pattern === undefined) return;
  try {
    new RegExp(pattern);
  } catch (err) {
    throw new LintError(
      `Invalid pattern "${pattern}" in ${source}: ${errorMessage(err)}.`,
    );
  }
}

function checkListItems(items: ListItemsRule, source: string, path: string): void {
  checkRange(items, source, path);
  if (items.contains) checkBlockRule(items.contains, source, `${path}.contains`);
  items.sequence?.forEach((entry, index) => {
    checkBlockRule(entry, source, `${path}.sequence[${index}]`);
  });
}

function checkBlockRule(block: BlockRule, source: string, path: string): void {
  for (const kind of BLOCK_KINDS) {
    const counted: Occurrences | undefined = block[kind];
    if (counted) checkRange(counted, source, `${path}.${kind}`);
  }
  checkPattern(block.paragraphs?.pattern, source);
  if (block.lists?.items) {
    checkListItems(block.lists.items, source, `${path}.lists.items`);
  }
  const element = block.elements;
  if (element?.contains) {
    checkBlockRule(element.contains, source, `${path}.elements.contains`);
  }
  element?.sequence?.forEach((entry, index) => {
    checkBlockRule(entry, source, `${path}.elements.sequence[${index}]`);
  });
}

/** Everything a rule and a template share. A template is a rule. */
function checkRuleBody(rule: Rule, source: string, path: string): void {
  const heading = rule.heading;
  if (typeof heading === "object" && !Array.isArray(heading)) {
    checkPattern(heading.pattern, source);
  }
  if (rule.contains) checkBlockRule(rule.contains, source, `${path}.contains`);
  rule.sequence?.forEach((entry, index) => {
    checkBlockRule(entry, source, `${path}.sequence[${index}]`);
  });
  checkRuleList(rule.repeat, source, `${path}.repeat`);
  checkRuleList(rule.sections, source, `${path}.sections`);
}

/**
 * One list of sibling rules: their ids, their ranges, and whether two
 * neighbours are told apart by nothing but their order.
 */
function checkRuleList(rules: Rule[] | undefined, source: string, path: string): void {
  if (!rules) return;

  const ids = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const here = `${path}[${index}]`;
    if (rule.id !== undefined) {
      if (ids.has(rule.id)) {
        throw new LintError(`${source}: two sibling rules share the id "${rule.id}".`);
      }
      ids.add(rule.id);
    }
    checkRange(rule, source, ruleLabel(rule, here));
    checkRuleBody(rule, source, here);
  }

  // A warning, not an error. Two adjacent wildcards are how TGDP's "{Task
  // name}" then "{Next task}" is written, and that is legal. It is also how a
  // template accidentally describes one section twice, and nothing in the file
  // distinguishes the two cases - unless their occurrence ranges differ, in
  // which case the matcher can still tell them apart: one claims a fixed count
  // of sections and the other claims however many are left. That is
  // `reference-description` (`max: 1`) next to `structured-entry` (`min: 0`,
  // no `max`) in tgdp:reference - legal and unambiguous, so only a shared range
  // is flagged.
  for (const [index, rule] of rules.entries()) {
    const next = rules[index + 1];
    if (!next) break;
    if (
      isWildcard(rule) &&
      rule.repeat === undefined &&
      isWildcard(next) &&
      next.repeat === undefined &&
      sameOccurrenceRange(rule, next)
    ) {
      warn(
        `${source}: two adjacent rules have no heading and no repeat; only rule order tells them apart.`,
      );
      break;
    }
  }
}

/** The checks that run over a validated file, template by template. */
function checkTemplateFile(file: TemplateFile, source: string): void {
  for (const [name, template] of Object.entries(file.templates ?? {})) {
    if (template.min !== undefined || template.max !== undefined) {
      throw new LintError(
        `${source}: a template may not set min or max; a page is one page.`,
      );
    }
    checkRuleBody(template, source, `templates.${name}`);
  }
}

/** `/templates/how-to/sections/title must NOT have additional properties (foo)`. */
function describeError(error: ErrorObject): string {
  const params = error.params as { additionalProperty?: unknown };
  const extra =
    typeof params.additionalProperty === "string" ? ` ("${params.additionalProperty}")` : "";
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}${extra}`;
}

/**
 * Validate a parsed, dereferenced template file, filling in rule defaults.
 *
 * Throws `LintError` naming `source` and the offending instance path. The
 * pre-rewrite loader threw a bare "Template is invalid" and passed the real
 * detail as `new Error(msg, {message: ...})` - an options bag that only
 * understands `cause` - so every schema error reached the user as four words.
 */
export function validateTemplateFile(data: unknown, source: string): TemplateFile {
  const instructions = findInstructions(data);
  if (instructions) throw new LintError(instructionsMessage(source, instructions));

  // Before Ajv, so a v1 file is told where its keys went rather than that it
  // has additional properties.
  const v1 = findV1File(data);
  if (v1) throw new LintError(`${source}: ${v1}`);

  const validate = fileValidator();
  if (!validate(data)) {
    const errors = validate.errors ?? [];
    const detail = errors.map(describeError).join("; ") || "does not match the template schema";
    throw new LintError(`${source} is not a valid template file: ${detail}.`);
  }
  const file = data as TemplateFile;
  checkTemplateFile(file, source);
  return file;
}

/* -------------------------------------------------------------------------- *
 * Loading
 * -------------------------------------------------------------------------- */

/** Split `./templates.yaml#how-to` into its file part and template name. */
function splitFragment(ref: string): { base: string; fragment: string | null } {
  const hash = ref.lastIndexOf("#");
  if (hash === -1) return { base: ref, fragment: null };
  return { base: ref.slice(0, hash), fragment: ref.slice(hash + 1) || null };
}

/** The part of a ref an extension should be read off - a URL's path, not its query. */
function extensionSource(ref: string, kind: RefKind): string {
  if (kind !== "url") return ref;
  try {
    return new URL(ref).pathname;
  } catch {
    return ref;
  }
}

/**
 * Parse a template file by extension. Anything unrecognized is parsed as YAML,
 * which is a superset of JSON, so an extensionless URL still loads.
 */
function parseTemplateFile(raw: string, source: string, kind: RefKind): unknown {
  const lower = extensionSource(source, kind).toLowerCase();
  if (lower.endsWith(".json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      throw new LintError(`${source} is not valid JSON: ${errorMessage(err)}`);
    }
  }
  try {
    return parseYaml(raw) as unknown;
  } catch (err) {
    throw new LintError(`${source} is not valid YAML: ${errorMessage(err)}`);
  }
}

/**
 * Read a local template file, saying which way the read failed.
 *
 * Every failure used to be reported as "not found", which is the one wording
 * that contradicts `ls -la`: a directory named `templates.yaml` (EISDIR), a
 * file the user cannot open (EACCES), and a process out of descriptors
 * (EMFILE) are three different problems with three different fixes, and the
 * reader was sent after a path that is plainly there. Only ENOENT is a missing
 * file; anything else keeps the OS's own message.
 */
async function readText(ref: string): Promise<string> {
  try {
    return await readFile(ref, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      throw new LintError(`Template file not found: "${ref}".`);
    }
    throw new LintError(
      `Template file "${ref}" could not be read: ${errorMessage(err)}`,
    );
  }
}

const urlCache = new Map<string, TemplateFile>();

/**
 * Drop the parsed-template caches.
 *
 * Nothing in the CLI needs this: a process lints one docset and exits, and the
 * caches are what keep a tree of one doctype from re-reading and re-validating
 * the same template per page. It exists for the other caller - a long-lived
 * process using this as a library - where the two behave differently: the
 * memory grows with the number of distinct refs seen, and a `urlCache` entry
 * for a remote template is served for the life of the process, so a template
 * republished upstream is never picked up.
 */
export function clearTemplateCaches(): void {
  builtinCache.clear();
  urlCache.clear();
}

async function fetchText(ref: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ref, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new LintError(
        `Failed to fetch template file "${ref}": timed out after ${timeoutMs}ms.`,
      );
    }
    throw new LintError(`Failed to fetch template file "${ref}": ${e.message}`);
  }
  if (!res.ok) {
    throw new LintError(`Failed to fetch template file "${ref}": HTTP ${res.status}.`);
  }
  return await res.text();
}

/** Resolve every `$ref` in place, so validation never sees one. */
async function dereferenceTemplates(
  data: Record<string, unknown>,
  source: string,
): Promise<Record<string, unknown>> {
  try {
    return await dereference<Record<string, unknown>>(data, DEREFERENCE_OPTIONS);
  } catch (err) {
    throw new LintError(`${source}: could not resolve a "$ref": ${errorMessage(err)}`);
  }
}

/** Load, dereference, and validate a whole template file. */
export async function loadTemplateFile(
  ref: string,
  options: LoadTemplateOptions = {},
): Promise<TemplateFile> {
  const { kind } = classifyRef(ref);
  if (kind === "builtin") {
    throw new LintError(
      `"${ref}" is a built-in template id, not a template file. Load it with loadTemplate().`,
    );
  }

  const cached = kind === "url" ? urlCache.get(ref) : undefined;
  if (cached) return cached;

  const raw =
    kind === "url"
      ? await fetchText(ref, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      : await readText(ref);

  const parsed = parseTemplateFile(raw, ref, kind);
  if (!isRecord(parsed)) {
    throw new LintError(
      `${ref} is not a template file: expected an object at the top level, got ${
        parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed
      }.`,
    );
  }

  const file = validateTemplateFile(await dereferenceTemplates(parsed, ref), ref);
  if (kind === "url") urlCache.set(ref, file);
  return file;
}

/**
 * Resolve a single template.
 *
 * A built-in id names one directly. A file or URL may name one inside itself
 * with a `#` fragment; without a fragment a single-template file resolves
 * unambiguously and anything else is an error listing what is on offer.
 *
 * `extends` is left unresolved - see `resolveExtends`.
 */
export async function loadTemplate(
  ref: string,
  options: LoadTemplateOptions = {},
): Promise<Template> {
  const { base, fragment } = splitFragment(ref);
  const { kind } = classifyRef(base);

  if (kind === "builtin") {
    // A fragment here was silently dropped, so `tgdp:how-to:1.6#typo` loaded
    // `tgdp:how-to:1.6` and succeeded - the same quiet-wrong-answer as the
    // prototype lookup below, where a configuration error selects a different
    // template than the author wrote and nothing says so. A built-in id names
    // exactly one template, so there is nothing a fragment could select.
    if (fragment !== null) {
      throw new LintError(
        `"${ref}" adds a "#${fragment}" fragment to a built-in template id. ` +
          `A built-in id names one template on its own - drop the fragment and ` +
          `use "${base}". Fragments name a template inside a file, as in ` +
          `"./templates.yaml#how-to".`,
      );
    }
    if (!BUILTINS.has(base)) {
      const available = [...BUILTINS.keys()].join(", ");
      throw new LintError(
        `Unknown built-in template "${base}". Available: ${available || "(none)"}.`,
      );
    }
    return loadBuiltin(base);
  }

  const file = await loadTemplateFile(base, options);
  const templates = file.templates ?? {};
  const names = Object.keys(templates);

  if (fragment !== null) {
    // An own-property check, not a truthiness test on the lookup. `templates`
    // is a plain object parsed from YAML, so `#constructor` and `#toString`
    // name members it inherits from `Object.prototype`. Those are truthy, so
    // such a fragment sailed past this guard and a function came back as a
    // template - one with no `sections`, which checks the document against
    // nothing. The bad fragment therefore produced silence rather than an
    // error: the page was reported as passing, not as naming a template that
    // does not exist.
    const named = Object.hasOwn(templates, fragment)
      ? templates[fragment]
      : undefined;
    if (named === undefined) {
      throw new LintError(
        `${base} has no template named "${fragment}". Available: ${names.join(", ") || "(none)"}.`,
      );
    }
    return named;
  }

  const [only] = Object.values(templates);
  if (names.length === 1 && only !== undefined) return only;
  if (names.length === 0) throw new LintError(`${base} defines no templates.`);
  throw new LintError(
    `${base} defines ${names.length} templates; name one with a "#" fragment ` +
      `(e.g. "${base}#${names[0] ?? ""}"). Available: ${names.join(", ")}.`,
  );
}

/* -------------------------------------------------------------------------- *
 * Inheritance
 * -------------------------------------------------------------------------- */

/** How `resolveExtends` turns an `extends` ref into a template. */
export type TemplateResolver = (ref: string) => Promise<Template>;

/**
 * Merge a child template onto its parent.
 *
 * Recursion follows `sections` and stops there. A rule's own keys are units:
 * overriding `contains` means replacing it, not merging a child's `min` into
 * the parent's `max` and hoping the pair still means something. But `sections`
 * is a container, not a rule. Replacing it wholesale would mean that tightening
 * one nested rule silently discards every sibling the parent declared, which is
 * the opposite of what `extends` is for.
 *
 * `sections` is a list in v2, so "merges by key" now means "merges by `id`". A
 * child rule carrying an id the parent also uses replaces that rule where the
 * parent had it, keeping the parent's order. A child rule with no id, or with
 * an id the parent does not use, is appended. Every other key the child sets
 * replaces the parent's outright, `repeat` included: a repeated run is one
 * unit, and merging two of them by position would be guesswork.
 */
function mergeRuleLists(
  parent: Rule[] | undefined,
  child: Rule[] | undefined,
): Rule[] | undefined {
  if (!parent) return child;
  if (!child) return parent;

  // Parent order first, so inherited rules keep the document order the parent
  // declared and child-only additions land at the end.
  const merged: Rule[] = [...parent];
  for (const childRule of child) {
    const id = childRule.id;
    const index =
      id === undefined ? -1 : merged.findIndex((rule) => rule.id === id);
    const target = index === -1 ? undefined : merged[index];
    if (target === undefined) merged.push(childRule);
    else merged[index] = mergeRules(target, childRule);
  }
  return merged;
}

function mergeRules(parent: Rule, child: Rule): Rule {
  const merged: Rule = { ...parent, ...child };
  const sections = mergeRuleLists(parent.sections, child.sections);
  if (sections) merged.sections = sections;
  return merged;
}

function mergeTemplates(parent: Template, child: Template): Template {
  const merged: Template = { ...parent, ...child };
  const sections = mergeRuleLists(parent.sections, child.sections);
  if (sections) merged.sections = sections;
  // The chain is resolved; leaving `extends` on would invite resolving twice.
  delete merged.extends;
  return merged;
}

/**
 * Resolve a template's `extends` chain, innermost first.
 *
 * `load` is injected because a relative `extends` is relative to the file the
 * child came from, which this function has no way to know. `chain` is internal
 * bookkeeping for cycle detection.
 */
export async function resolveExtends(
  template: Template,
  load: TemplateResolver = loadTemplate,
  chain: string[] = [],
): Promise<Template> {
  const parentRef = template.extends;
  if (parentRef === undefined) return template;

  if (chain.includes(parentRef)) {
    throw new LintError(
      `Template "extends" cycle: ${[...chain, parentRef].join(" -> ")}.`,
    );
  }

  const parent = await resolveExtends(await load(parentRef), load, [...chain, parentRef]);
  return mergeTemplates(parent, template);
}

/* -------------------------------------------------------------------------- *
 * Resolution relative to the declaring file
 * -------------------------------------------------------------------------- */

/**
 * Re-base a ref against the file that declared it.
 *
 * A built-in id, a URL, and an absolute path all name themselves and are
 * returned unchanged. A relative path means "beside the file I am written in",
 * which is the one reading `loadTemplate` cannot produce on its own - it reads
 * against the process working directory, so `extends: ./base.yaml` in
 * `tpl/house.yaml` looked for `./base.yaml` at the cwd and found either nothing
 * or, worse, an unrelated file of that name.
 */
export function refRelativeTo(baseRef: string, ref: string): string {
  const { base, fragment } = splitFragment(ref);
  if (classifyRef(base).kind !== "file" || isAbsolute(base)) return ref;

  const { base: fromBase } = splitFragment(baseRef);
  const from = classifyRef(fromBase).kind;

  // A template fetched over HTTP names its neighbours the same way a local one
  // does, and `./base.yaml` beside it is a URL, not a path. Resolved as a path
  // it became a read of the process working directory - a local file quietly
  // standing in for the remote one, or a "file not found" naming a path that
  // appears nowhere in the template.
  if (from === "url") {
    const rebased = new URL(base, fromBase).href;
    return fragment === null ? rebased : `${rebased}#${fragment}`;
  }

  if (from !== "file") return ref;

  const rebased = resolvePath(dirname(fromBase), base);
  return fragment === null ? rebased : `${rebased}#${fragment}`;
}

/**
 * Load a template with its `extends` chain resolved, re-basing each relative
 * ref against the file that declared it.
 *
 * This is what a caller should use. `resolveExtends` stays exported for callers
 * that supply their own resolver, but its default is the cwd-relative
 * `loadTemplate`, and reaching that default silently is the bug this exists to
 * avoid - `.then(resolveExtends)` passes one argument, so the default is
 * exactly what you get.
 */
export async function loadResolvedTemplate(
  ref: string,
  options: LoadTemplateOptions = {},
  chain: string[] = [],
): Promise<Template> {
  // Seeded with this ref when the caller started here, so the reported cycle
  // starts where the reader did. Chained from the parent only, `a -> b -> a`
  // was reported as `b -> a -> b`: the file the run was pointed at never
  // appeared in the cycle it was said to be part of, which is the one name in
  // the message the reader can act on.
  const seen = chain.length === 0 ? [ref] : chain;
  const template = await loadTemplate(ref, options);
  const parentRef = template.extends;
  if (parentRef === undefined) return template;

  const absolute = refRelativeTo(ref, parentRef);
  if (seen.includes(absolute)) {
    throw new LintError(
      `Template "extends" cycle: ${[...seen, absolute].join(" -> ")}.`,
    );
  }

  const parent = await loadResolvedTemplate(absolute, options, [
    ...seen,
    absolute,
  ]);
  return mergeTemplates(parent, template);
}
