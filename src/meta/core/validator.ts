/**
 * JSON Schema validation engine. Compiles and caches an Ajv validator per
 * schema reference, validates extracted metadata against each schema in a set,
 * and maps every violation to a {schema, instancePath, line, col} FieldError.
 */
import * as AjvDraft07Ns from "ajv";
import * as Ajv2019Ns from "ajv/dist/2019.js";
import * as Ajv2020Ns from "ajv/dist/2020.js";
import * as AjvDraft04Ns from "ajv-draft-04";
import * as addFormatsNs from "ajv-formats";
import { createRequire } from "node:module";
import type {
  DefinedError,
  ErrorObject,
  ValidateFunction,
} from "ajv/dist/2020.js";
import { DocmetaError, type FieldError } from "../types.js";
import type { SourceLocation } from "./external-metadata.js";
import { escapePointerSegment } from "../extractors/pointer.js";

// ajv ships its meta-schema refs as JSON. A static JSON import survives
// bundling as a bare ESM import without the required `type: json` attribute, so
// load it through `require` instead (ajv is an external dep at runtime).
const draft06MetaSchema = createRequire(import.meta.url)(
  "ajv/dist/refs/json-schema-draft-06.json",
) as Record<string, unknown>;

// ajv and ajv-formats are CommonJS with a default export; under NodeNext the
// callable/constructable value lives on `.default`. Cast through the named
// default types so tsc sees a constructor / callable. The per-dialect builds
// expose the same shape, so we treat them all as the 2020 constructor type.
type AjvCtor = typeof import("ajv/dist/2020.js").default;
const AjvDraft07 = AjvDraft07Ns.default as unknown as AjvCtor;
const Ajv2019 = Ajv2019Ns.default as unknown as AjvCtor;
const Ajv2020 = Ajv2020Ns.default as unknown as AjvCtor;
const AjvDraft04 = AjvDraft04Ns.default as unknown as AjvCtor;
const addFormats =
  addFormatsNs.default as unknown as typeof import("ajv-formats").default;
import {
  loadSchema,
  publishedBuiltins,
  type LoadSchemaOptions,
} from "./schema-registry.js";
import { FILE_SCHEMA_KEY } from "./resolve-schema.js";
import { ENCRYPT_KEYWORD } from "./encrypted.js";

type Dialect = "2020" | "2019" | "draft7" | "draft4";

/**
 * Pick a JSON Schema dialect from a schema's own `$schema` meta-schema URI.
 * Remote schemas commonly target draft-07/draft-04, which the 2020 build can't
 * compile, so each dialect gets its own Ajv. A missing or unrecognized
 * `$schema` falls back to 2020 (the dialect of the built-ins).
 */
function dialectOf(schema: Record<string, unknown>): Dialect {
  const meta = typeof schema.$schema === "string" ? schema.$schema : "";
  if (meta.includes("2019-09")) return "2019";
  // draft-06 shares the draft-07 build (its meta-schema is registered there).
  if (
    meta.includes("draft-07") ||
    meta.includes("draft/7") ||
    meta.includes("draft-06") ||
    meta.includes("draft/6")
  ) {
    return "draft7";
  }
  if (meta.includes("draft-04") || meta.includes("draft/4")) return "draft4";
  return "2020";
}

function buildAjv(dialect: Dialect): InstanceType<AjvCtor> {
  // strict: false so user-supplied schemas with lax metadata still compile.
  const opts = { allErrors: true, strict: false } as const;
  const ajv =
    dialect === "2019"
      ? new Ajv2019(opts)
      : dialect === "draft7"
        ? new AjvDraft07(opts)
        : dialect === "draft4"
          ? new AjvDraft04(opts)
          : new Ajv2020(opts);
  addFormats(ajv);
  // draft-06 shares the draft-07 build; register its meta-schema so draft-06
  // schemas compile too rather than erroring on an unknown `$schema`.
  if (dialect === "draft7") ajv.addMetaSchema(draft06MetaSchema);
  registerEncryptKeyword(ajv);
  registerBuiltins(ajv, dialect);
  return ajv;
}

/**
 * Where `x-manni-encrypt: true` records the instance pointers it is evaluated
 * at, while `markedPointers` is running. `undefined` the rest of the time, so
 * an ordinary validation pays one comparison per marked property.
 *
 * Module state is safe here because a compiled validator is synchronous: the
 * recorder is set, the one call runs to completion, and it is cleared, all in
 * one tick. `fill`'s worker pool interleaves only at its awaits, and there is
 * none inside that window.
 */
