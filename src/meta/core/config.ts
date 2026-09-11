/**
 * Optional lightweight YAML config: the `meta:` section of the family file
 * (`manni.config.yaml`), or the whole of a pre-family `docmeta.config.yaml`.
 * Supplies the default schema set and optional per-glob or per-collection
 * overrides, so CI can run a bare `manni meta validate`. Which documents exist
 * is not here: proposal 0041 moved that to the family-level `collections:`.
 *
 * Finding the file is shared with every tool under the umbrella
 * (src/shared/config-file.ts); what the section may contain is decided here.
 */
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DocmetaError } from "../types.js";
import {
  findConfigFile,
  readConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { findGitRoot } from "../../shared/git-root.js";
import {
  selectCollections,
  type CollectionConfig,
} from "../../shared/collections.js";
import { FILE_SCHEMA_KEY, rebaseConfigSchemaRefs } from "./resolve-schema.js";
import { classifyRef } from "./schema-registry.js";
import { INTEGRITY_SHAPE, isIntegrity } from "./integrity.js";
import { parseElementPath } from "../extractors/element-key.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  isBuiltinField,
  isDeriveSource,
  type BuiltinDerivableField,
  type DerivableField,
  type DeriveSource,
} from "./derive/types.js";
import { errorMessage } from "../../shared/errors.js";

export interface SchemaOverride {
  /**
   * The glob, or globs, this override governs. A file matches when **any** of
   * them matches, so a list groups path shapes that brace expansion cannot
   * express as one pattern: a per-skill `SKILL.md` one directory down and a
   * flat `.claude/agents` file share a schema set but have no common stem.
   *
   * Kept as written rather than normalized to a list, because a programmatic
   * caller may hand `runValidate` a config object it built itself, and that
   * caller's bare string must keep working. Read it through `overrideGlobs`
   * rather than directly — that is the one place the two shapes collapse.
   *
   * Optional since proposal 0041: an entry carries **exactly one** of `files`
   * or `collection`.
   */
  files?: string | string[];
  schemas: string[];
  /**
   * The collection this override governs (proposal 0041), in place of globs of
   * its own: it matches the members of the named collection, which are decided
   * once, at the top level of the family file, for every tool. Must name a
   * collection `collections:` defines — checked by `loadConfig`, which is the
   * first place both halves of the file are known.
   *
   * This is what `overrides[].name` was for under 0027, inverted: a collection
   * is the thing that has a name, and an override points at it.
   */
  collection?: string;
  /**
   * Extra element paths for files matching `files`. Unlike `schemas`, which the
   * first matching override *replaces* because a schema set is a complete
   * statement, these accumulate: every matching override contributes, on top of
   * the top-level `elements:`. A list of extra places to look is additive by
   * nature, and an override that silently dropped the repo-wide ones would be a
   * trap.
   */
  elements?: string[];
}

/**
 * A `schemas:` entry in its long form: a reference plus where it came from and
 * what it must hash to.
 *
 * Written by `manni meta schemas vendor`, which downloads a remote schema into the
 * repository and records both. `source` keeps the provenance the URL used to
 * carry, so a re-vendor knows where to look and an error can say what to
 * re-download; `integrity` makes an edited or corrupted copy a loud failure
 * rather than a silently changed contract.
 */
export interface SchemaRefEntry {
  /** What is loaded: a built-in id, a local `.json` path, or a URL. */
  ref: string;
  /** Where `ref` was vendored from — a URL, or a path for a local copy. */
  source?: string;
  /** `sha256-<64 hex>` over the bytes of `ref`. Local files only. */
  integrity?: string;
}

/**
 * One `schemas:` entry. A bare string is the original form and is unchanged by
 * 0008; the mapping form adds provenance and a pin.
 */
export type SchemaEntry = string | SchemaRefEntry;

/** The keys a `schemas:` mapping entry may carry. */
const SCHEMA_ENTRY_KEYS = ["ref", "source", "integrity"] as const;

/**
 * What a **document** is allowed to name in its own `$schema`.
 *
 * - `any` — the default, and today's behavior: a built-in id, a file in the
 *   repository, or a URL. `schemaTrust.hosts` narrows the URL case.
 * - `local` — a built-in id or a file in the repository; a URL is refused.
 * - `none` — the document's `$schema` is ignored and config decides, with a
 *   notice on stderr naming the file whose key was dropped.
 */
export type DocumentRefTrust = "any" | "local" | "none";

/** The values `schemaTrust.documentRefs` accepts, in the order documented. */
export const DOCUMENT_REF_TRUST = ["any", "local", "none"] as const;

/**
 * How far a **document** is trusted to choose the contract it is judged by.
 *
 * Nothing here touches a ref an *operator* supplied: `schemas:`,
 * `overrides[].schemas`, and `-s/--schema` are never filtered, in any mode. A
 * person who can edit the config or pass a flag is not the attacker this key
 * has in mind — a pull request against a public docs repo is.
 */
export interface SchemaTrustConfig {
  /** Defaults to `any`, which is exactly what docmeta has always done. */
  documentRefs?: DocumentRefTrust;
  /**
   * Hosts a document-supplied URL may name. Consulted **only** under
   * `documentRefs: any`; absent means any host, as before.
   *
   * A convenience for pointing at one known publisher, not a security
   * boundary: `fetch` follows redirects, so an allowlisted host that answers
   * `302` sends the fetch anywhere it likes. A repo that genuinely distrusts
   * its contributors wants `documentRefs: local`.
   */
  hosts?: string[];
}

/** The keys a `schemaTrust:` mapping may carry. */
const SCHEMA_TRUST_KEYS = ["documentRefs", "hosts"] as const;

/** The keys a `schemaCache:` mapping may carry. */
const SCHEMA_CACHE_KEYS = ["ttlHours"] as const;

/**
 * Validate an `elements:` list, rejecting a path that cannot produce a key.
 *
 * Parsed here rather than at extraction so a typo is an error when the config
 * loads, naming the file and the key. Left to extraction it would be a silent
 * no-op: the path would match nothing, no key would appear, and the check the
 * author thought they had configured would simply never run.
 */
function asElementPaths(
  value: unknown,
  where: string,
  source: string,
): string[] {
  const list = asStringList(value, where, source);
  for (const path of list) {
    try {
      parseElementPath(path);
    } catch (err) {
      throw new DocmetaError(`${source}: ${where} — ${errorMessage(err)}`);
    }
  }
  return list;
}

/** The keys one `overrides:` entry may carry. */
const OVERRIDE_KEYS = ["collection", "files", "schemas", "elements"] as const;

/**
 * One named corpus check (proposal 0026): SQL run over the `docs` projection
 * by `validate`, whose result rows are findings under the id `check:<name>`.
 */
export interface CheckConfig {
  /** The check's name — the durable half of its findings' identity. */
  name: string;
  /** One SQL statement whose rows follow the finding column convention. */
  query: string;
}

/** The keys one `checks:` entry may carry. */
const CHECK_KEYS = ["name", "query"] as const;

/**
 * One `derive.commands` entry: a program to run for a field's value, as the
 * config spells it. `run` is the argv, the program first; `timeout` is in
 * seconds. The derive context carries the parsed form, `DeriveCommand`.
 */
export interface DeriveCommandConfig {
  run: string[];
  timeout?: number;
}

/**
 * The derived channel: managed fields `manni meta derive` stamps from git
 * history, CODEOWNERS, the review record on GitHub or GitLab, or a configured
 * command, and `validate` checks for drift.
 */
