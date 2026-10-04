/**
 * `manni graph fill` — propose SKOS frontmatter fields (the `graph:` block) with an
 * LLM and write them back. Single-shot structured output per doc, content-hash
 * cached, bounded by a turn budget. Human-set fields are never overwritten
 * without `--force`; `--dry-run` reports without writing. Any per-doc failure
 * is recorded as a result, never aborts the run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { analyzeDoc, formatOf, type DocFormat } from "../core/analyze.js";
import { loadRunConfig, type FillField } from "../core/config.js";
import type { DocModel } from "../types.js";
import {
  assertInputFormat,
  documentSetPatterns,
  resolveDocumentSet,
  STDIN,
  type DocumentInputOptions,
} from "../core/discover.js";
import { STDIN_PATH } from "../core/iri.js";
import {
  applyGraphFields,
  existingGraphFields,
  existingMetaProvenance,
  frontmatterKind,
} from "../core/frontmatter-edit.js";
import { writeFileAtomic } from "../../meta/index.js";
import {
  mergeMetaProvenance,
  spliceManifestValue,
  urlManifestMessage,
  type KeyHome,
  type MetaPageView,
} from "../../meta/internal.js";
import { isMissing } from "../../shared/manifest-cas.js";
import { mergePage, openMetaView, ownMetadata } from "../core/external.js";
import { FillGuard } from "../core/fill-guard.js";
import { bundledShapesPath } from "../core/pkg.js";
import { errorMessage } from "../../shared/errors.js";
import { GraphError } from "../types.js";
import {
  completeValidatedJSON,
  validatorFor,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { FillCache, cacheKey } from "../llm/cache.js";
import {
  SYSTEM_PROMPT,
  SECTION_FILL_FIELDS,
  buildUserPrompt,
  proposalSchema,
} from "../llm/prompt.js";
import {
  announceSelection,
  assertProviderSelection,
  constructProvider,
  resolveProviderIdentity,
  selectProvider,
} from "../llm/provider.js";

export interface FillOptions extends DocumentInputOptions {
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  noCache?: boolean;
  /**
   * Stop after this many inference calls; overrides `fill.maxTurns`. A cached
   * proposal spends none (proposal 0051 §3).
   */
  maxTurns?: number;
  /**
   * Minimum model confidence to write a field; overrides
   * `fill.confidenceThreshold`.
   */
  confidence?: number;
  /** Fields to propose; overrides `fill.fields`. */
  fields?: FillField[];
  provider?: string;
  model?: string;
  /** Run inference on this machine with llama-cpp, over every configured choice. */
  local?: boolean;
  /** Disable the graph guardrail (`--no-validate-graph`). */
  noValidateGraph?: boolean;
  /** Propose per-section metadata as well as document-level (ADR 01032). */
  sections?: boolean;
  /** Injection seam for tests: bypasses the provider factory. */
  providerInstance?: InferenceProvider;
  /**
   * What `-` reads: the document from stdin, read by the caller. Required when
   * `paths` holds `-`. It is never written to disk: the report's
   * `stdinDocument` carries it back, filled or as it came.
   */
  stdinContent?: string;
  /** `--allow-empty`: zero matched files is an empty report, not an error. */
  allowEmpty?: boolean;
}

export type FillStatus =
  | "filled"
  | "proposed" // dry run: would write
  | "complete" // nothing missing
  | "nothing-proposed"
  | "skipped"
  | "error";

/** Why a page was skipped. The only reason today is the turn budget. */
export const TURN_BUDGET_REASON = "turn budget";

export interface FillDocResult {
  path: string;
  status: FillStatus;
  /**
   * Why a `skipped` page was skipped, said rather than left to be inferred —
   * the half of graph ADR 01027 that survives the dollar cap's removal.
   */
  reason?: string;
  /** Fields written (or that would be written under --dry-run). */
  fields: string[];
  /** Human-set fields the proposal was not allowed to touch. */
  preserved: string[];
  /** Fields dropped by the graph guardrail (fill.validateGraph). */
  rejected?: string[];
  /**
   * Section slugs the model proposed that match no heading in the document.
   * Dropped rather than written: writing one would mint a
   * graph:brokenSectionRef, a finding fill must report and never manufacture
   * (ADR 01032).
   */
  unknownSections?: string[];
  /** Fields the model proposed but scored below the confidence threshold (ADR 01015). */
  lowConfidence?: Array<{
    field: string;
    confidence: number;
    reasoning?: string;
  }>;
  cached: boolean;
  error?: string;
}