let markRecorder: Set<string> | undefined;

/**
 * `x-manni-encrypt` (proposal 0045), on every Ajv meta builds. It never fails
 * a value: validation of a marked property is the rest of its schema, run on
 * the decrypted copy. What it does is say where it was evaluated, so Ajv's
 * own resolution — `$ref`, `allOf`, a referenced built-in, the `anyOf`,
 * `oneOf` and `if` branches it takes — decides where a mark counts.
 *
 * The boolean meta-schema is what refuses `"x-manni-encrypt": "yes"` at
 * compile time; `compileUncached` turns Ajv's wording into the one message
 * the plan ships.
 */
function registerEncryptKeyword(ajv: InstanceType<AjvCtor>): void {
  ajv.addKeyword({
    keyword: ENCRYPT_KEYWORD,
    metaSchema: { type: "boolean" },
    errors: false,
    validate: (
      schema: unknown,
      _data: unknown,
      _parent?: unknown,
      cxt?: { instancePath: string },
    ): boolean => {
      if (schema === true && markRecorder !== undefined) {
        markRecorder.add(cxt?.instancePath ?? "");
      }
      return true;
    },
  });
}

/** Ajv's compile error for a non-boolean mark names the keyword. */
function isMarkShapeError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(`"${ENCRYPT_KEYWORD}"`);
}

/**
 * Make every built-in resolvable as a `$ref` target, under both of its names.
 *
 * Ajv is constructed with no `loadSchema`, so before this a user's schema could
 * not `$ref` a built-in by **any** route — not the published URL (nothing to
 * fetch it with) and not the docmeta id either, even though the schema was
 * bundled and would later be compiled into this very instance. Both failed with
 * "can't resolve reference … from id #", which reads like the published file is
 * broken. Proposal 0009 stress test 5.
 *
 * Three mechanics that are easy to get wrong:
 *
 * - **One call per built-in.** `addSchema(schema, url)` registers under the key
 *   *and* under the schema's own `$id`, so the id form comes for free. Calling
 *   it a second time under the id throws "schema with key or id … already
 *   exists".
 * - **Meta-schema validation is off for these.** All the built-ins are
 *   2020-12, and the 2019/draft-07/draft-04 instances do not carry that
 *   meta-schema — `addSchema` would throw `no schema with key or ref
 *   "https://json-schema.org/draft/2020-12/schema"` and take out every Ajv but
 *   one. These are docmeta's own files, covered by their own tests, so skipping
 *   the check costs nothing. The flag is per call: a *user's* schema is still
 *   validated normally.
 * - **All four dialects, not just 2020.** `dialectOf` picks the instance from
 *   the *user's* `$schema`, so a draft-07 house schema extending OKF compiles in
 *   the draft-07 Ajv and needs the built-ins registered there too.
 *
 * Registration is lazy — Ajv compiles a stored schema only when something
 * references it — so this costs a map insert per built-in, not fifteen compiles.
 *
 * Called from `buildAjv` rather than from `Validator`, deliberately:
 * `compileWithFormats` builds its own throwaway instance for `fill`'s proposal
 * envelope, which lifts subschemas out of the user's schemas and would
 * otherwise lose every `$ref` into a built-in.
 */
function registerBuiltins(ajv: InstanceType<AjvCtor>, dialect: Dialect): void {
  for (const { id, url, legacyUrl, schema } of publishedBuiltins()) {
    ajv.addSchema(schema, url, undefined, false);
    // A user schema written before the rename `$ref`s the old URL. Same bytes,
    // same object; only the key differs.
    ajv.addSchema(schema, legacyUrl, undefined, false);
    // draft-04 predates `$id` — `ajv-draft-04` reads `id` instead — so the URL
    // key is the only registration the call above produces there, and the id
    // form has to be added explicitly. It does not throw as a duplicate for the
    // same reason: `$id` was never registered.
    if (dialect === "draft4") ajv.addSchema(schema, id, undefined, false);
  }
}

/**
 * Compile an ad-hoc 2020-12 schema with docmeta's format support.
 *
 * `fill` needs this for the proposal envelope it builds around a document
 * schema's own property subschemas: those routinely carry `format: "date-time"`
 * / `"uri"`, and an Ajv without `ajv-formats` refuses to compile them outright.
 */