export interface DeriveConfig {
  /**
   * The managed fields. Each is one of `DERIVABLE_FIELDS` or a key of
   * `commands`, never `$schema`, and never a key a manifest owns: a value
   * with two authorities has none.
   */
  fields: DerivableField[];
  /** Which sources to consult; absent means all of `DERIVE_SOURCES`. */
  sources?: DeriveSource[];
  /**
   * CODEOWNERS path, relative to the config file's directory, when it is not
   * in one of the places the codeowners source looks by itself. Checked for
   * existence at run time, not here.
   */
  codeowners?: string;
  /**
   * The `command` source's table, by the field each command derives. A key
   * is never a built-in field, `$schema`, or a key a manifest owns.
   */
  commands?: Record<string, DeriveCommandConfig>;
}

/** The keys a `derive:` mapping may carry. */
const DERIVE_KEYS = ["fields", "sources", "codeowners", "commands"] as const;

/** The keys one `derive.commands` entry may carry. */
const DERIVE_COMMAND_KEYS = ["run", "timeout"] as const;

/** Which built-in source claims each built-in field, as a refusal names it. */
const BUILTIN_CLAIMED_BY: Readonly<Record<BuiltinDerivableField, string>> = {
  created: "git",
  "last-updated": "git",
  authors: "git",
  owner: "codeowners",
  "reviewed-by": "GitHub or GitLab",
  "last-reviewed": "GitHub or GitLab",
};

/**
 * The `derived` table's own columns, which a command key may not be spelled
 * like: the view is `_path`, the derivable fields, then `_sources`.
 */
const DERIVED_TABLE_RESERVED: ReadonlySet<string> = new Set(["_path", "_sources"]);

/** The tail every not-derivable message ends with. */
const DERIVABLE_LIST = `Derivable fields: ${DERIVABLE_FIELDS.join(", ")}, or any key with an entry in derive.commands.`;

/**
 * The grammar a check's name must satisfy: one built-in id *segment*.
 *
 * Not taste. The finding's `schema` field carries `check:<name>` and the
 * baseline canonicalizes that field through `classifyRef` before
 * fingerprinting — so the name must make `check:<name>` classify as a builtin
 * id (`BUILTIN_ID`, schema-registry.ts). A name with a space, a slash, or a
 * `.json` tail would classify as a **file path** and be resolved cwd-relative:
 * a fingerprint that changes with the directory you run from, the exact bug
 * `canonicalSchemaRef` exists to prevent. Enforced at parse time so the
 * failure names the config line, not a baseline mismatch three runs later.
 *
 * Exported for `checkSchemaRef`, which asserts the same grammar for
 * programmatic `CheckConfig` callers that never pass through this parser.
 */
export const CHECK_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Check names a config may not claim, each with why.
 *
 * `query` is reserved: `manni meta query --check` files its ad-hoc findings as
 * the pseudo-check `check:query`, and a configured check with that name would
 * mint the identical rule id — two different rules sharing one baseline
 * identity. `derive` is reserved beside it: `manni meta derive` is a verb of
 * its own with its own finding identity (`derived:stale`), and a check
 * reporting as `check:derive` would read as that verb's findings.
 */
const RESERVED_CHECK_NAMES = new Map<string, string>([
  [
    "query",
    "`manni meta query --check` files its ad-hoc findings as check:query, and a configured check with the same name would share their identity",
  ],
  [
    "derive",
    "`manni meta derive` is a verb of its own, and a check reporting as check:derive would read as its findings",
  ],
]);

/** The keys a `fill:` mapping may carry. */
const FILL_KEYS = [
  "provider",
  "model",
  "confidenceThreshold",
  "maxTurns",
  "chunkChars",
  "concurrency",
] as const;

/**
 * The keys the config's top level may carry.
 *
 * Adding a key to `DocmetaConfig` means adding it here too, or a config using
 * it is rejected. That coupling is the point: the alternative is the silence
 * this list exists to end.
 */
const CONFIG_KEYS = [
  "schemas",
  "overrides",
  "checks",
  "derive",
  "baseline",
  "allowEmpty",
  "respectGitignore",
  "offline",
  "schemaCache",
  "schemaTrust",
  "fill",
  "elements",
] as const;

/**
 * Reject any key outside `allowed`, naming what was supported.
 *
 * One helper so every level of the config reports a typo the same way. A key
 * the parser does not recognize is dropped in silence otherwise, which is the
 * failure this whole class of check exists to prevent: a misspelled
 * `schemaTust:` leaves a repository that reads as guarded and is not, and a
 * misspelled `intergrity:` leaves a schema that reads as pinned and is not.
 * Neither produces a diagnostic anywhere, at any verbosity.
 *
 * `where` names the mapping as the user would recognize it — `"schemaTrust"`,
 * `schemas[0]`, or `the top level`.
 */
