/**
 * The derived metadata channel: values computed from git history, CODEOWNERS
 * and the review record on GitHub or GitLab rather than written by hand.
 *
 * A derived value never merges into what the schema sees. `manni meta derive`
 * stamps the managed fields (`derive.fields` in the config) into the
 * document, and `validate` reports a managed field whose asserted value
 * differs from the derived one as a finding. This module holds the shared
 * vocabulary — which fields can be derived, from which sources — and the two
 * pure steps every source feeds: comparing an asserted value with a derived
 * one, and turning the stale comparisons into findings.
 */
import type { ExtractedMetadata, FieldError } from "../../types.js";
import { escapePointerSegment } from "../../extractors/pointer.js";
import { toJsonText } from "../json-text.js";

/** The six built-in fields, in the order messages list them. */
export const DERIVABLE_FIELDS = [
  "created",
  "last-updated",
  "authors",
  "owner",
  "reviewed-by",
  "last-reviewed",
] as const;

export type BuiltinDerivableField = (typeof DERIVABLE_FIELDS)[number];

/**
 * A managed field name: one of the six built-ins, or a key with an entry in
 * `derive.commands`. The config parser guarantees one or the other.
 */
export type DerivableField = string;

export function isBuiltinField(x: string): x is BuiltinDerivableField {
  return (DERIVABLE_FIELDS as readonly string[]).includes(x);
}

/** The guard under its old name, kept for API stability. */
export const isDerivableField = isBuiltinField;

/** Every source `derive.sources` may name; absent means all five. */
export const DERIVE_SOURCES = ["git", "codeowners", "github", "gitlab", "command"] as const;

export type DeriveSource = (typeof DERIVE_SOURCES)[number];

/**
 * One configured command, as `derive.commands` reads after parsing: the argv
 * to run, the program first, and how long to wait for it.
 */
export interface DeriveCommand {
  run: readonly string[];
  timeoutMs: number;
}

export function isDeriveSource(x: string): x is DeriveSource {
  return (DERIVE_SOURCES as readonly string[]).includes(x);
}

/**
 * One fact a source produced, with where it came from. `evidence` is the
 * short human-readable trail a finding quotes — a commit, a CODEOWNERS line,
 * a pull request — so the reader can check the claim without re-running.
 */
export interface DerivedValue {
  value: unknown;
  source: DeriveSource;
  evidence: string;
}

/**
 * Everything derived for one document. A `null` field means a source was
 * consulted and had no fact to offer (a file with no commits yet, a path no
 * CODEOWNERS rule matches); an absent field means no source answered for it.
 */
export interface DerivedRecord {
  file: string;
  fields: Record<DerivableField, DerivedValue | null>;
}

/** Whether a source can answer at all; `reason` names the fix when not. */
export interface SourceStatus {
  available: boolean;
  reason?: string;
}

/** Which host the origin remote points at, and what to call the project there. */
export interface RemoteIdentity {
  kind: "github" | "gitlab";
  host: string;
  /** `owner/repo` on GitHub; the full namespace path on GitLab. */
  project: string;
}

/** One `APPROVED` review, the latest per reviewer. */
export interface Approval {
  login: string;
  /** ISO-8601. */
  submittedAt: string;
}

/** The merged PR/MR that carried a commit. Immutable once merged, so cacheable. */
export interface MergedChange {
  /** The PR number or MR iid. */
  id: number;
  /** ISO-8601. */
  mergedAt: string;
  /** Approvals only, deduplicated by login; the built-in clients order them oldest first. */
  approvals: Approval[];
}

/**
 * The review half of the derive context: the merged change behind a commit and
 * who approved it. Reached through `gh` / `glab`, never an HTTP client — see
 * `reviews.ts`.
 */
export interface ReviewClient {
  detect(): Promise<RemoteIdentity | null>;
  /** Binary on PATH and authenticated for the host; `reason` names the fix. */
  status(): Promise<SourceStatus>;
  /** The merged PR/MR that contains the commit, or null (open, none, or unknown). */
  mergedChangeFor(sha: string): Promise<MergedChange | null>;
}

/** One document as the sources see it. */
export interface DeriveInput {
  label: string;
  absPath: string;
  content: string;
  extracted: ExtractedMetadata;
}

/** What a derive run holds constant across every document it visits. */
export interface DeriveContext {
  cwd: string;
  base: string;
  configDir?: string;
  sources: readonly DeriveSource[];
  fields: readonly DerivableField[];
  /** CODEOWNERS path, when the config names one; resolved from `configDir`. */
  codeowners?: string;
  /** The `command` source's table, by the field each command derives; absent means none configured. */
  commands?: Readonly<Record<string, DeriveCommand>>;
  cache: boolean;
  now: () => Date;
  /** The review client for every repository in the run; the built-in `gh` / `glab` clients when absent. */
  reviews?: ReviewClient;
}