export function compileWithFormats(
  schema: Record<string, unknown>,
): ValidateFunction {
  return buildAjv("2020").compile(schema);
}

/**
 * A bare Ajv carrying exactly the `addFormats` registration `buildAjv`
 * performs — the reference for what "a format docmeta enforces" means.
 * Shared by the two helpers below; built once, lazily.
 */
let formatRegistry: InstanceType<AjvCtor> | undefined;
function formatsAjv(): InstanceType<AjvCtor> {
  if (!formatRegistry) {
    formatRegistry = new Ajv2020({ strict: false });
    addFormats(formatRegistry);
  }
  return formatRegistry;
}

/**
 * The format names docmeta's validators enforce on strings, derived from the
 * ajv-formats registration itself — never a hand-copied parallel list, so an
 * ajv-formats upgrade widens this set without anyone remembering it (proposal
 * 0028). Two exclusions, both because they do not constrain a string:
 * number-typed formats (`int32`, `float`, …) and always-pass placeholders
 * (`password`, `binary`, registered as `true`).
 */
let stringFormatsMemo: ReadonlySet<string> | undefined;
export function stringFormatNames(): ReadonlySet<string> {
  if (!stringFormatsMemo) {
    const names = new Set<string>();
    const registered: Record<string, unknown> = formatsAjv().formats;
    for (const [name, def] of Object.entries(registered)) {
      const enforcesStrings =
        def instanceof RegExp ||
        typeof def === "function" ||
        (typeof def === "object" &&
          def !== null &&
          ((def as { type?: string }).type === undefined ||
            (def as { type?: string }).type === "string"));
      if (enforcesStrings) names.add(name);
    }
    stringFormatsMemo = names;
  }
  return stringFormatsMemo;
}

/**
 * Does `value` satisfy the named format? Answered by compiling
 * `{type: "string", format: name}` in the same registry — the exact machinery
 * `validate` enforces the format with, so there is no second opinion about
 * what a `date` is (0028's DEFAULT guard).
 */
const formatCheckers = new Map<string, ValidateFunction>();
export function validatesFormat(name: string, value: string): boolean {
  let fn = formatCheckers.get(name);
  if (!fn) {
    fn = formatsAjv().compile({ type: "string", format: name });
    formatCheckers.set(name, fn);
  }
  return fn(value);
}

export class Validator {
  /**
   * How this validator's schemas are loaded: the disk cache location, its TTL,
   * and `--offline`. Held per instance rather than read from module state, so
   * two differently-configured validations in one process each get their own
   * settings.
   *
   * That is not full isolation, and the difference matters to a library
   * caller: `schema-registry` keeps a process-wide memo of fetched schemas, so
   * one validator's successful fetch is visible to another. `offline` is
   * excluded from that sharing on purpose — an offline validator will not be
   * served something this process pulled over the network — but the memo is
   * still shared, so a URL fetched once is not re-fetched per instance.
   */
  constructor(private readonly schemaOptions: LoadSchemaOptions = {}) {}

  private ajvByDialect = new Map<Dialect, InstanceType<AjvCtor>>();
  /**
   * Keyed on the in-flight *promise*, not the resolved validator. Caching the
   * result made this a check-then-act race: `fill` walks files through a worker
   * pool, so every worker missed the cache while the first `loadSchema` was
   * still pending and they all then compiled the same schema into the one
   * shared per-dialect Ajv. Ajv registers a schema's `$id` on the first compile
   * and rejects the second with "schema with key or id ... already exists",
   * which took down any multi-file run against an $id-bearing schema. Storing
   * the promise before the first await lets the losers await the one compile.
   */
  private cache = new Map<string, Promise<ValidateFunction>>();

  private ajvFor(dialect: Dialect): InstanceType<AjvCtor> {
    let ajv = this.ajvByDialect.get(dialect);
    if (!ajv) {
      ajv = buildAjv(dialect);
      this.ajvByDialect.set(dialect, ajv);
    }
    return ajv;
  }

  /**
   * Synchronous by design: the `cache.set` has to happen in the same tick as
   * the miss, or a second caller can slip in before the entry exists.
   */
  private compile(ref: string): Promise<ValidateFunction> {
    const cached = this.cache.get(ref);
    if (cached) return cached;
    const pending = this.compileUncached(ref);
    this.cache.set(ref, pending);
    // A failed load or compile is not cached — a transient fetch failure must
    // stay retryable rather than poisoning the ref for this Validator's life.
    // The extra `catch` keeps the eviction off the returned promise's chain, so
    // it does not convert the rejection into a handled one for the caller.
    pending.catch(() => {
      if (this.cache.get(ref) === pending) this.cache.delete(ref);
    });
    return pending;
  }