function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new DocmetaError(
        `${source}: ${where} has unknown key "${key}". Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/** Defaults for the `fill` command; every key is overridable by a CLI flag. */
export interface FillConfig {
  provider?: string;
  model?: string;
  /** Minimum self-reported confidence to write a value (0-1). */
  confidenceThreshold?: number;
  /** Stop after this many inference calls. Counts calls, not files. */
  maxTurns?: number;
  /** Characters of document per call. Default 12000. */
  chunkChars?: number;
  concurrency?: number;
}

/** Settings for the cross-run cache of schemas fetched over `http(s)`. */
export interface SchemaCacheConfig {
  /**
   * Hours a cached schema is served before it is re-fetched. `0` disables the
   * cache entirely, in both directions.
   */
  ttlHours?: number;
}

/**
 * Upper bound on `schemaCache.ttlHours` — one year.
 *
 * Not tidiness: freshness compares elapsed time against `ttlHours * 3_600_000`,
 * and a finite-but-enormous value overflows that product to `Infinity`, so no
 * entry is ever older than the limit and the cache silently stops expiring.
 * `Number.isFinite` alone does not catch it, because `1e308` is finite.
 */
const MAX_TTL_HOURS = 8760;

export interface DocmetaConfig {
  /**
   * The default schema set. Each entry is either a reference string or a
   * `{ ref, source?, integrity? }` mapping — see `SchemaEntry`.
   */
  schemas?: SchemaEntry[];
  overrides?: SchemaOverride[];
  /**
   * Named corpus checks `validate` runs after the per-file schemas, when the
   * run's file set is the config-resolved corpus. See `CheckConfig`.
   */
  checks?: CheckConfig[];
  /**
   * The managed fields `derive` stamps and `validate` checks for drift. See
   * `DeriveConfig`.
   */
  derive?: DeriveConfig;
  /**
   * Element paths to lift in addition to each format's convention. See
   * `parseElementPath` for the syntax.
   */
  elements?: string[];
  fill?: FillConfig;
  /**
   * Path to a validation baseline, relative to **this config file**. Setting it
   * implies `--baseline` on every run; `--no-baseline` suppresses it for one.
   */
  baseline?: string;
  /**
   * Treat an input set that resolves to zero files as success rather than an
   * operational error. Off by default: a glob that stops matching would
   * otherwise leave a permanently green gate that checks nothing.
   */
  allowEmpty?: boolean;
  /**
   * Skip files `.gitignore` covers when expanding directories and globs. On by
   * default; set false to check generated or vendored documents the repo does
   * not track. Setting it **true** explicitly also asks to be told when git
   * cannot answer — see `GITIGNORE_UNAVAILABLE`.
   */
  respectGitignore?: boolean;
  /** Defaults for the cross-run schema cache. See `SchemaCacheConfig`. */
  schemaCache?: SchemaCacheConfig;
  /**
   * Never fetch a remote schema. A URL reference resolves from the schema
   * cache; an uncached one is an operational error naming the URL. Built-in and
   * local-file references are unaffected — neither touches the network.
   */
  offline?: boolean;
  /**
   * How far a document's own `$schema` is trusted. Absent means `any` — every
   * setup that exists today, unchanged. See `SchemaTrustConfig`.
   */
  schemaTrust?: SchemaTrustConfig;
}

/** The metadata tool's key in the family config file. */
export const META_SECTION = "meta";

/**
 * The tool's own filenames from before the family file. Still discovered,
 * with a deprecation warning; their whole document is the `meta:` section.
 */
export const LEGACY_CONFIG_NAMES: readonly string[] = [
  "docmeta.config.yaml",
  "docmeta.config.yml",
];

const CONFIG_FILE: ConfigFileOptions = {
  section: META_SECTION,
  legacyNames: LEGACY_CONFIG_NAMES,
  toError: (message) => new DocmetaError(message),
};

function asStringList(value: unknown, field: string, source: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new DocmetaError(
      `${source}: "${field}" must be a list of strings.`,
    );
  }
  return value as string[];
}

/**
 * Parse `overrides[].files`, which accepts a single glob or a list of them.
 *
 * Deliberately not `asStringList`: that helper rejects a bare string, and the
 * single form is what every existing config and every doc example is written
 * in. The shape is preserved rather than normalized — see `SchemaOverride.files`
 * for why — so this validates and returns, it does not convert.
 *
 * The refusals are the ones a silently-matching-nothing rule would otherwise
 * cause: an empty list, and a blank glob in either shape. Both read as
 * configured and are not, which is the same false green the neighbouring
 * "sets neither schemas nor elements" check exists to end.
 */
function asFileGlobs(
  value: unknown,
  where: string,
  source: string,
): string | string[] {
  if (typeof value === "string") {
    if (value.trim() === "") {
      throw new DocmetaError(`${source}: ${where} must be a non-empty glob string.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new DocmetaError(
        `${source}: ${where} is an empty list, so it matches nothing and the override has no effect.`,
      );
    }
    // Indexed, because "one of these six globs is blank" is not actionable.
    value.forEach((glob, j) => {
      if (typeof glob !== "string" || glob.trim() === "") {
        throw new DocmetaError(
          `${source}: ${where}[${j}] must be a non-empty glob string.`,
        );
      }
    });
    return value as string[];
  }
  throw new DocmetaError(
    `${source}: ${where} must be a glob string or a list of glob strings.`,
  );
}

/**
 * Parse the top-level `schemas:` list, which accepts both forms.
 *
 * Separate from `asStringList` on purpose. That helper also validates
 * `elements` and `overrides[].schemas`, and widening it in place would have
 * quietly widened those too — `elements: [{ref: …}]` would have started
 * parsing and then failed somewhere far from the config file.
 */
function asSchemaList(
  value: unknown,
  field: string,
  source: string,
): SchemaEntry[] {
  if (!Array.isArray(value)) {
    throw new DocmetaError(
      `${source}: "${field}" must be a list of schema references.`,
    );
  }
  return value.map((entry, i) => parseSchemaEntry(entry, `${field}[${i}]`, source));
}

function parseSchemaEntry(
  entry: unknown,
  where: string,
  source: string,
): SchemaEntry {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new DocmetaError(
      `${source}: ${where} must be a schema reference string, or a mapping with "ref" (and optionally "source" and "integrity").`,
    );
  }
  const raw = entry as Record<string, unknown>;

  // A misspelled key is the failure worth catching here: `intergrity:` would
  // otherwise be dropped in silence, leaving a config that reads as pinned and
  // a schema that is not.
  rejectUnknownKeys(raw, SCHEMA_ENTRY_KEYS, where, source);

  if (typeof raw.ref !== "string" || raw.ref.trim() === "") {
    throw new DocmetaError(
      `${source}: ${where}.ref must be a non-empty schema reference string.`,
    );
  }
  const parsed: SchemaRefEntry = { ref: raw.ref };

  if (raw.source !== undefined) {
    if (typeof raw.source !== "string" || raw.source.trim() === "") {
      throw new DocmetaError(
        `${source}: ${where}.source must be a non-empty string naming where "${raw.ref}" was vendored from.`,
      );
    }
    parsed.source = raw.source;
  }

  if (raw.integrity !== undefined) {
    if (typeof raw.integrity !== "string" || !isIntegrity(raw.integrity)) {
      throw new DocmetaError(
        `${source}: ${where}.integrity must look like "${INTEGRITY_SHAPE}". Record one with \`manni meta schemas vendor\`.`,
      );
    }
    // A pin is checked against bytes on disk. On a built-in id there are no
    // bytes to read, and on a URL the copy that satisfies a run may come from
    // the schema cache, which stores the parsed schema rather than what the
    // server sent. Accepting either would record a pin nothing ever verifies —
    // a config that reads as pinned and is not.
    const kind = classifyRef(parsed.ref).kind;
    if (kind !== "file") {
      throw new DocmetaError(
        `${source}: ${where}.integrity applies to a vendored local file, but "${parsed.ref}" is a ${kind === "url" ? "URL" : "built-in id"}. Vendor it first with \`manni meta schemas vendor\`, or drop the pin.`,
      );
    }
    parsed.integrity = raw.integrity;
  }

  return parsed;
}

/**
 * Parse and validate config YAML text whose top level *is* the metadata
 * tool's config — a pre-family `docmeta.config.yaml`, or a section already
 * cut out of the family file.
 */
export function parseConfig(text: string, source: string): DocmetaConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new DocmetaError(
      `${source}: invalid YAML: ${errorMessage(err)}`,
    );
  }
  return parseConfigValue(raw, source);
}

/**
 * Validate an already-parsed config value.
 *
 * `section` is the family-file key the value was cut from, when it was. The
 * validator labels fields relative to the document it is handed — `"paths"`,
 * `overrides[0]` — and the one place that knows those fields sit under
 * `meta:` is here, so the label gains the section on the way out rather than
 * every check learning to spell it.
 */
export function parseConfigValue(
  raw: unknown,
  source: string,
  section?: string,
): DocmetaConfig {
  // Deliberately outside the `withSection` wrapper below, and outside both
  // branches' `try`. These four messages name `meta` in their own prose, so
  // `withSection` rewriting `"paths"` into `"meta.paths"` would produce
  // `"meta.paths" is no longer a meta key` — a sentence that contradicts
  // itself. They run for the unwrapped legacy form too, because a
  // `docmeta.config.yaml` that still says `paths:` is exactly the file whose
  // owner needs to be told where the key went (0041 § discovery).
  assertNoMovedKeys(raw, source);
  if (section === undefined) return parseConfigDocument(raw, source);
  try {
    return parseConfigDocument(raw, source);
  } catch (err) {
    if (err instanceof DocmetaError) {
      throw new DocmetaError(withSection(err.message, source, section));
    }
    throw err;
  }
}

/**
 * Every message the validator produces opens with `${source}: ` and then
 * names what is wrong in one of three shapes: a quoted key (`"paths"`,
 * `"fill.model"`), an unquoted path (`overrides[0].files`, `checks[1]`,
 * `elements — …`), or "the top level". Each gains the section.
 */