/**
 * How an asserted value stands against the derived one.
 *
 * - `current` — they agree.
 * - `stale` — the document says one thing and a source says another.
 * - `unset` — the document says nothing and a source has a value.
 * - `unknown` — no source could answer, so nothing is claimed either way.
 */
export type DerivedStatus = "current" | "stale" | "unset" | "unknown";

export interface DerivedField {
  field: DerivableField;
  /** What the document carries; absent when it carries nothing. */
  asserted?: unknown;
  /** What the sources say; `null` when they could not answer. */
  derived: unknown;
  source?: DeriveSource;
  evidence?: string;
  status: DerivedStatus;
  /** Whether `derive` wrote the value into the document. */
  written: boolean;
}

/**
 * The `schema` ref a stale-field finding carries, and so its baseline and
 * rule identity: `derived:stale/derived`. Shaped like `check:<name>` and
 * `sidecar:owned` so `classifyRef` passes it through as a built-in id rather
 * than resolving it as a cwd-relative file path, and reserved in the registry
 * for the same reason those are.
 */
export const DERIVED_STALE_SCHEMA = "derived:stale";

/** The `keyword` every derived finding carries: no Ajv keyword produced it. */
export const DERIVED_KEYWORD = "derived";

/**
 * Compare what a document asserts with what a source derived.
 *
 * Pure. Lists compare as sets — order-insensitive, members deep-equal — so a
 * reordered `authors:` is not a stale one. A missing or `null` derived value
 * means the sources could not answer, which is `unknown` rather than a
 * verdict either way. `written` is always false here; only `derive` writes.
 */
export function compareDerived(
  field: DerivableField,
  asserted: unknown,
  derived: DerivedValue | null | undefined,
): DerivedField {
  const base = {
    field,
    ...(asserted !== undefined ? { asserted } : {}),
  };
  if (derived == null) {
    return { ...base, derived: null, status: "unknown", written: false };
  }
  const status: DerivedStatus =
    asserted === undefined
      ? "unset"
      : deepEqual(asserted, derived.value)
        ? "current"
        : "stale";
  return {
    ...base,
    derived: derived.value,
    source: derived.source,
    evidence: derived.evidence,
    status,
    written: false,
  };
}

/**
 * The findings `validate` files for a document's managed fields: one per
 * field that is `stale` or `unset`. Current and unknown fields file nothing.
 *
 * `lineFor` is the document's own pointer lookup, so a finding lands on the
 * line the asserted key sits on; an unset field has no line.
 */
export function staleFindings(
  fields: readonly DerivedField[],
  lineFor: (pointer: string) => number | undefined,
): FieldError[] {
  const findings: FieldError[] = [];
  for (const f of fields) {
    if (f.status !== "stale" && f.status !== "unset") continue;
    const instancePath = `/${escapePointerSegment(f.field)}`;
    const line = lineFor(instancePath);
    const says = `${f.source ?? "a source"} says ${fmt(f.derived)}`;
    const trail = f.evidence === undefined ? "" : ` (${f.evidence})`;
    const head =
      f.status === "stale"
        ? `${f.field} says ${fmt(f.asserted)}`
        : `${f.field} is not set`;
    findings.push({
      schema: DERIVED_STALE_SCHEMA,
      keyword: DERIVED_KEYWORD,
      subject: f.field,
      instancePath,
      message: `${head}; ${says}${trail} — run manni meta derive`,
      ...(line !== undefined ? { line } : {}),
    });
  }
  return findings;
}

/** Strings bare, everything else as compact JSON. */
function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  return toJsonText(value) ?? String(value);
}

/**
 * Structural equality with lists as multisets.
 *
 * Objects compare key by key; lists compare by matching each member of one
 * against an unused member of the other, so `[a, b]` equals `[b, a]` but not
 * `[a, a]`. Leaves compare through their JSON text, which is the projection
 * every reporter and the query table already use, so a `Date` and its ISO
 * string agree here exactly when they agree there.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (isList(a) || isList(b)) {
    if (!isList(a) || !isList(b) || a.length !== b.length) return false;
    const unused = [...b];
    for (const x of a) {
      const i = unused.findIndex((y) => deepEqual(x, y));
      if (i === -1) return false;
      unused.splice(i, 1);
    }
    return true;
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(
      (k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]),
    );
  }
  return toJsonText(a) === toJsonText(b);
}

/** `Array.isArray` narrows `unknown` to `any[]`; this keeps the members unknown. */
function isList(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" && v !== null && !isList(v) && !(v instanceof Date)
  );
}