  private async compileUncached(ref: string): Promise<ValidateFunction> {
    const schema = await loadSchema(ref, this.schemaOptions);
    try {
      const ajv = this.ajvFor(dialectOf(schema));
      // This cache is keyed on the ref string, but Ajv's registry is keyed on
      // `$id` — so one schema named two ways (a published URL in a document's
      // `$schema`, a local path on the command line) misses the cache twice and
      // Ajv rejects the second compile as a duplicate id. Reuse the existing
      // registration instead. `$id` is the schema's identity as far as Ajv is
      // concerned, so if two refs claim the same one, sharing a validator is
      // the only reading available — the alternative is the hard error this
      // replaces.
      //
      // Reused only when the registration really is *this* object. Sharing on
      // the id alone was tolerable while a registration could only come from an
      // earlier compile in the same run. It stopped being tolerable when
      // `registerBuiltins` began pre-loading every built-in into every
      // instance: an id collision is no longer a race whose outcome depends on
      // ordering, it is certain, and the built-in always wins.
      //
      // What that would silently override is a vendored built-in the user then
      // edited — the workflow proposal 0009 actively encourages. `schemas
      // vendor` writes a copy carrying `$id: google:okf:0.1`, so a house rule
      // added to that copy would simply not apply, while the report went on
      // naming the local path.
      //
      // A different schema claiming a taken id is compiled on its own merits,
      // with the id dropped from a shallow copy: Ajv refuses a second schema
      // under one id, and the id is not what identifies a schema here anyway —
      // the *ref* is what reports name, what baselines fingerprint, and what
      // this cache is keyed on.
      const id = typeof schema["$id"] === "string" ? schema["$id"] : undefined;
      const registered = id != null ? ajv.getSchema(id) : undefined;
      if (registered) {
        if (registered.schema === schema) return registered;
        const { $id: _taken, ...anonymous } = schema;
        return ajv.compile(anonymous);
      }
      return ajv.compile(schema);
    } catch (err) {
      if (isMarkShapeError(err)) {
        throw new DocmetaError(
          `${ref}: "${ENCRYPT_KEYWORD}" must be true or false.`,
        );
      }
      throw new DocmetaError(
        `Schema "${ref}" failed to compile: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The instance pointers of `data` that carry `x-manni-encrypt: true` under
   * any schema in `refs`, in the order the validator evaluated them.
   *
   * A first pass with the recording keyword, so a mark counts exactly where
   * validation would evaluate it. Only present values are marked: Ajv applies
   * a property's subschema to a property that exists. A branch Ajv does not
   * take (`then` behind a failing `if`, an `anyOf` branch after a passing
   * one) contributes nothing; a branch it takes contributes its marks
   * whether or not the branch passes, because a ciphertext routinely fails
   * the rest of its own subschema until it is decrypted.
   */
  async markedPointers(
    data: Record<string, unknown>,
    refs: string[],
  ): Promise<Set<string>> {
    const { [FILE_SCHEMA_KEY]: _omit, ...subject } = data;
    void _omit;
    const marks = new Set<string>();
    for (const ref of refs) {
      const fn = await this.compile(ref);
      markRecorder = marks;
      try {
        fn(subject);
      } finally {
        markRecorder = undefined;
      }
    }
    return marks;
  }

  /**
   * Validate `data` against every schema in `refs`. Returns all violations,
   * each tagged with the schema that produced it and a source line via
   * `lineFor`.
   *
   * `colFor` is optional and additive: this signature is public, so a fourth
   * *required* parameter — or a widened third one — would be a consumer break.
   * Callers with an extractor that supplies no column pass nothing and get the
   * previous behavior exactly.
   */
  async validate(
    data: Record<string, unknown>,
    refs: string[],
    lineFor: (pointer: string) => number | undefined,
    colFor?: (pointer: string) => number | undefined,
    /**
     * Where a merged value lives when it is not in the document (proposal
     * 0037): a manifest's file and line. Consulted before `lineFor`,
     * and additive in the way `colFor` was.
     */
    locate?: (pointer: string) => SourceLocation | undefined,
  ): Promise<FieldError[]> {
    // `$schema` is a docmeta directive, not part of the document's metadata —
    // strip it so schemas with additionalProperties:false don't flag it.
    const { [FILE_SCHEMA_KEY]: _omit, ...subject } = data;
    void _omit;

    const errors: FieldError[] = [];
    for (const ref of refs) {
      const fn = await this.compile(ref);
      const ok = fn(subject);
      if (ok) continue;
      for (const e of fn.errors ?? []) {
        errors.push(toFieldError(ref, e, lineFor, colFor, locate));
      }
    }
    return errors;
  }
}

/**
 * The stable identifier inside a violation's `params`, when there is one.
 *
 * Only keywords whose parameter names a *thing* qualify. `pattern` carries the
 * regex source and `enum`/`minLength`/`minimum` carry schema-authored values:
 * including those would change a violation's identity every time the schema
 * author edited the rule, which is exactly what a baseline must survive.
 *
 * `DefinedError` is Ajv's own discriminated union over `keyword`, so each arm
 * below is type-checked against the real `params` shape rather than duck-typed.
 */
function subjectOf(e: DefinedError): string | undefined {
  switch (e.keyword) {
    case "required":
      return e.params.missingProperty;
    case "additionalProperties":
      return e.params.additionalProperty;
    case "format":
      return e.params.format;
    case "type":
      // A union schema (`"type": ["string", "null"]`) yields the comma-joined
      // `"string,null"` rather than a single name. That is stable, so it
      // fingerprints correctly — but anyone matching on `subject` downstream
      // should not assume one type per value.
      return e.params.type;
    default:
      return undefined;
  }
}

function toFieldError(
  schema: string,
  e: ErrorObject,
  lineFor: (pointer: string) => number | undefined,
  colFor?: (pointer: string) => number | undefined,
  locate?: (pointer: string) => SourceLocation | undefined,
): FieldError {
  // Ajv's documented way to narrow: every error it raises for a built-in
  // vocabulary is a member of `DefinedError`, but `ValidateFunction.errors` is
  // typed as the open `ErrorObject` to leave room for custom keywords.
  const defined = e as DefinedError;
  const instancePath = e.instancePath;
  const subject = subjectOf(defined);
  // Both of these point `instancePath` at the *parent* object and name the
  // property in the message, so neither gets a column.
  //
  // The parent exists, so `colFor` answers happily — with the parent's column,
  // which is a different token from the one the message is about. For
  // `required` the property is not in the file at all; for
  // `additionalProperties` it is, but somewhere else entirely, and the parent
  // of a document's root is the root, whose recorded position is 1:1. So a
  // stray key on line 40 was annotated at line 1 column 1, a caret on the first
  // character of the file.
  //
  // A `line` on the parent is a useful "look around here". A caret is a claim
  // about one character, and for these two keywords it would be the wrong one.
  let message = e.message ?? "is invalid";
  let wantsColumn = true;
  if (defined.keyword === "required") {
    message = `must have required property '${defined.params.missingProperty}'`;
    wantsColumn = false;
  } else if (defined.keyword === "additionalProperties") {
    message = `must NOT have additional property '${defined.params.additionalProperty}'`;
    wantsColumn = false;
  }
  // A value a manifest supplied is not in the document, so `lineFor` has no
  // answer for it; `locate` does. `additionalProperties` is the one keyword
  // whose offending value sits at a *child* of `instancePath`, and when that
  // child came from the manifest, the manifest line is where a reader should
  // look — a public schema refusing a private key is exactly the case.
  const located =
    locate?.(instancePath) ??
    (defined.keyword === "additionalProperties"
      ? locate?.(
          `${instancePath}/${escapePointerSegment(defined.params.additionalProperty)}`,
        )
      : undefined);
  if (located) {
    return {
      schema,
      instancePath,
      message,
      keyword: e.keyword,
      ...(subject != null ? { subject } : {}),
      file: located.file,
      ...(located.line != null ? { line: located.line } : {}),
      ...(wantsColumn && located.col != null ? { col: located.col } : {}),
    };
  }
  const line = lineFor(instancePath);
  const col = wantsColumn ? colFor?.(instancePath) : undefined;
  return {
    schema,
    instancePath,
    message,
    keyword: e.keyword,
    ...(subject != null ? { subject } : {}),
    ...(line != null ? { line } : {}),
    ...(col != null ? { col } : {}),
  };
}