function withSection(message: string, source: string, section: string): string {
  const head = `${source}: `;
  if (!message.startsWith(head)) return message;
  const rest = message.slice(head.length);
  if (rest.startsWith("the top level ")) {
    return `${head}\`${section}:\`${rest.slice("the top level".length)}`;
  }
  if (rest.startsWith('"')) return `${head}"${section}.${rest.slice(1)}`;
  if (/^[a-zA-Z]+(\[|\.| —)/.test(rest)) return `${head}${section}.${rest}`;
  return message;
}

/** Where the configuration reference documents each moved key. */
const CONFIG_REF = "https://hawkeyexl.github.io/manni/meta/reference/configuration/";

/**
 * The three keys proposal 0041 moved out of `meta:` and up to the family
 * level, with the sentence that says where each went.
 *
 * Refused rather than aliased: an alias is a permanent second surface for one
 * concept, and the whole point of `collections:` is that the document set is
 * declared **once** for every tool. This is the umbrella's rule for a moved
 * command, applied to a moved key.
 */
const MOVED_KEYS: readonly (readonly [string, string])[] = [
  [
    "paths",
    `Document sets are declared once for every tool, under a top-level collections: list. See ${CONFIG_REF}#collections`,
  ],
  [
    "exclude",
    `Document sets are declared once for every tool, under a top-level collections: list. See ${CONFIG_REF}#collections`,
  ],
  [
    "sidecars",
    `It is externalMetadata on a collection, under the top-level collections: list. See ${CONFIG_REF}#external-metadata`,
  ],
];

/**
 * Refuse a key 0041 moved, in either the wrapped or the unwrapped form.
 *
 * Reads the raw value as a mapping rather than going through
 * `parseConfigDocument`, because it must run *before* the unknown-key check
 * (which would report `paths` as a typo) and before `withSection` (which would
 * rewrite the key into the message's own subject).
 */
function assertNoMovedKeys(raw: unknown, source: string): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const obj = raw as Record<string, unknown>;
  for (const [key, remedy] of MOVED_KEYS) {
    if (Object.hasOwn(obj, key)) {
      throw new DocmetaError(
        `${source}: "${key}" is no longer a meta key. ${remedy}`,
      );
    }
  }
  // `overrides[].name` went the same way, one level down: a collection is the
  // thing that has a name now (0041 supersedes 0027), and an override points
  // at one. Indexed, because a long `overrides:` list needs to say which entry.
  if (!Array.isArray(obj.overrides)) return;
  for (const [i, entry] of obj.overrides.entries()) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      Object.hasOwn(entry as Record<string, unknown>, "name")
    ) {
      throw new DocmetaError(
        `${source}: overrides[${i}] no longer carries "name". Define a collection with that name and point the override at it with collection:.`,
      );
    }
  }
}

/**
 * A message from a rule that runs outside `parseConfigValue`, with the prefix
 * that parser gives its own. A check in `loadConfig` needs both halves of the
 * family file, so it cannot sit inside the parser, but its message should
 * still name the key the way the reader wrote it: `meta.overrides[0] …`, as
 * the configuration reference documents. A legacy per-tool file has no
 * section, so its message is unchanged.
 */
function inSection(message: string, source: string, section: string | undefined): string {
  return section === undefined ? message : withSection(message, source, section);
}

/**
 * Refuse an `overrides[].collection` naming a collection nobody declared.
 *
 * Checked here rather than in the section parser because it is the one
 * override rule that needs the *other* half of the family file: `collections:`
 * is a top-level key, parsed by the shared loader, and the section parser
 * never sees it. The message goes through `inSection`, so it reads
 * `meta.overrides[i].collection` like every error the section parser raises
 * (0041 § interface).
 */
function assertOverrideCollections(
  config: DocmetaConfig,
  collections: readonly CollectionConfig[],
  source: string,
  section: string | undefined,
): void {
  const names = new Set(collections.map((c) => c.name));
  for (const [i, ov] of (config.overrides ?? []).entries()) {
    if (ov.collection === undefined || names.has(ov.collection)) continue;
    const defined =
      collections.length === 0
        ? "(none)"
        : collections.map((c) => c.name).join(", ");
    throw new DocmetaError(
      inSection(
        `${source}: overrides[${i}].collection names "${ov.collection}", which collections: does not define. Defined: ${defined}.`,
        source,
        section,
      ),
    );
  }
}

/** Where a key is owned: the manifest, and its place in the family file. */
export interface ManifestOwner {
  /** Index into `collections:`. */
  collection: number;
  /** The collection's name, for a message a person reads. */
  name: string;
  /** Index into that collection's `externalMetadata:`. */
  entry: number;
  /** The manifest's `file`, as the config wrote it. */
  file: string;
}

/**
 * The manifest that owns `key`, if any declared collection has one.
 *
 * Every declared collection counts, not only the ones a run selected: a
 * manifest's `keys:` list is a claim about the key everywhere, not about one
 * run. No manifest is read, because the config's own `keys:` list is the whole
 * claim.
 */
export function manifestOwning(
  key: string,
  collections: readonly CollectionConfig[],
): ManifestOwner | undefined {
  for (const [c, collection] of collections.entries()) {
    for (const [e, manifest] of collection.externalMetadata.entries()) {
      if (manifest.keys.includes(key)) {
        return { collection: c, name: collection.name, entry: e, file: manifest.file };
      }
    }
  }
  return undefined;
}

/**
 * Refuse a `derive.fields` entry or a `derive.commands` key that some manifest
 * owns (proposals 0040 and 0042).
 *
 * A managed field has one authority, and a manifest key already has one. The
 * rule needs both halves of the family file, `meta.derive` and the top-level
 * `collections:`, so it runs here for the same reason
 * `assertOverrideCollections` does. `manni meta derive --fields` asks
 * `manifestOwning` directly, because that flag never passes through here.
 *
 * The message goes through `inSection`, as `assertOverrideCollections` does, so
 * it reads `meta.derive.fields[1]` the way the configuration reference says a
 * `meta:` error reads. Manifests exist only in a family file, so in practice
 * the section is always there.
 */
function assertManagedFieldsUnowned(
  config: DocmetaConfig,
  collections: readonly CollectionConfig[],
  source: string,
  section: string | undefined,
): void {
  const refuse = (path: string, owner: ManifestOwner): never => {
    const message = `${source}: ${path} is owned by collections[${owner.collection}].externalMetadata[${owner.entry}] (${owner.file}) — a managed field has one authority, and a manifest key already has one. Drop it from one side.`;
    throw new DocmetaError(
      inSection(message, source, section),
    );
  };
  // Commands first, as the parser reads them: a command's key is where a
  // field outside the built-ins is claimed, so that is the line to name.
  for (const key of Object.keys(config.derive?.commands ?? {})) {
    const owner = manifestOwning(key, collections);
    if (owner !== undefined) refuse(`derive.commands.${key}`, owner);
  }
  for (const [i, field] of (config.derive?.fields ?? []).entries()) {
    const owner = manifestOwning(field, collections);
    if (owner !== undefined) refuse(`derive.fields[${i}] "${field}"`, owner);
  }
}