export interface FillReport {
  results: FillDocResult[];
  /**
   * Inference calls this run made. Turns are countable for every model, where
   * a price was known for six of them — which is why the dollar cap went (graph
   * ADR 01027, proposal 0051 §3).
   */
  turnsUsed: number;
  /** The budget in force, or `null` for unbounded. */
  maxTurns: number | null;
  /** Non-fatal diagnostics. Never affects the exit code. */
  warnings: string[];
  exitCode: 0 | 1;
  /**
   * The document read from stdin, with the accepted fields written into it,
   * or unchanged when nothing was written. Absent when the run read no stdin
   * or the page errored. The CLI prints it to stdout; it is not part of the
   * rendered report.
   */
  stdinDocument?: string;
}

/** SKOS relation fields that require a `label` to attach to. */
const RELATION_FIELDS = [
  "alt-labels",
  "broader",
  "narrower",
  "related-concepts",
] as const;

/** A record's `{field → number}` sub-map, ignoring non-number entries. */
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // In range, or not a score at all (ADR 01034). A model that answers 90
      // where 0..1 was asked for meant "very confident", but reading it as
      // written would clear every threshold there is — the model's slip
      // becoming certainty. GBNF cannot express `minimum`/`maximum`, so no
      // grammar stops this upstream; dropping the score leaves the field
      // unscored, which the confidence gate already knows how to handle.
      if (typeof val === "number" && val >= 0 && val <= 1) out[k] = val;
    }
  }
  return out;
}

/** A record's `{field → string}` sub-map, ignoring non-string entries. */
function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
  }
  return out;
}

/** Confidence stored to 2 decimals so the graph decimal literal is stable. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The page-level key `fill` records the fields it wrote in (proposal 0046). */
const META_PROVENANCE_KEY = "meta-provenance";

