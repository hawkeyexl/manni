/**
 * `manni kg fill` — propose SKOS frontmatter fields (the `graph:` block) with an
 * LLM and write them back. Single-shot structured output per doc, content-hash
 * cached, bounded by a turn budget. Human-set fields are never overwritten
 * without `--force`; `--dry-run` reports without writing. Any per-doc failure
 * is recorded as a result, never aborts the run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeDoc } from "../core/analyze.js";
import { loadRunConfig, type FillField } from "../core/config.js";
import type { DocModel } from "../types.js";
import {
  documentSetPatterns,
  resolveDocumentSet,
  type DocumentInputOptions,
} from "../core/discover.js";
import {
  applyKgFields,
  existingKgFields,
  existingMetaProvenance,
  frontmatterKind,
} from "../core/frontmatter-edit.js";
import { mergeMetaProvenance } from "../../meta/internal.js";
import { FillGuard } from "../core/fill-guard.js";
import { bundledShapesPath } from "../core/pkg.js";
import { errorMessage } from "../../shared/errors.js";
import { KgError } from "../types.js";
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
   * the half of kg ADR 01027 that survives the dollar cap's removal.
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
   * kg:brokenSectionRef, a finding fill must report and never manufacture
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
   * a price was known for six of them — which is why the dollar cap went (kg
   * ADR 01027, proposal 0051 §3).
   */
  turnsUsed: number;
  /** The budget in force, or `null` for unbounded. */
  maxTurns: number | null;
  /** Non-fatal diagnostics. Never affects the exit code. */
  warnings: string[];
  exitCode: 0 | 1;
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

  // The flag, then `kg.provider`/`kg.model`, then the family's `providers:`,
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

  const files = resolveDocumentSet(config, opts, "fill", cwd);
  if (files.length === 0) {
    throw new KgError(
      `No input files matched: ${documentSetPatterns(config, opts).join(", ")} (cwd: ${cwd})`,
    );
  }

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
  // of them, so the cap it replaces read as zero for all the rest (kg ADR
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

  const allPaths = new Set(files);
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
  const guard =
    !opts.noValidateGraph && config.fill.validateGraph
      ? FillGuard.create(
          guardFiles,
          cwd,
          config,
          shapesPaths,
          opts.force ?? false,
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
      throw new KgError(
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

  if (sectionsUnrecorded.length > 0) {
    warnings.push(
      "Section metadata was written but is NOT recorded in meta-provenance: /graph/sections is " +
        "one of the three hand-curated pointers kg refuses, with /graph/revision-of and " +
        "/graph/derived-from, so recording it would make `manni kg check` report an error. " +
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
  };

  async function fillOne(
    path: string,
    absPath: string,
    content: string,
  ): Promise<FillDocResult> {
    if (frontmatterKind(content) === "unsupported") {
      throw new KgError(
        "only YAML frontmatter can be edited (found a TOML/JSON fence) — exclude this file or convert its frontmatter",
      );
    }

    const present = new Set(existingKgFields(content));
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
      (docModel ??= analyzeDoc(content, path, allPaths, {
        routes: config.routes,
      }));

    if (proposal === undefined) {
      // The budget is claimed here rather than at the top of the page, so a
      // cached proposal spends nothing: it makes no inference call, and a
      // budget that stopped a free page would report a skip nobody paid for
      // (docevals ADR 01019). Say why, which is the half of kg ADR 01027 that
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
        // would mint a kg:brokenSectionRef — a finding fill must report
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
      const vetted = await guard.vet(path, content, narrowed);
      if (vetted.rejected.length > 0) {
        rejected = vetted.rejected.map((r) => r.field);
        for (const field of rejected) Reflect.deleteProperty(narrowed, field);
        gateLabel();
      }
    }

    // Which fields will actually be written (mirrors applyKgFields' filter);
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
    let page: Record<string, unknown> | undefined;
    if (config.fill.writeProvenance) {
      // Document-level names only. `sections.<slug>.<field>` is a pointer
      // under `/graph/sections`, and `sections` is one of the three fields
      // curated by hand — recording it is exactly what kg's harvest now
      // reports as a `manni kg check` error (0046 stress test 13). So the
      // rule stays, and the reason it stays is a different one.
      const recordable = realFields.filter((f) => !f.includes(".")).sort();
      // Loud, not silent: metadata a model wrote with no entry in the review
      // queue is exactly the thing this record exists to prevent.
      if (recordable.length < realFields.length) sectionsUnrecorded.push(path);
      // Only record a score the model actually gave. `?? 0` stamped a
      // confidence of 0.00 the model never asserted whenever it omitted one,
      // which `fill.confidenceThreshold: 0` makes reachable.
      const held = existingMetaProvenance(content);
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
        page = { [META_PROVENANCE_KEY]: merged.list };
      }
    }

    const applied = applyKgFields(content, path, narrowed, {
      force: opts.force,
      ...(page ? { page } : {}),
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

    if (!opts.dryRun) writeFileSync(absPath, applied.content, "utf8");
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
    };
  }
}

export function renderFill(
  report: FillReport,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(report, null, 2);
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