/**
 * Parse `derive:`.
 *
 * A `derive:` must say something: `fields` to manage, or `sources` or
 * `codeowners` to shape the reads (`get --derived`, the `derived` table). A
 * bare `derive:` reads as configured and is not — the same silence
 * `rejectUnknownKeys` exists to end. `fields` defaults to none when the
 * other keys carry the block, so a repository without `gh` can narrow
 * `sources` for its reads without inventing a managed field.
 * A field is refused when it is not derivable (nothing could ever fill it)
 * or repeated. `$schema` falls out of the derivable list, so it never needs a
 * rule of its own there. A field a manifest owns is refused as well, by
 * `assertManagedFieldsUnowned` in `loadConfig`, because manifests are declared
 * on the top-level `collections:` this parser never sees.
 *
 * `commands` is parsed before `fields`, because a key of `commands` is what
 * makes a non-built-in field derivable. A command may only derive a field
 * no built-in source claims, and the refusal names the source that does.
 */
function parseDerive(
  raw: unknown,
  source: string,
): DeriveConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DocmetaError(
      `${source}: "derive" must be a mapping. Write it as \`derive:\` with \`fields:\` beneath it.`,
    );
  }
  const e = raw as Record<string, unknown>;
  rejectUnknownKeys(e, DERIVE_KEYS, '"derive"', source);

  if (
    e.fields === undefined &&
    e.sources === undefined &&
    e.codeowners === undefined &&
    e.commands === undefined
  ) {
    throw new DocmetaError(
      `${source}: "derive" sets nothing. Give it \`fields:\` to manage, \`commands:\` to derive from a command, or \`sources:\` or \`codeowners:\` to shape the reads.`,
    );
  }

  const commands =
    e.commands === undefined ? undefined : parseDeriveCommands(e.commands, source);

  if (
    e.fields !== undefined &&
    (!Array.isArray(e.fields) ||
      e.fields.length === 0 ||
      e.fields.some((f) => typeof f !== "string"))
  ) {
    throw new DocmetaError(
      `${source}: derive.fields must be a non-empty list of field names. ${DERIVABLE_LIST}`,
    );
  }
  const fields: DerivableField[] = [];
  ((e.fields ?? []) as string[]).forEach((f, i) => {
    if (!isBuiltinField(f) && !(commands !== undefined && Object.hasOwn(commands, f))) {
      throw new DocmetaError(
        `${source}: derive.fields[${i}] "${f}" is not derivable. ${DERIVABLE_LIST}`,
      );
    }
    if (fields.includes(f)) {
      throw new DocmetaError(`${source}: derive.fields lists "${f}" twice.`);
    }
    fields.push(f);
  });
  const derive: DeriveConfig = { fields };

  if (e.sources !== undefined) {
    if (
      !Array.isArray(e.sources) ||
      e.sources.length === 0 ||
      e.sources.some((s) => typeof s !== "string")
    ) {
      throw new DocmetaError(
        `${source}: derive.sources must be a non-empty list of source names. Sources: ${DERIVE_SOURCES.join(", ")}.`,
      );
    }
    const sources: DeriveSource[] = [];
    (e.sources as string[]).forEach((s, i) => {
      if (!isDeriveSource(s)) {
        throw new DocmetaError(
          `${source}: derive.sources[${i}] "${s}" is not a source. Sources: ${DERIVE_SOURCES.join(", ")}.`,
        );
      }
      if (sources.includes(s)) {
        throw new DocmetaError(`${source}: derive.sources lists "${s}" twice.`);
      }
      sources.push(s);
    });
    derive.sources = sources;
  }

  if (e.codeowners !== undefined) {
    if (typeof e.codeowners !== "string" || e.codeowners.trim() === "") {
      throw new DocmetaError(
        `${source}: derive.codeowners must be a non-empty path to a CODEOWNERS file, relative to the config file.`,
      );
    }
    derive.codeowners = e.codeowners;
  }

  if (commands !== undefined) derive.commands = commands;

  return derive;
}

/**
 * Parse `derive.commands`: a mapping of field name to command. A key is
 * refused when it is empty, `$schema`, or a built-in field (a command may
 * only derive a field no built-in source claims). A key a manifest owns is
 * refused too, by `assertManagedFieldsUnowned` in `loadConfig`. Each command
 * carries `run`, the argv with the program first, and an optional `timeout`
 * in seconds.
 */
function parseDeriveCommands(
  raw: unknown,
  source: string,
): Record<string, DeriveCommandConfig> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DocmetaError(
      `${source}: derive.commands must be a mapping of field name to command.`,
    );
  }
  const commands: Record<string, DeriveCommandConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.trim() === "") {
      throw new DocmetaError(`${source}: derive.commands has an empty field name.`);
    }
    if (key === FILE_SCHEMA_KEY) {
      throw new DocmetaError(
        `${source}: derive.commands may not derive "${FILE_SCHEMA_KEY}" — a command never chooses the schema a document is judged by.`,
      );
    }
    if (isBuiltinField(key)) {
      throw new DocmetaError(
        `${source}: derive.commands.${key} targets a field ${BUILTIN_CLAIMED_BY[key]} already derives; a command may only derive a field no built-in source claims.`,
      );
    }
    // Every command key is a column of the `derived` table beside `_path`
    // and `_sources`, so one spelled like either would be declared twice and
    // SQLite would refuse the table with a raw error, mid-query. Refused
    // here for the reason a collection named `derived` is (see
    // `parseCollections`): a name collision is a config mistake, said at
    // parse time.
    if (DERIVED_TABLE_RESERVED.has(key)) {
      throw new DocmetaError(
        `${source}: derive.commands.${key} collides with a column of the derived table a query builds (${[...DERIVED_TABLE_RESERVED].join(", ")}). Pick another field name.`,
      );
    }

    const where = `derive.commands.${key}`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DocmetaError(
        `${source}: ${where} must be a mapping with \`run:\` beneath it.`,
      );
    }
    const c = value as Record<string, unknown>;
    rejectUnknownKeys(c, DERIVE_COMMAND_KEYS, where, source);

    if (!Array.isArray(c.run) || c.run.length === 0) {
      throw new DocmetaError(
        `${source}: ${where}.run must be a non-empty list of strings, the program first.`,
      );
    }
    const run: string[] = [];
    (c.run as unknown[]).forEach((arg, j) => {
      if (typeof arg !== "string" || arg.trim() === "") {
        throw new DocmetaError(`${source}: ${where}.run[${j}] must be a non-empty string.`);
      }
      run.push(arg);
    });
    const command: DeriveCommandConfig = { run };

    if (c.timeout !== undefined) {
      // Whole seconds, because the reference says so and because a fraction
      // reads as a budget while acting as a kill switch: `timeout: 0.001` is
      // a 1 ms allowance that ends every spawn before it can answer.
      if (typeof c.timeout !== "number" || !Number.isInteger(c.timeout) || c.timeout <= 0) {
        throw new DocmetaError(
          `${source}: ${where}.timeout must be a whole number of seconds, greater than zero.`,
        );
      }
      command.timeout = c.timeout;
    }
    commands[key] = command;
  }
  return commands;
}