/** A graph field as an RFC 6901 JSON Pointer into the page's `graph` block. */
function graphPointer(field: string): string {
  return `/graph/${field.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

export async function runFill(opts: FillOptions = {}): Promise<FillReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      ...(opts.paths === undefined ? {} : { paths: opts.paths }),
      ...(opts.collection === undefined ? {} : { collection: opts.collection }),
    },
    cwd,
  );

  // The flag, then `graph.provider`/`graph.model`, then the family's `providers:`,
  // then `auto`. `--local` is llama-cpp over both levels, so detection never
  // runs under it; a `--provider` it contradicts is refused by name, and a
  // configured one is set aside and said.
  //
  // Checked BEFORE the document set is resolved, and regardless of whether a
  // provider was injected. A contradiction in the flags is a usage error, and
  // a usage error must not be reported as whatever the file walk found first;
  // construction is lazy besides, so a typo would otherwise exit 0 on any run
  // where no page happened to need inference.
  const flags = {
    ...(opts.provider === undefined ? {} : { provider: opts.provider }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
    ...(opts.local === undefined ? {} : { local: opts.local }),
  };
  const selection = selectProvider(config, flags);
  assertProviderSelection(selection);

  const format = assertInputFormat(opts.paths ?? [], opts.as);
  const files = resolveDocumentSet(config, opts, "fill", cwd);
  const usingStdin = (opts.paths ?? []).includes(STDIN);
  if (files.length === 0 && !usingStdin) {
    if (opts.allowEmpty) {
      return {
        results: [],
        turnsUsed: 0,
        maxTurns: opts.maxTurns ?? config.fill.maxTurns,
        warnings: [],
        exitCode: 0,
      };
    }
    throw new GraphError(
      `No input files matched: ${documentSetPatterns(config, opts).join(", ")} (cwd: ${cwd})`,
    );
  }
  if (usingStdin && opts.stdinContent === undefined) {
    throw new GraphError("graph fill was given `-` but no stdin content.");
  }
  const stdinContent = usingStdin ? opts.stdinContent : undefined;
  const analyzeOptions = {
    routes: config.routes,
    ...(format === undefined ? {} : { format }),
  };

  // Identity (for cache keys) is resolvable without constructing the provider;
  // construction — which may demand an API key — is deferred to the first
  // actual LLM call, so complete/cached runs need no credentials.
  //
  // The two branches are kept apart rather than merged behind a cast: an
  // injected provider's `provider()` is a free-form string, and only the
  // resolved path yields a name `constructProvider` can be trusted with.
  let identity: { provider: string; model: string };
  let construct: () => InferenceProvider;
  if (opts.providerInstance) {
    const injected = opts.providerInstance;
    identity = { provider: injected.provider(), model: injected.modelName() };
    construct = () => injected;
    // Still announce what `--local` replaced: the selection is what a real
    // run would have used, and the seam is a test's business, not the user's.
    announceSelection(selection);
  } else {
    const resolved = await resolveProviderIdentity(config, flags);
    identity = resolved;
    // Build from the RESOLVED identity, never the selection we started with:
    // under `auto` that still says "auto", and the synchronous library
    // constructor rightly refuses to guess.
    construct = () => constructProvider(config, resolved);
  }
  let provider: InferenceProvider | undefined;
  const getProvider = (): InferenceProvider => (provider ??= construct());

  const fields = opts.fields ?? config.fill.fields;
  // Compiled against the full configured field set, not any one doc's missing
  // subset: proposals are validated leniently and narrowed afterwards, so a
  // provider that volunteers a field this doc didn't ask for is fine.
  const withSections = opts.sections ?? config.fill.sections;
  // The section half of the schema is built from the FULL configured field
  // set, never from a document's missing set (ADR 01032): section presence is
  // independent of document presence, so a page whose `graph.type` is already
  // set must still be offered a section-level `type`. Narrowing this the way the
  // document half is narrowed handed a strictly-constrained provider a section
  // item with no data properties on it at all.
  const sectionFields = withSections
    ? fields.filter((f) => SECTION_FILL_FIELDS.includes(f))
    : undefined;
  // Validation uses the LENIENT schema (ADR 01034): the values are checked
  // exactly as strictly as ever, while the model's self-reported confidence and
  // reasoning are accepted in whatever shape they arrive. A weak provider that
  // scores one field with a string must not cost the run every other field it
  // got right.
  const validateProposal = validatorFor(
    proposalSchema(fields, { sections: sectionFields, lenient: true }),
  );
  const cache = new FillCache(
    resolve(cwd, config.fill.cacheDir),
    !opts.noCache,
  );
  const confidenceThreshold = opts.confidence ?? config.fill.confidenceThreshold;
  // Turns, not dollars. A turn is one inference call, which every model makes
  // and every model can be counted making — where a price was known for six
  // of them, so the cap it replaces read as zero for all the rest (graph ADR
  // 01027, docevals ADR 01019). `null` is unbounded.
  const maxTurns = opts.maxTurns ?? config.fill.maxTurns;

  const warnings: string[] = [];
  /**
   * Docs whose section fields were written but could not be recorded. A list
   * rather than a flag because `fillOne` sets it and `runFill` reads it: a
   * captured `let` assigned only inside a nested function stays narrowed to
   * its initializer at the read, so the warning below would be unreachable
   * code the compiler is entitled to assume never runs.
   */
  const sectionsUnrecorded: string[] = [];

  const allPaths = new Set(
    stdinContent === undefined ? files : [...files, STDIN_PATH],
  );
  const results: FillDocResult[] = [];
  let turnsUsed = 0;

  // Graph guardrail: simulate each proposal against the SHACL shapes before
  // writing it. Off via fill.validateGraph: false or --no-validate-graph.
  // The guard's base state is the FULL configured corpus, not the positional
  // path subset — a proposal for one doc can cycle with hierarchy that lives
  // in a doc outside the subset being filled. With no collections declared
  // there is no wider corpus to know about, so the subset is the corpus.
  const shapesPaths =
    config.check.shapes.length > 0
      ? config.check.shapes.map((p) => resolve(cwd, p))
      : [bundledShapesPath(import.meta.url)];
  const guardFiles = [
    ...new Set([
      ...(config.collections.length > 0
        ? resolveDocumentSet(config, {}, "fill", cwd)
        : []),
      ...files,
    ]),
  ];
  // Each page as `manni meta validate` reads it (proposal 0047): its own
  // frontmatter plus every key a manifest of its collections owns. What a page
  // already holds, the guard's corpus and the `meta-provenance` list a fill
  // extends are all read through it, so a value kept beside the page counts.
  const view = await openMetaView(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
    guardFiles,
  );
  // Each page's merged text, computed once. `fillOne` reads it from here, so
  // no page is merged twice.
  const mergedTexts = new Map<string, string>();
  // A page whose frontmatter or manifest will not read is that page's error,
  // reported by `fillOne`, not the run's.
  const mergeErrors = new Map<string, unknown>();
  // The stdin page joins the guard's corpus from memory: it has no file. A
  // page whose manifests supply a key joins it as merged, so the simulation
  // sees what `graph build` would.
  const inline = new Map<string, string>();
  for (const path of guardFiles) {
    const text = readFileSync(resolve(cwd, path), "utf8");
    let asMetaReadsIt: string;
    try {
      asMetaReadsIt = await mergedText(view, path, text, formatOf(path, format));
    } catch (e) {
      mergeErrors.set(path, e);
      continue;
    }
    mergedTexts.set(path, asMetaReadsIt);
    if (asMetaReadsIt !== text) inline.set(path, asMetaReadsIt);
  }
  if (stdinContent !== undefined) inline.set(STDIN_PATH, stdinContent);
  const guard =
    !opts.noValidateGraph && config.fill.validateGraph
      ? FillGuard.create(
          guardFiles,
          cwd,
          config,
          shapesPaths,
          opts.force ?? false,
          { inline, ...(format === undefined ? {} : { format }) },
        )
      : undefined;

  for (const path of files) {
    // Read failures are operational (deleted file, permissions) — abort the
    // whole run with exit 2 rather than burning LLM budget on the rest.
    const absPath = resolve(cwd, path);
    let content: string;
    try {
      content = readFileSync(absPath, "utf8");
    } catch (e) {
      throw new GraphError(
        `cannot read ${path}: ${errorMessage(e)}`,
      );
    }
    try {
      results.push(await fillOne(path, absPath, content));
    } catch (e) {
      results.push({
        path,
        status: "error",
        fields: [],
        preserved: [],
        cached: false,
        error: errorMessage(e),
      });
    }
  }

  // The stdin page is filled last, after the named files, and never written:
  // what would have gone to disk comes back as `stdinDocument`.
  let stdinDocument: string | undefined;
  if (stdinContent !== undefined) {
    try {
      const result = await fillOne(STDIN_PATH, undefined, stdinContent);
      results.push(result);
      stdinDocument = result.filledContent ?? stdinContent;
      Reflect.deleteProperty(result, "filledContent");
    } catch (e) {
      results.push({
        path: STDIN_PATH,
        status: "error",
        fields: [],
        preserved: [],
        cached: false,
        error: errorMessage(e),
      });
    }
  }

  if (sectionsUnrecorded.length > 0) {
    warnings.push(
      "Section metadata was written but is NOT recorded in meta-provenance: /graph/sections is " +
        "one of the three hand-curated pointers graph refuses, with /graph/revision-of and " +
        "/graph/derived-from, so recording it would make `manni graph check` report an error. " +
        "Review section values by hand — the review queue will not list them.",
    );
  }

  const hasErrors = results.some((r) => r.status === "error");
  return {
    results,
    turnsUsed,
    maxTurns,
    warnings,
    exitCode: hasErrors ? 1 : 0,
    ...(stdinDocument === undefined ? {} : { stdinDocument }),
  };

  /**
   * Fill one page. `absPath` is where an accepted result is written; a page
   * read from stdin has none, and its result carries the filled text back in
   * `filledContent` instead.
   */
  async function fillOne(
    path: string,
    absPath: string | undefined,
    content: string,
  ): Promise<FillDocResult & { filledContent?: string }> {
    if (frontmatterKind(content) === "unsupported") {
      throw new GraphError(
        "only YAML frontmatter can be edited (found a TOML/JSON fence) — exclude this file or convert its frontmatter",
      );
    }

    // The page as meta reads it. Identical to `content` unless a manifest
    // supplies one of its keys, which is every page in a corpus with none.
    const effective = absPath === undefined ? content : mergedTexts.get(path);
    if (effective === undefined) {
      const failure = mergeErrors.get(path);
      throw failure instanceof Error
        ? failure
        : new GraphError(errorMessage(failure));
    }
    const present = new Set(existingGraphFields(effective));
    const missing = opts.force ? fields : fields.filter((f) => !present.has(f));
    // With --sections, a document whose own fields are complete may still have
    // unfilled sections, so completeness at document level is not completeness
    // (ADR 01032).
    if (missing.length === 0 && !withSections) {
      return {
        path,
        status: "complete",
        fields: [],
        preserved: [],
        cached: false,
      };
    }

    const key = cacheKey(
      identity.provider,
      identity.model,
      content,
      missing,
      withSections,
    );
    // Cached proposals are validated too: a stale or hand-edited cache entry
    // must not bypass the schema (treat invalid entries as a miss).
    let proposal = cache.get(key);
    if (proposal !== undefined && !validateProposal(proposal)) {
      proposal = undefined;
    }
    const cached = proposal !== undefined;

    // Lazy: a *cached* proposal can carry sections, so the slugs still need
    // checking outside the cache-miss branch — but a sections-off run that hits
    // the cache should not pay for a full markdown parse it never reads.
    let docModel: DocModel | undefined;
    const doc = (): DocModel =>
      (docModel ??= analyzeDoc(effective, path, allPaths, analyzeOptions));

    if (proposal === undefined) {
      // The budget is claimed here rather than at the top of the page, so a
      // cached proposal spends nothing: it makes no inference call, and a
      // budget that stopped a free page would report a skip nobody paid for
      // (docevals ADR 01019). Say why, which is the half of graph ADR 01027 that
      // outlives the dollar.
      if (maxTurns !== null && turnsUsed >= maxTurns) {
        return {
          path,
          status: "skipped",
          reason: TURN_BUDGET_REASON,
          fields: [],
          preserved: [],
          cached: false,
        };
      }
      turnsUsed++;
      // completeValidatedJSON validates and retries once before giving up.
      // fill previously aborted the document on a single malformed response;
      // one bad completion is not worth losing the work over.
      //
      // The request schema is narrowed to this doc's missing fields, so the
      // provider cannot propose fields the run should not touch. Validation
      // deliberately uses the WIDER configured-field schema: a provider that
      // volunteers extra fields is tolerated and narrowed below, not failed.
      const run = await completeValidatedJSON<Record<string, unknown>>({
        provider: getProvider(),
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(doc(), content, missing, {
          sections: withSections,
        }),
        schema: proposalSchema(missing, { sections: sectionFields }),
        validate: validateProposal,
        temperature: config.fill.temperature,
      });
      if (run.result === undefined) {
        throw new Error(run.error ?? "provider returned no proposal");
      }
      proposal = run.result;
      cache.set(key, proposal);
    }

    // Per-field confidence + reasoning ride alongside the values (ADR 01015);
    // pull them out before narrowing filters to field keys.
    const confidence = numberMap(proposal["confidence"]);
    const reasoning = stringMap(proposal["reasoning"]);

    // Only requested fields survive, even if the cache or provider offered
    // more; string arrays are deduplicated (the 0.1 schema enforces
    // uniqueItems on what we write).
    const narrowed = Object.fromEntries(
      Object.entries(proposal)
        .filter(([k]) => missing.includes(k as FillField))
        .map(([k, v]) => [k, Array.isArray(v) ? [...new Set(v)] : v]),
    );

    // Section proposals arrive as a list of {slug, …} and become dotted field
    // names — `sections.<slug>.type` — so the writer, the confidence gate, the
    // graph guardrail and the provenance record all treat them as ordinary
    // fields (ADR 01032).
    const unknownSlugs: string[] = [];
    if (withSections) {
      const realSlugs = new Set(doc().sections.map((s) => s.slug));
      for (const entry of Array.isArray(proposal["sections"])
        ? (proposal["sections"] as Array<Record<string, unknown>>)
        : []) {
        const slug = typeof entry["slug"] === "string" ? entry["slug"] : "";
        // A slug matching no heading is dropped, never written. Writing it
        // would mint a graph:brokenSectionRef — a finding fill must report
        // rather than manufacture.
        if (!realSlugs.has(slug)) {
          if (slug) unknownSlugs.push(slug);
          continue;
        }
        const entryConfidence = numberMap(entry["confidence"]);
        const entryReasoning = stringMap(entry["reasoning"]);
        for (const [field, value] of Object.entries(entry)) {
          if (!SECTION_FILL_FIELDS.includes(field as FillField)) continue;
          if (!fields.includes(field as FillField)) continue;
          const name = `sections.${slug}.${field}`;
          narrowed[name] = Array.isArray(value) ? [...new Set(value)] : value;
          // Fold the per-section scores into the flat maps the gate reads, so
          // one code path scores document and section fields alike.
          if (entryConfidence[field] !== undefined)
            confidence[name] = entryConfidence[field];
          if (entryReasoning[field] !== undefined)
            reasoning[name] = entryReasoning[field];
        }
      }
    }

    // manni:graph requires `label` alongside any alt-label/relation field
    // (dependentRequired) — never write output our own validate rejects.
    // Rechecked after the guardrail: rejecting `label` takes the relation
    // fields down with it.
    const gateLabel = (): void => {
      const hasLabel =
        present.has("label") ||
        (typeof narrowed["label"] === "string" && narrowed["label"].length > 0);
      if (!hasLabel) {
        for (const field of RELATION_FIELDS) Reflect.deleteProperty(narrowed, field);
      }
    };
    gateLabel();

    // Confidence gate (ADR 01015): drop any field the model scored below the
    // threshold (or did not score at all — no score means no write). This
    // runs before the structural guardrail; the two are orthogonal, and the
    // confidence gate covers every field, not just the guarded subset. A drop
    // here is normal operation, reported but never an error (exit stays 0).
    const lowConfidence: FillDocResult["lowConfidence"] = [];
    for (const field of Object.keys(narrowed)) {
      // Unscored counts as 0, so `confidenceThreshold: 0` stays a working
      // opt-out from the gate. The related hazard — stamping a confidence the
      // model never gave into meta-provenance — is fixed where that record is
      // built, not here.
      const c = confidence[field] ?? 0;
      if (c < confidenceThreshold) {
        lowConfidence.push({
          field,
          confidence: c,
          ...(reasoning[field] ? { reasoning: reasoning[field] } : {}),
        });
        Reflect.deleteProperty(narrowed, field);
      }
    }
    if (lowConfidence.length > 0) gateLabel();
    const lowConf = lowConfidence.length > 0 ? { lowConfidence } : {};

    // Graph guardrail: drop any field whose triples would violate the
    // shapes contract (cycles, related⨯broader conflicts, second spellings
    // of an existing concept). Cached proposals are vetted too — rejection
    // sits downstream of the cache, so a later corpus change can re-admit
    // a proposal without re-asking the LLM.
    let rejected: string[] | undefined;
    if (guard) {
      const vetted = await guard.vet(path, effective, narrowed);
      if (vetted.rejected.length > 0) {
        rejected = vetted.rejected.map((r) => r.field);
        for (const field of rejected) Reflect.deleteProperty(narrowed, field);
        gateLabel();
      }
    }

    // Which fields will actually be written (mirrors applyGraphFields' filter);
    // empty means nothing to do — and no provenance entry either.
    const realFields = Object.keys(narrowed).filter((k) => {
      const v = narrowed[k];
      return (
        v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
      );
    });
    if (realFields.length === 0) {
      return {
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: [],
        ...(rejected ? { rejected } : {}),
        ...(unknownSlugs.length > 0 ? { unknownSections: unknownSlugs } : {}),
        ...lowConf,
        cached,
      };
    }

    // Record machine attribution alongside the fields, in the SAME write.
    // It goes in the page-level `meta-provenance` now (proposal 0046), through
    // meta's own merge: one entry per model, this model's entry gaining the
    // pointers this run wrote, and every other entry — including the ones
    // `manni docevals fill` wrote — carried through untouched.
    let provenanceList: unknown[] | undefined;
    if (config.fill.writeProvenance) {
      // Document-level names only. `sections.<slug>.<field>` is a pointer
      // under `/graph/sections`, and `sections` is one of the three fields
      // curated by hand — recording it is exactly what graph's harvest now
      // reports as a `manni graph check` error (0046 stress test 13). So the
      // rule stays, and the reason it stays is a different one.
      const recordable = realFields.filter((f) => !f.includes(".")).sort();
      // Loud, not silent: metadata a model wrote with no entry in the review
      // queue is exactly the thing this record exists to prevent.
      if (recordable.length < realFields.length) sectionsUnrecorded.push(path);
      // Only record a score the model actually gave. `?? 0` stamped a
      // confidence of 0.00 the model never asserted whenever it omitted one,
      // which `fill.confidenceThreshold: 0` makes reachable.
      const held = existingMetaProvenance(effective);
      const priorEntry = Array.isArray(held)
        ? (held as unknown[]).find(
            (e): e is Record<string, unknown> =>
              !!e &&
              typeof e === "object" &&
              !Array.isArray(e) &&
              (e as Record<string, unknown>)["generated-by"] ===
                identity.model,
          )
        : undefined;
      const priorConfidence = numberMap(priorEntry?.["confidence"]);
      const proposed = recordable.map((f) => {
        const name = graphPointer(f);
        const c = confidence[f];
        return {
          name,
          confidence: c === undefined ? (priorConfidence[name] ?? 0) : round2(c),
        };
      });
      const unscored = recordable
        .map((f) => [f, graphPointer(f)] as const)
        .filter(
          ([f, name]) =>
            confidence[f] === undefined && priorConfidence[name] === undefined,
        )
        .map(([, name]) => name);
      const merged = mergeMetaProvenance(
        held,
        identity.model,
        "fields",
        proposed,
      );
      // `undefined` is a page holding something other than a list under the
      // key. Reported by `manni meta validate`, not worth failing the fill over:
      // a side record that could block filling would be worse than none.
      if (merged) {
        // The merge sets a confidence for every name it is handed; a pointer
        // nobody has ever scored keeps none.
        for (const name of unscored)
          Reflect.deleteProperty(merged.entry.confidence, name);
        provenanceList = merged.list;
      }
    }

    // Applied to the page as meta reads it, so a value a manifest holds is
    // preserved exactly as one on the page would be.
    const applied = applyGraphFields(effective, path, narrowed, {
      force: opts.force,
    });
    const reportedFields = applied.applied;

    if (reportedFields.length === 0) {
      return {
        path,
        status: "nothing-proposed",
        fields: [],
        preserved: applied.skipped,
        ...(rejected ? { rejected } : {}),
        ...(unknownSlugs.length > 0 ? { unknownSections: unknownSlugs } : {}),
        ...lowConf,
        cached,
      };
    }

    // Where each key is written is meta's rule (proposal 0047), the one
    // `manni meta fill` follows: a key a local manifest owns goes to the page's
    // entry there, and every other key stays on the page. A page from stdin
    // has no manifest, so everything it gets is in the text printed back.
    const own = ownMetadata(content).data;
    const graphHome =
      absPath === undefined ? undefined : await view.home(path, own, GRAPH_KEY);
    const provenanceHome =
      absPath === undefined || provenanceList === undefined
        ? undefined
        : await view.home(path, own, META_PROVENANCE_KEY);
    const graphTarget = writeTarget(path, graphHome, GRAPH_KEY);
    if (typeof graphTarget === "string") throw new GraphError(graphTarget);
    let provenanceTarget = writeTarget(path, provenanceHome, META_PROVENANCE_KEY);
    if (typeof provenanceTarget === "string") {
      // A side record that could block filling would be worse than none, so
      // the fields are written and the record is not, and the run says so.
      warnings.push(`${provenanceTarget} The fill of ${path} is not recorded.`);
      provenanceList = undefined;
      provenanceTarget = null;
    }

    const pageKeys: Record<string, unknown> = {};
    if (provenanceList !== undefined && provenanceTarget === null) {
      pageKeys[META_PROVENANCE_KEY] = provenanceList;
    }
    const pageContent = applyGraphFields(
      content,
      path,
      graphTarget === null ? narrowed : {},
      { force: opts.force, page: pageKeys },
    ).content;

    const manifestWrites: ManifestWrite[] = [];
    // A manifest that owns `graph:` gets the whole block as meta reads it,
    // merged and then filled. A `graph:` block the page still carries is left
    // as it is: `build` merges the two with the manifest winning, as
    // `manni meta fill` does.
    if (graphTarget !== null) {
      manifestWrites.push({
        home: graphTarget,
        key: GRAPH_KEY,
        value: ownMetadata(applied.content).data[GRAPH_KEY],
      });
    }
    if (provenanceList !== undefined && provenanceTarget !== null) {
      manifestWrites.push({
        home: provenanceTarget,
        key: META_PROVENANCE_KEY,
        value: provenanceList,
      });
    }
    // Every splice is made before anything is written, so a manifest meta
    // refuses leaves the page untouched too.
    const manifests = await spliceAll(manifestWrites);

    if (!opts.dryRun && absPath !== undefined) {
      if (pageContent !== content) writeFileSync(absPath, pageContent, "utf8");
      for (const m of manifests) {
        if (m.text !== m.before) {
          await writeFileAtomic(m.absPath, m.text, { createParents: true });
        }
      }
    }
    // Fold the accepted result into the guard even on --dry-run, so the dry
    // run predicts exactly what a real run would accept and reject.
    guard?.commit(path, applied.content);
    return {
      path,
      status: opts.dryRun ? "proposed" : "filled",
      fields: reportedFields,
      preserved: applied.skipped,
      ...(rejected ? { rejected } : {}),
      ...(unknownSlugs.length > 0 ? { unknownSections: unknownSlugs } : {}),
      ...lowConf,
      cached,
      ...(absPath === undefined && !opts.dryRun
        ? { filledContent: pageContent }
        : {}),
    };
  }
}

/** The page key holding the graph block. */
const GRAPH_KEY = "graph";

/** A manifest a key is written to, with the page's entry there. */
interface ManifestTarget {
  file: string;
  absPath: string;
  join: string;
  entry: string;
  perPage: boolean;
}

/** One value written into one manifest entry. */
interface ManifestWrite {
  home: ManifestTarget;
  key: string;
  value: unknown;
}

/**
 * Where `key` goes: `null` for the page, the manifest entry, or meta's
 * sentence for a manifest that cannot take it, which is a fetched one or one
 * that joins on a field the page lacks.
 */
function writeTarget(
  path: string,
  home: KeyHome | undefined,
  key: string,
): ManifestTarget | string | null {
  if (home === undefined || home.kind === "unowned") return null;
  if (home.kind === "url") return urlManifestMessage(key, home.file);
  if (home.entry === undefined) {
    return `${path} carries no ${home.join}, which ${home.file} joins on, so its ${key} has no entry there.`;
  }
  return {
    file: home.file,
    absPath: home.absPath,
    join: home.join,
    entry: home.entry,
    perPage: home.perPage,
  };
}

/**
 * Each manifest's text with its writes spliced in, through meta's splice, which
 * changes no other byte of the file. A `{page}` manifest that is not on disk
 * yet is held as empty and created by the write, as `manni meta fill` does.
 */
async function spliceAll(
  writes: readonly ManifestWrite[],
): Promise<Array<{ absPath: string; before: string; text: string }>> {
  const out = new Map<string, { absPath: string; before: string; text: string }>();
  for (const w of writes) {
    let held = out.get(w.home.absPath);
    if (held === undefined) {
      let before: string;
      try {
        before = await readFile(w.home.absPath, "utf8");
      } catch (e) {
        if (!(w.home.perPage && isMissing(e))) {
          throw new GraphError(`${w.home.file} could not be read: ${errorMessage(e)}`);
        }
        before = "";
      }
      held = { absPath: w.home.absPath, before, text: before };
      out.set(w.home.absPath, held);
    }
    try {
      held.text = spliceManifestValue(held.text, {
        entry: w.home.entry,
        key: w.key,
        value: w.value,
        join: w.home.join,
        file: w.home.file,
      }).text;
    } catch (e) {
      throw new GraphError(errorMessage(e));
    }
  }
  return [...out.values()];
}

/**
 * `content` with every key its manifests supply written into its frontmatter,
 * so it reads as meta reads the page. `content` itself when none does. A
 * frontmatter graph cannot edit is left alone, and `fill` refuses that page.
 */
async function mergedText(
  view: MetaPageView,
  path: string,
  content: string,
  format: DocFormat,
): Promise<string> {
  if (frontmatterKind(content) === "unsupported") return content;
  const own = ownMetadata(content);
  const { supplied } = await mergePage(view, path, own.data, own.present, format);
  if (Object.keys(supplied).length === 0) return content;
  return applyGraphFields(content, path, {}, { page: supplied }).content;
}

export function renderFill(
  report: FillReport,
  format: "pretty" | "json",
): string {
  if (format === "json") {
    // The stdin document is output of its own, never part of the report.
    return JSON.stringify({ ...report, stdinDocument: undefined }, null, 2);
  }
  const lines: string[] = [];
  for (const r of report.results) {
    const dropped =
      r.rejected && r.rejected.length > 0
        ? ` [graph check rejected: ${r.rejected.join(", ")}]`
        : "";
    const lowConf =
      r.lowConfidence && r.lowConfidence.length > 0
        ? ` [low confidence, not written: ${r.lowConfidence
            .map((l) => `${l.field} ${l.confidence.toFixed(2)}`)
            .join(", ")}]`
        : "";
    // Visible rather than silent: the model addressed a heading that is not
    // there, which usually means the page was edited after it was described.
    const unknown =
      r.unknownSections && r.unknownSections.length > 0
        ? ` [no such section: ${r.unknownSections.join(", ")}]`
        : "";
    switch (r.status) {
      case "filled":
        lines.push(
          `filled    ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""}${dropped}${unknown}${lowConf}`,
        );
        break;
      case "proposed":
        lines.push(
          `proposed  ${r.path} (${r.fields.join(", ")})${r.cached ? " [cached]" : ""}${dropped}${unknown}${lowConf} — dry run, not written`,
        );
        break;
      case "complete":
        lines.push(`complete  ${r.path}`);
        break;
      case "nothing-proposed":
        lines.push(
          `no-op     ${r.path} (model proposed nothing new)${dropped}${unknown}${lowConf}`,
        );
        break;
      case "skipped":
        lines.push(`skipped   ${r.path} (${r.reason ?? "not processed"})`);
        break;
      case "error":
        lines.push(`error     ${r.path}: ${r.error ?? ""}`);
        break;
    }
  }
  // A run cut short covered less than it was asked to, and the per-page lines
  // say which pages. Say once that the budget is why, so the number to raise
  // is on screen next to them.
  if (
    report.maxTurns !== null &&
    report.results.some((r) => r.status === "skipped")
  ) {
    lines.push(
      "",
      `--max-turns reached (${report.maxTurns}); some pages were not processed.`,
    );
  }
  return lines.join("\n");
}