function parseConfigDocument(raw: unknown, source: string): DocmetaConfig {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new DocmetaError(`${source}: top level must be a mapping.`);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, CONFIG_KEYS, "the top level", source);
  const config: DocmetaConfig = {};

  if (obj.schemas !== undefined)
    config.schemas = asSchemaList(obj.schemas, "schemas", source);

  if (obj.overrides !== undefined) {
    if (!Array.isArray(obj.overrides)) {
      throw new DocmetaError(`${source}: "overrides" must be a list.`);
    }
    config.overrides = obj.overrides.map((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        throw new DocmetaError(`${source}: overrides[${i}] must be a mapping.`);
      }
      const e = entry as Record<string, unknown>;
      // Before the field checks, so a misspelling is reported as the typo it
      // is. `schemass:` beside a correct `schemas:` was dropped in silence and
      // the run passed — the false green this whole check exists to end, in the
      // one section it had not reached. Alone, it produced `"overrides[0].
      // schemas" must be a list of strings`, blaming the key that is missing
      // rather than the one that is wrong.
      rejectUnknownKeys(e, OVERRIDE_KEYS, `overrides[${i}]`, source);
      // Exactly one of the two ways to say which files an override governs
      // (0041 rule 8). Both would need a rule for how they combine, and
      // neither is a rule that governs nothing — the same reads-as-configured
      // silence the no-effect refusal below exists to end.
      const hasFiles = e.files !== undefined;
      const hasCollection = e.collection !== undefined;
      if (hasFiles === hasCollection) {
        throw new DocmetaError(
          `${source}: overrides[${i}] must carry exactly one of "files" or "collection".`,
        );
      }
      const files = hasFiles
        ? asFileGlobs(e.files, `overrides[${i}].files`, source)
        : undefined;
      let collection: string | undefined;
      if (hasCollection) {
        if (typeof e.collection !== "string" || e.collection.trim() === "") {
          throw new DocmetaError(
            `${source}: overrides[${i}].collection must be a non-empty string naming a collection.`,
          );
        }
        collection = e.collection;
      }
      const schemas =
        e.schemas === undefined
          ? []
          : asStringList(e.schemas, `overrides[${i}].schemas`, source);
      const elements =
        e.elements === undefined
          ? undefined
          : asElementPaths(e.elements, `overrides[${i}].elements`, source);
      // An override naming neither is a rule that does nothing, which reads as
      // configured and is not — the same silence `rejectUnknownKeys` exists to
      // end, one level down.
      if (schemas.length === 0 && (elements === undefined || elements.length === 0)) {
        throw new DocmetaError(
          `${source}: overrides[${i}] sets neither "schemas" nor "elements", so it has no effect.`,
        );
      }
      // Whether `collection` names a *declared* collection is checked by
      // `loadConfig`, the first place both halves of the family file are
      // known. Every view-name refusal 0027 made here — blank, `docs`,
      // `sqlite_`, duplicate — now lives in `parseCollections`, beside the
      // name it belongs to.
      return {
        ...(files !== undefined ? { files } : {}),
        ...(collection !== undefined ? { collection } : {}),
        schemas,
        ...(elements ? { elements } : {}),
      };
    });
  }

  if (obj.checks !== undefined) {
    config.checks = parseChecks(obj.checks, source);
  }

  // Whether a managed field is a key some manifest owns is checked by
  // `loadConfig`, beside the override collections: manifests are declared on
  // the top-level `collections:`, which this parser never sees.
  if (obj.derive !== undefined) {
    config.derive = parseDerive(obj.derive, source);
  }

  if (obj.elements !== undefined) {
    config.elements = asElementPaths(obj.elements, "elements", source);
  }

  if (obj.baseline !== undefined) {
    if (typeof obj.baseline !== "string" || obj.baseline.trim() === "") {
      throw new DocmetaError(
        `${source}: "baseline" must be a path to a baseline file.`,
      );
    }
    config.baseline = obj.baseline;
  }

  if (obj.allowEmpty !== undefined) {
    if (typeof obj.allowEmpty !== "boolean") {
      throw new DocmetaError(`${source}: "allowEmpty" must be a boolean.`);
    }
    config.allowEmpty = obj.allowEmpty;
  }

  if (obj.respectGitignore !== undefined) {
    if (typeof obj.respectGitignore !== "boolean") {
      throw new DocmetaError(`${source}: "respectGitignore" must be a boolean.`);
    }
    config.respectGitignore = obj.respectGitignore;
  }

  if (obj.offline !== undefined) {
    if (typeof obj.offline !== "boolean") {
      throw new DocmetaError(`${source}: "offline" must be a boolean.`);
    }
    config.offline = obj.offline;
  }

  if (obj.schemaCache !== undefined) {
    config.schemaCache = parseSchemaCache(obj.schemaCache, source);
  }

  if (obj.schemaTrust !== undefined) {
    config.schemaTrust = parseSchemaTrust(obj.schemaTrust, source);
  }

  if (obj.fill !== undefined) config.fill = parseFill(obj.fill, source);

  return config;
}

/**
 * Parse the `checks:` list with the same shape discipline `overrides:` has:
 * array guard, per-entry mapping guard, unknown keys rejected before the field
 * checks (so a `querry:` typo is reported as the typo it is), and a missing
 * `name` or `query` refused by index.
 */
function parseChecks(value: unknown, source: string): CheckConfig[] {
  if (!Array.isArray(value)) {
    throw new DocmetaError(`${source}: "checks" must be a list.`);
  }
  const seen = new Set<string>();
  return value.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new DocmetaError(
        `${source}: checks[${i}] must be a mapping with "name" and "query".`,
      );
    }
    const e = entry as Record<string, unknown>;
    rejectUnknownKeys(e, CHECK_KEYS, `checks[${i}]`, source);
    if (typeof e.name !== "string" || e.name === "") {
      throw new DocmetaError(
        `${source}: checks[${i}].name must be a non-empty string.`,
      );
    }
    // The grammar is baseline identity — see CHECK_NAME. The `.json` tail is
    // excluded separately because BUILTIN_ID excludes it: `check:slugs.json`
    // would classify as a file path.
    if (!CHECK_NAME.test(e.name) || e.name.toLowerCase().endsWith(".json")) {
      throw new DocmetaError(
        `${source}: checks[${i}].name "${e.name}" must match [a-z0-9][a-z0-9._-]* and not end in ".json" — the name is part of each finding's identity (check:<name>).`,
      );
    }
    const reserved = RESERVED_CHECK_NAMES.get(e.name);
    if (reserved !== undefined) {
      throw new DocmetaError(
        `${source}: checks[${i}].name "${e.name}" is reserved — ${reserved}. Pick another name.`,
      );
    }
    // Two checks sharing a name would share every finding's identity, so the
    // baseline could not tell their findings apart.
    if (seen.has(e.name)) {
      throw new DocmetaError(
        `${source}: checks[${i}] reuses the name "${e.name}"; check names must be unique.`,
      );
    }
    seen.add(e.name);
    if (typeof e.query !== "string" || e.query.trim() === "") {
      throw new DocmetaError(
        `${source}: checks[${i}].query must be a non-empty SQL statement.`,
      );
    }
    return { name: e.name, query: e.query };
  });
}

function parseSchemaCache(value: unknown, source: string): SchemaCacheConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocmetaError(`${source}: "schemaCache" must be a mapping.`);
  }
  const raw = value as Record<string, unknown>;
  rejectUnknownKeys(raw, SCHEMA_CACHE_KEYS, '"schemaCache"', source);
  const schemaCache: SchemaCacheConfig = {};

  const ttl = raw.ttlHours;
  if (ttl !== undefined) {
    // A YAML `1e999` parses to Infinity, and a bare range check would accept
    // it. A negative TTL is worse than useless: every entry would read as
    // stale, so the cache would silently do nothing at all.
    //
    // The upper bound is not tidiness. Freshness compares against
    // `ttlHours * 3_600_000`, and a finite-but-huge value overflows that
    // product to Infinity, so `elapsed >= Infinity` is never true and every
    // entry is served forever — a cache that silently stops expiring, which is
    // the opposite of what a TTL is for. One year is well past any real
    // setting, and anyone wanting "never expire" has a clearer way to say it.
    if (
      typeof ttl !== "number" ||
      !Number.isFinite(ttl) ||
      ttl < 0 ||
      ttl > MAX_TTL_HOURS
    ) {
      throw new DocmetaError(
        `${source}: "schemaCache.ttlHours" must be a number of hours between 0 and ${MAX_TTL_HOURS} (0 disables the cache).`,
      );
    }
    schemaCache.ttlHours = ttl;
  }

  return schemaCache;
}

/**
 * Parse `schemaTrust:`, shaped after `parseSchemaCache` — a nested mapping with
 * every key optional, so an absent one leaves the default in exactly one place.
 *
 * Unknown nested keys are rejected the way a `schemas:` mapping entry rejects
 * them, and for the same reason: a misspelled `documentRef:` would otherwise be
 * dropped in silence, leaving a repo that reads as guarded and is not. A
 * misspelled `schemaTrust:` is now rejected too — `parseConfig` checks the top
 * level against `CONFIG_KEYS` rather than walking only the keys it knows. What
 * remains, and cannot be fixed here, is an *older* docmeta reading a config
 * written for a newer one: it has never heard of the key and ignores it. See
 * the version-floor note in the configuration reference.
 */
function parseSchemaTrust(value: unknown, source: string): SchemaTrustConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocmetaError(
      `${source}: "schemaTrust" must be a mapping. Write it as \`schemaTrust:\` with \`documentRefs:\` and optionally \`hosts:\` beneath it.`,
    );
  }
  const raw = value as Record<string, unknown>;
  rejectUnknownKeys(raw, SCHEMA_TRUST_KEYS, '"schemaTrust"', source);
  const schemaTrust: SchemaTrustConfig = {};

  const mode = raw.documentRefs;
  if (mode !== undefined) {
    if (
      typeof mode !== "string" ||
      !(DOCUMENT_REF_TRUST as readonly string[]).includes(mode)
    ) {
      throw new DocmetaError(
        `${source}: "schemaTrust.documentRefs" must be one of: ${DOCUMENT_REF_TRUST.join(", ")}. Use \`documentRefs: any\` for today's behavior, \`local\` to refuse a URL a document names, or \`none\` to let the config decide alone.`,
      );
    }
    schemaTrust.documentRefs = mode as DocumentRefTrust;
  }

  const hosts = raw.hosts;
  if (hosts !== undefined) {
    if (
      !Array.isArray(hosts) ||
      hosts.some((h) => typeof h !== "string" || h.trim() === "")
    ) {
      throw new DocmetaError(
        `${source}: "schemaTrust.hosts" must be a list of host names, such as "schemas.example.com". Remove the key to allow any host.`,
      );
    }
    schemaTrust.hosts = hosts as string[];
  }

  return schemaTrust;
}

function parseFill(value: unknown, source: string): FillConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocmetaError(`${source}: "fill" must be a mapping.`);
  }
  const raw = value as Record<string, unknown>;
  rejectUnknownKeys(raw, FILL_KEYS, '"fill"', source);
  const fill: FillConfig = {};

  const asString = (key: "provider" | "model"): void => {
    const v = raw[key];
    if (v === undefined) return;
    if (typeof v !== "string") {
      throw new DocmetaError(`${source}: "fill.${key}" must be a string.`);
    }
    fill[key] = v;
  };
  asString("provider");
  asString("model");

  const asNumber = (
    key: "confidenceThreshold" | "maxTurns" | "chunkChars" | "concurrency",
    min: number,
    max: number,
    integer = false,
  ): void => {
    const v = raw[key];
    if (v === undefined) return;
    // A YAML `1e999` parses to Infinity, and a bare range check would accept
    // it, so require a finite number explicitly.
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      throw new DocmetaError(
        `${source}: "fill.${key}" must be a number between ${min} and ${max}.`,
      );
    }
    // A fractional worker count would be silently truncated downstream rather
    // than rejected, so catch it where the user can see the mistake.
    if (integer && !Number.isInteger(v)) {
      throw new DocmetaError(
        `${source}: "fill.${key}" must be a whole number.`,
      );
    }
    fill[key] = v;
  };
  asNumber("confidenceThreshold", 0, 1);
  asNumber("maxTurns", 1, Number.MAX_SAFE_INTEGER, true);
  asNumber("chunkChars", 1, Number.MAX_SAFE_INTEGER, true);
  asNumber("concurrency", 1, 64, true);

  return fill;
}

export interface LoadedConfig {
  config: DocmetaConfig;
  /** Absolute path to the file the config was read from. */
  path: string;
  /**
   * Directory holding that file. Relative paths written *in* the config — a
   * collection's `paths:`, local-file schema refs — are meaningful relative to
   * this, not to the directory the command happened to be invoked from.
   */
  dir: string;
  /**
   * The file as the user would name it, which is how every config message
   * spells it. Threaded from `ConfigFile.source` so `selectCollections` can
   * name the file a `--collection` failed to find a collection in.
   */
  source: string;
  /**
   * The family-file key the config was read from under (`"meta"`), when it
   * was. Absent for a pre-family file, whose top level is the config. A
   * command that writes the file back (`schemas vendor`) needs to know.
   */
  section?: string;
  /**
   * Every collection the family file declares (proposal 0041), in declaration
   * order. `[]` for a legacy per-tool file, which carries no family-wide keys.
   */
  collections: CollectionConfig[];
}

// The project boundary lives with the family config discovery now; the SARIF
// reporter still imports it from here.
export { findGitRoot };

/**
 * The directory a **document-supplied** local schema path must stay inside.
 *
 * The git root rather than the config's directory, so a monorepo package whose
 * documents reference `../shared/x.json` keeps working — that path is still
 * inside the repository, which is what "a schema in this project" means.
 *
 * `source` is not decoration, and it has **three** values rather than a
 * boolean: with no repository the boundary falls back to the config's
 * directory, and with no config either it falls back to the run's `cwd`. Those
 * are progressively narrower and less obvious rules, and the refusal message
 * has to name the one it actually applied — telling someone with no config file
 * that "the config's own directory is the boundary" sends them looking for a
 * file that is not there.
 *
 * Same reasoning as `SARIF_NO_GIT_ROOT`: "there is no repository" and "the
 * repository root is where you are standing" must stay distinguishable.
 */
export interface SchemaTrustRoot {
  /** Absolute directory the path must resolve inside. */
  dir: string;
  /** Which rule produced `dir`, so a refusal can name it accurately. */
  source: "git" | "config" | "cwd";
}

/** Settle the containment root once per run, for `resolveSchemaSet`. */
export function schemaTrustRoot(
  cwd: string,
  configDir?: string,
): SchemaTrustRoot {
  const git = findGitRoot(cwd);
  if (git !== null) return { dir: git, source: "git" };
  if (configDir !== undefined) return { dir: resolve(configDir), source: "config" };
  return { dir: resolve(cwd), source: "cwd" };
}

/**
 * Load config from an explicit path (error if missing) or by discovery.
 *
 * Discovery checks cwd and then each ancestor up to and including the nearest
 * `.git` boundary. Within a directory the order is the family file
 * (`manni.config.yaml`, then `.yml`, read at its `meta:` key), the pre-rename
 * family file (`moose.config.yaml`), then `docmeta.config.yaml` and `.yml`
 * whole. The **first file found wins** and the walk stops there — ancestor
 * configs are never merged, because `schemas:` is a set a file must satisfy in
 * full and `overrides:` is first-match-wins ordered, so a partial merge would
 * silently redefine what "the contract" means. See src/shared/config-file.ts
 * for the rest of the rules, the deprecation warnings included.
 *
 * Returns null when no config is found via discovery.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedConfig | null> {
  const file = explicitPath
    ? await readConfigFile(explicitPath, cwd, CONFIG_FILE)
    : await findConfigFile(cwd, CONFIG_FILE);
  if (file === null) return null;
  const section = file.wrapped ? META_SECTION : undefined;
  const config = parseConfigValue(file.value, file.source, section);
  assertOverrideCollections(config, file.collections, file.source, section);
  assertManagedFieldsUnowned(config, file.collections, file.source, section);
  return {
    config,
    path: file.path,
    dir: file.dir,
    source: file.source,
    collections: file.collections,
    ...(section !== undefined ? { section } : {}),
  };
}

/** Told to a caller once, when a run turns out to be governed by a config. */
export interface ConfigNotice {
  /** Absolute path to the config file. */
  path: string;
  /** Directory holding it. */
  dir: string;
}

export interface RunConfigOptions {
  /** Defaults to `process.cwd()`, matching `loadConfig`. */
  cwd?: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /**
   * Positional inputs; empty means fall back to the configured collections'
   * `paths:` (proposal 0041).
   */
  inputs: string[];
  /**
   * `--collection <name>`, repeatable: the collections this run covers. Empty
   * or absent means every declared collection — the same thing, because
   * commander's repeatable collector hands a caller `[]` when the flag was
   * never passed (see `selectCollections`).
   */
  collections?: string[];
  onConfigLoaded?: (info: ConfigNotice) => void;
}

/**
 * The stdin token, `load-files.ts`'s `STDIN_TOKEN`, repeated as a literal so
 * this module does not depend on the file loader it sits below. It is the one
 * input allowed beside `--collection`: stdin is not a path, so it says nothing
 * about which collections the run covers.
 */
const STDIN_TOKEN_LITERAL = "-";

export interface RunConfig {
  /** The config, with its local file schema refs already rebased. */
  config: DocmetaConfig | null;
  /**
   * What to resolve: the positional inputs, or the selected collections'
   * `paths:`, concatenated in declaration order.
   */
  inputs: string[];
  /**
   * Directory those inputs — and so every resolved file path, and every file
   * read — are relative to.
   *
   * A run uses *either* positional paths *or* the collections' `paths:`, never
   * both, so there is exactly one base per run and no ambiguity about which it
   * is. Positional paths are typed by a person standing in a shell, so they
   * stay relative to the working directory; a collection's globs were written
   * next to the config, so they resolve from there.
   */
  base: string;
  /**
   * Directory holding the config that governed the run, when one did.
   *
   * Distinct from `base`: `base` follows *the inputs*, so it is the working
   * directory whenever positional paths were given. Anything written **in** the
   * config — the `baseline:` path — is relative to the config itself no matter
   * where the command was run from, which is the whole point of discovering an
   * ancestor config in the first place.
   */
  configDir?: string;
  /**
   * Absolute path of the config file itself, when one governs the run. The
   * one honest way to edit the governing config: discovery accepts both
   * `docmeta.config.yaml` and `.yml`, `-c` accepts any name, and the file may
   * live in an ancestor — so re-deriving the path from a directory plus an
   * assumed filename names the wrong file in every one of those setups.
   */
  configPath?: string;
  /**
   * The key the tool's config sits under in that file — `meta` for a family
   * file, `undefined` for a legacy per-tool file whose whole document is the
   * section.
   *
   * Anything that *rewrites* the config by hand has to know: `schemas:` is at
   * the top level of a legacy file and one level down in a family file, so a
   * rewriter that assumes the top level silently finds nothing in the shape
   * proposal 0033 made the default. `query`'s DDL repointing did exactly that
   * until the 0041 fixtures stopped being legacy files and made it visible.
   */
  configSection?: string;
  /**
   * The collections this run covers (proposal 0041): every declared one, or
   * the ones `--collection` named. `[]` when no config governs the run.
   *
   * Selected even when the inputs are positional, because membership is what
   * external metadata attaches to (rule 4) and a file the operator typed is
   * still a member of whatever collections contain it.
   */
  collections: CollectionConfig[];
  /**
   * Every collection the config declares, in declaration order — the same list
   * `collections` narrows. `query` needs both: membership and manifests follow
   * the *selected* set, while every *declared* collection is a SQL view (0041
   * rule 11), so a statement naming one the run did not select still answers.
   */
  declaredCollections: CollectionConfig[];
  /**
   * Whether `inputs` came from the collections rather than the command line.
   * The corpus invariant every scoped check reads: a positional path means the
   * operator chose part of the corpus.
   */
  fromCollections: boolean;
}

/**
 * Settle the three things every command core needs from config before it can
 * touch the filesystem: which config governs the run, what to resolve, and
 * what those relative paths are relative to.
 */
export async function resolveRunConfig(
  opts: RunConfigOptions,
): Promise<RunConfig> {
  // `--no-config` wins over an explicit path. The CLI cannot supply both (they
  // are one commander option), but the cores are public API.
  const cwd = opts.cwd ?? process.cwd();

  // `--collection` names something only a config can define, and it selects a
  // set the operator did not type — so it composes with neither positional
  // paths nor `--no-config`. Both refusals come before discovery, so the
  // message is about the flags rather than about whatever the walk found.
  const wanted = opts.collections ?? [];
  if (wanted.length > 0) {
    const typed = opts.inputs.filter((i) => i !== STDIN_TOKEN_LITERAL);
    if (typed.length > 0) {
      throw new DocmetaError(
        "--collection selects a configured collection; it cannot be combined with paths.",
      );
    }
  }

  const loaded = opts.noConfig ? null : await loadConfig(opts.configPath, cwd);
  if (wanted.length > 0 && loaded === null) {
    throw new DocmetaError("--collection needs a config file to select from.");
  }
  if (loaded) opts.onConfigLoaded?.({ path: loaded.path, dir: loaded.dir });

  const config = loaded
    ? rebaseConfigSchemaRefs(loaded.config, loaded.dir, cwd)
    : null;

  // Selected whatever the inputs are: a positional file is still a member of
  // the collections that contain it, so its manifests have to be loadable.
  const collections = loaded
    ? selectCollections(
        loaded.collections,
        opts.collections,
        loaded.source,
        (message) => new DocmetaError(message),
      )
    : [];

  const fromCollections = opts.inputs.length === 0;
  const inputs = fromCollections
    ? collections.flatMap((c) => c.paths)
    : opts.inputs;
  const base = fromCollections && inputs.length > 0 && loaded ? loaded.dir : cwd;

  return {
    config,
    inputs,
    base,
    collections,
    declaredCollections: loaded ? [...loaded.collections] : [],
    fromCollections,
    ...(loaded
      ? {
          configDir: loaded.dir,
          configPath: loaded.path,
          ...(loaded.section === undefined ? {} : { configSection: loaded.section }),
        }
      : {}),
  };
}
