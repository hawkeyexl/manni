/**
 * `manni term fill` (proposal 0085 § 3): a term page for each concept pages
 * name and the termbase lacks, and a definition for each entry that has none.
 * A value a person wrote is never overwritten, and an existing file is never
 * replaced.
 *
 * A definition comes from a `graph:` block when one carries it, else from a
 * model when a provider resolves, gated by confidence and recorded in the
 * page's `meta-provenance`. With no model the page is a stub. `--crawl` also
 * sends page bodies to the model, which proposes terms no metadata named.
 *
 * Providers, the cache and the turn budget are the family's, as `meta fill`
 * and `graph fill` run them.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import {
  JsonCache,
  buildCacheKey,
  completeValidatedJSON,
  makeProvider as makeInferenceProvider,
  sha256,
  validatorFor,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { extractorByName, extractorForExtension, mergeMetaProvenance } from "../../meta/internal.js";
import { DEFAULT_CHUNK_CHARS, splitBody } from "../../meta/commands/fill-prompt.js";
import { errorMessage } from "../../shared/errors.js";
import {
  assertKnownProvider,
  assertLocalFlag,
  assertModelHasProvider,
  localNotice,
  providerSpecFor,
  resolveIdentity,
  selectProvider,
  type ProviderFlags,
} from "../../shared/providers.js";
import { warn } from "../../shared/warn.js";
import { DEFAULT_CRAWL_MIN_PAGES, DEFAULT_FILL_CACHE_DIR, DEFAULT_FILL_CONFIDENCE, resolveTermRun } from "../core/config.js";
import {
  FILL_PAGE_FORMATS,
  fold,
  mergeFound,
  newCandidates,
  pageExtension,
  planFromMetadata,
  sharedTermDirectory,
  termIndex,
  type FoundTerm,
  type NamedAt,
} from "../core/fill-plan.js";
import { slugOf } from "../core/id.js";
import { TERM_WRITERS } from "../core/writers/index.js";
import { TermError } from "../errors.js";
import type { Term, TermInput, TermRecord } from "../types.js";
import { displayPath, loadSet, type TermCommandOptions } from "./run.js";

export const FILL_FORMATS = ["pretty", "json"] as const;
export type FillFormat = (typeof FILL_FORMATS)[number];

export interface FillOptions extends TermCommandOptions {
  /** `-o, --out <dir>`. */
  out?: string;
  crawl?: boolean;
  offline?: boolean;
  provider?: string;
  model?: string;
  local?: boolean;
  confidence?: number;
  maxTurns?: number;
  chunkChars?: number;
  noCache?: boolean;
  dryRun?: boolean;
  /** A provider to use instead of the resolved one. Tests hand in a mock. */
  providerInstance?: InferenceProvider;
}

export type FillAction = "create" | "fill" | "skip" | "exists";
export type DefinitionStatus = "drafted" | "carried" | "missing" | "below-threshold";

export interface FillEntry {
  action: FillAction;
  /** As a person in cwd would name it. */
  file: string;
  id: string;
  label: string;
  language?: string;
  source: "metadata" | "crawl";
  /** `file:line` of each place that named it, or `file` when the line is unknown. */
  from: string[];
  definition: { status: DefinitionStatus; confidence?: number; model?: string };
  /** Why a `skip` was skipped. */
  reason?: string;
}

export interface FillReport {
  entries: FillEntry[];
  summary: { created: number; filled: number; skipped: number; withoutDefinition: number; turns: number };
  dryRun: boolean;
  threshold: number;
}

/** Why an entry was left for a later run. */
export const TURN_BUDGET_REASON = "turn budget";

/** Bumped when a prompt or schema changes, so the cache answers only what was asked. */
const PROMPT_VERSION = 1;

const META_PROVENANCE_KEY = "meta-provenance";

const DEFINITION_SYSTEM = [
  "You write glossary definitions for a documentation set's termbase.",
  "Define the term in one sentence, as the pages quoted use it.",
  "Give your confidence, from 0 to 1, that the definition is right for these pages.",
  "When the context is too thin to be sure, say so with a low confidence rather than guessing.",
].join(" ");

const DEFINITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["definition", "confidence"],
  properties: { definition: { type: "string" }, confidence: { type: "number" } },
};

const CRAWL_SYSTEM = [
  "You find the domain terms a documentation page uses: product concepts, technical terms and jargon a glossary should define.",
  "Leave out everyday words, people, and code identifiers.",
  "For each term give its label in singular form, any synonyms the page uses, a one-sentence definition from the page's context,",
  "and your confidence, from 0 to 1, that it belongs in a glossary and that the definition is right.",
].join(" ");

const CRAWL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["terms"],
  properties: {
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "alt-labels", "definition", "confidence"],
        properties: {
          label: { type: "string" },
          "alt-labels": { type: "array", items: { type: "string" } },
          definition: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

const validateDefinition = validatorFor(DEFINITION_SCHEMA);
const validateCrawl = validatorFor(CRAWL_SCHEMA);

/** A score from 0 to 1, or 0: a model that answers 90 meant something, but not a probability. */
function score(value: unknown): number {
  return typeof value === "number" && value >= 0 && value <= 1 ? Math.round(value * 100) / 100 : 0;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(nonEmpty).filter((v): v is string => v !== undefined) : [];
}

/** One value or a list, as `keywords:` is spelled. */
function keywordsOf(value: unknown): string[] {
  return typeof value === "string" ? strings([value]) : strings(value);
}

/** The 1-based line `label` first appears on in `content`, ignoring case. */
function lineOf(content: string, label: string): number | undefined {
  const at = content.toLowerCase().indexOf(label.toLowerCase());
  return at === -1 ? undefined : content.slice(0, at).split("\n").length;
}

function fromList(from: readonly NamedAt[], cwd: string): string[] {
  return from.map((at) => {
    const file = displayPath(at.file, cwd);
    return at.line === undefined ? file : `${file}:${String(at.line)}`;
  });
}

/** The model a drafted entry names, and `meta-provenance` records. */
interface Model {
  provider: InferenceProvider;
  identity: { provider: string; model: string };
}

const toTermError = (message: string): Error => new TermError(message);

/** The provider in force, or `undefined` when none resolves. A name that cannot be right is refused. */
async function resolveModel(opts: FillOptions, run: Awaited<ReturnType<typeof resolveTermRun>>): Promise<Model | undefined> {
  if (opts.providerInstance !== undefined) {
    const provider = opts.providerInstance;
    return { provider, identity: { provider: provider.provider(), model: provider.modelName() } };
  }
  const flags: ProviderFlags = {
    ...(opts.provider === undefined ? {} : { provider: opts.provider }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
    ...(opts.local === true ? { local: true } : {}),
  };
  assertLocalFlag(flags, toTermError);
  const family = run.configFile?.providers ?? {};
  const selection = selectProvider(flags, [
    {
      ...(run.config?.provider === undefined ? {} : { provider: run.config.provider }),
      ...(run.config?.model === undefined ? {} : { model: run.config.model }),
      origin: "term.provider",
    },
    {
      ...(family.provider === undefined ? {} : { provider: family.provider }),
      ...(family.model === undefined ? {} : { model: family.model }),
      origin: "providers.provider",
    },
  ]);
  const { provider: name, model: chosen } = selection;
  assertKnownProvider(name, toTermError);
  assertModelHasProvider(name, chosen, "term.provider", toTermError);
  const notice = localNotice(selection);
  if (notice !== undefined) opts.onNotice?.(notice);
  try {
    const identity = await resolveIdentity(
      providerSpecFor(family, { provider: name, model: chosen ?? null }),
      toTermError,
    );
    return { provider: makeInferenceProvider(providerSpecFor(family, identity)), identity };
  } catch {
    return undefined;
  }
}

/** One page's metadata and content, as the loader read it. */
interface Page {
  file: string;
  path?: string;
  content: string;
  metadata: Record<string, unknown>;
  language?: string;
  keywordsLine?: number;
}

export async function runFill(opts: FillOptions): Promise<FillReport> {
  if (opts.crawl === true && opts.offline === true) {
    throw new TermError("--crawl asks a model to find terms, so it cannot run with --offline.");
  }
  const cwd = resolve(opts.cwd ?? process.cwd());
  const run = await resolveTermRun({
    cwd,
    inputs: opts.inputs,
    ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
    ...(opts.collection === undefined ? {} : { collection: opts.collection }),
  });
  const pages: Page[] = [];
  const onPage = (input: TermInput): void => {
    const language = input.metadata["language"];
    const keywordsLine = input.lineFor("/keywords");
    pages.push({
      file: input.file,
      ...(input.path === undefined ? {} : { path: input.path }),
      content: input.content,
      metadata: input.metadata,
      ...(typeof language === "string" && language !== "" ? { language } : {}),
      ...(keywordsLine === undefined ? {} : { keywordsLine }),
    });
  };
  // A termbase starts empty: that is what fill is for.
  const set = await loadSet(run, { ...opts, cwd, allowEmpty: true, onPage });

  const fillConfig = run.config?.fill ?? {};
  const configDir = run.configDir ?? cwd;
  const threshold = opts.confidence ?? fillConfig.confidenceThreshold ?? DEFAULT_FILL_CONFIDENCE;
  const maxTurns = opts.maxTurns ?? fillConfig.maxTurns ?? null;
  const minPages = fillConfig.crawl?.minPages ?? DEFAULT_CRAWL_MIN_PAGES;
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const crawl = opts.crawl === true;
  const dryRun = opts.dryRun === true;

  const plan = planFromMetadata(set);
  const needsDir = crawl || plan.create.length > 0;
  const outDir = !needsDir
    ? undefined
    : opts.out !== undefined
      ? resolve(cwd, opts.out)
      : fillConfig.out !== undefined
        ? resolve(configDir, fillConfig.out)
        : sharedTermDirectory(set.terms);
  if (needsDir && outDir === undefined) {
    throw new TermError("new term pages need a directory; pass -o or set term.fill.out.");
  }
  const ext = outDir === undefined ? ".md" : pageExtension(set.terms, outDir, pages.map((p) => p.file));
  const format = FILL_PAGE_FORMATS[ext] ?? "markdown";

  // The model, resolved only when there is something to ask it.
  const wantsModel =
    crawl || plan.create.some((c) => c.definition === undefined) || plan.missing.some((m) => m.carried === undefined);
  let model: Model | undefined;
  if (wantsModel && opts.offline !== true) {
    model = await resolveModel(opts, run);
    if (model === undefined) {
      if (crawl) {
        throw new TermError("--crawl needs a model, and no provider is configured; pass --provider or set providers:.");
      }
      warn("no model provider is configured, so new terms have no definition; pass --provider or --offline.");
    }
  }
  const modelName = model === undefined ? undefined : `${model.identity.provider}/${model.identity.model}`;
  const cache = new JsonCache<Record<string, unknown>>(
    resolve(configDir, fillConfig.cacheDir ?? DEFAULT_FILL_CACHE_DIR),
    opts.noCache !== true,
    "manni",
  );
  let turns = 0;
  /** A validated answer, from the cache or one inference call. `undefined` when the budget is spent. */
  const ask = async (
    m: Model,
    kind: string,
    system: string,
    user: string,
    schema: Record<string, unknown>,
    validate: ReturnType<typeof validatorFor>,
  ): Promise<Record<string, unknown> | undefined> => {
    const key = buildCacheKey([m.identity.provider, m.identity.model, `v${String(PROMPT_VERSION)}`, kind, sha256(user)]);
    const cached = cache.get(key);
    if (cached !== undefined && validate(cached)) return cached;
    if (maxTurns !== null && turns >= maxTurns) return undefined;
    turns++;
    const answer = await completeValidatedJSON<Record<string, unknown>>({ provider: m.provider, system, user, schema, validate });
    if (answer.result === undefined) throw new TermError(answer.error ?? "the model returned no answer.");
    cache.set(key, answer.result);
    return answer.result;
  };

  const pageByFile = new Map(pages.map((p) => [p.file, p]));
  /** The prompt for one term: its label and relations, and the lines of the pages that use it. */
  const definitionPrompt = (label: string, language: string | undefined, record: Partial<TermRecord>, from: readonly NamedAt[]): string => {
    const lines = [`Term: ${label}`];
    if (language !== undefined) lines.push(`Language: ${language}`);
    const lists: [string, string[] | undefined][] = [
      ["Also called", record["alt-labels"]],
      ["Broader", record.broader],
      ["Narrower", record.narrower],
      ["Related", record["related-terms"]],
    ];
    for (const [name, values] of lists) if (values !== undefined && values.length > 0) lines.push(`${name}: ${values.join(", ")}`);
    const files = [...new Set(from.map((f) => f.file))].slice(0, 3);
    for (const file of files) {
      const page = pageByFile.get(file);
      if (page === undefined) continue;
      lines.push("", `Page ${file}`);
      for (const key of ["title", "description"]) {
        const value = nonEmpty(page.metadata[key]);
        if (value !== undefined) lines.push(`${key}: ${value}`);
      }
      const uses = page.content
        .split("\n")
        .filter((line) => line.toLowerCase().includes(label.toLowerCase()))
        .slice(0, 3);
      for (const use of uses) lines.push(`> ${use.trim()}`);
    }
    return lines.join("\n");
  };
  type Draft = { status: "drafted" | "below-threshold"; definition: string; confidence: number } | { skip: string };
  const draft = async (label: string, language: string | undefined, record: Partial<TermRecord>, from: readonly NamedAt[]): Promise<Draft | undefined> => {
    if (model === undefined) return undefined;
    let answer;
    try {
      answer = await ask(model, "definition", DEFINITION_SYSTEM, definitionPrompt(label, language, record, from), DEFINITION_SCHEMA, validateDefinition);
    } catch (error) {
      return { skip: `model error: ${errorMessage(error)}` };
    }
    if (answer === undefined) return { skip: TURN_BUDGET_REASON };
    const definition = nonEmpty(answer["definition"]);
    const confidence = score(answer["confidence"]);
    if (definition === undefined) return { skip: "the model gave no definition" };
    return { status: confidence >= threshold ? "drafted" : "below-threshold", definition, confidence };
  };

  const entries: FillEntry[] = [];
  const writes: { path: string; content: string }[] = [];
  const planned = new Set<string>();
  const known = new Set(termIndex(set.terms).keys());

  /** A new page's content: the record through term's own page render, `meta-provenance` added when a model wrote fields. */
  const render = (term: Term, provenance?: { fields: string[]; confidence: number }): string => {
    const writer = TERM_WRITERS.find((w) => w.format === format);
    const target = { path: outDir ?? cwd, shape: "directory" as const };
    const content = writer?.render([term], target, { existing: new Map() }).files[0]?.content;
    if (content === undefined) throw new TermError(`manni cannot write a ${format} term page.`);
    if (provenance === undefined || model === undefined) return content;
    const merged = mergeMetaProvenance(
      undefined,
      model.identity.model,
      "fields",
      provenance.fields.map((name) => ({ name, confidence: provenance.confidence })),
    );
    const extractor = extractorForExtension(ext);
    if (merged === undefined || extractor?.apply === undefined) return content;
    return extractor.apply(content, { [META_PROVENANCE_KEY]: merged.list }, { filePath: join(target.path, `x${ext}`) });
  };

  /** Plan one new page; `undefined` and an `exists` entry when its file is taken. */
  const create = async (
    concept: { label: string; language?: string; from: NamedAt[]; altLabels: string[]; broader?: string[]; narrower?: string[]; related?: string[] },
    source: "metadata" | "crawl",
    definition: { carried?: string; drafted?: { definition: string; confidence: number }; fields?: string[] },
  ): Promise<void> => {
    const id = slugOf(concept.label);
    const path = join(outDir ?? cwd, `${id}${ext}`);
    const base = {
      file: displayPath(path, cwd),
      id,
      label: concept.label,
      ...(concept.language === undefined ? {} : { language: concept.language }),
      source,
      from: fromList(concept.from, cwd),
    };
    if (planned.has(path) || existsSync(path)) {
      entries.push({ action: "exists", ...base, definition: { status: "missing" } });
      return;
    }
    const record: TermRecord = { label: concept.label };
    const lists: [keyof TermRecord & ("alt-labels" | "broader" | "narrower" | "related-terms"), string[] | undefined][] = [
      ["alt-labels", concept.altLabels],
      ["broader", concept.broader],
      ["narrower", concept.narrower],
      ["related-terms", concept.related],
    ];
    for (const [field, values] of lists) if (values !== undefined && values.length > 0) record[field] = values;

    let status: DefinitionStatus = "missing";
    let confidence: number | undefined;
    let fields: string[] | undefined;
    if (definition.carried !== undefined) {
      record.definition = definition.carried;
      status = "carried";
    } else {
      const got = definition.drafted ?? (await draft(concept.label, concept.language, record, concept.from));
      if (got !== undefined && "skip" in got) {
        entries.push({ action: "skip", ...base, definition: { status: "missing" }, reason: got.skip });
        return;
      }
      if (got !== undefined) {
        confidence = got.confidence;
        const below = "status" in got && got.status === "below-threshold";
        if (below || got.confidence < threshold) {
          status = "below-threshold";
        } else {
          record.definition = got.definition;
          status = "drafted";
          fields = definition.fields ?? ["/definition"];
        }
      }
    }
    const term: Term = {
      id,
      record,
      ...(concept.language === undefined ? {} : { language: concept.language }),
      location: { file: base.file, path, construct: "page", line: 1, fieldLines: {} },
    };
    planned.add(path);
    known.add(fold(concept.label));
    for (const alt of concept.altLabels) known.add(fold(alt));
    writes.push({ path, content: render(term, fields === undefined || confidence === undefined ? undefined : { fields, confidence }) });
    entries.push({
      action: "create",
      ...base,
      definition: {
        status,
        ...(confidence === undefined ? {} : { confidence }),
        ...(modelName === undefined || confidence === undefined ? {} : { model: modelName }),
      },
    });
  };

  // 1. The concepts metadata names.
  for (const concept of plan.create) {
    await create(concept, "metadata", concept.definition === undefined ? {} : { carried: concept.definition });
  }

  // 2. Existing entries with no definition.
  for (const { term, carried } of plan.missing) {
    if (carried === undefined && model === undefined) continue;
    const path = term.location.path;
    const base = {
      file: displayPath(term.location.file, cwd),
      id: term.id,
      label: term.record.label,
      ...(term.language === undefined ? {} : { language: term.language }),
      source: "metadata" as const,
      from: [`${displayPath(term.location.file, cwd)}:${String(term.location.line)}`],
    };
    if (term.location.construct !== "page" || path === undefined) {
      entries.push({ action: "skip", ...base, definition: { status: "missing" }, reason: "not a term page" });
      continue;
    }
    let definition: string;
    let provenance: { confidence: number } | undefined;
    if (carried !== undefined) {
      definition = carried;
    } else {
      const got = await draft(term.record.label, term.language, term.record, [{ file: term.location.file }]);
      if (got === undefined) continue;
      if ("skip" in got) {
        entries.push({ action: "skip", ...base, definition: { status: "missing" }, reason: got.skip });
        continue;
      }
      if (got.status === "below-threshold") {
        entries.push({
          action: "skip",
          ...base,
          definition: { status: "below-threshold", confidence: got.confidence, ...(modelName === undefined ? {} : { model: modelName }) },
        });
        continue;
      }
      definition = got.definition;
      provenance = { confidence: got.confidence };
    }
    writes.push({ path, content: await fillInPlace(path, term.location.file, definition, provenance, model) });
    entries.push({
      action: "fill",
      ...base,
      definition:
        provenance === undefined
          ? { status: "carried" }
          : { status: "drafted", confidence: provenance.confidence, ...(modelName === undefined ? {} : { model: modelName }) },
    });
  }

  // 3. The crawl: terms page bodies use that no metadata named.
  if (crawl && model !== undefined) {
    const found: FoundTerm[] = [];
    let spent = false;
    for (const page of pages) {
      const type = page.metadata["type"];
      if (type === "term" || type === "term-set") continue;
      for (const keyword of keywordsOf(page.metadata["keywords"])) {
        found.push({
          file: page.file,
          label: keyword,
          ...(page.keywordsLine === undefined ? {} : { line: page.keywordsLine }),
          ...(page.language === undefined ? {} : { language: page.language }),
        });
      }
      if (spent) continue;
      const chunks = splitBody(page.content, chunkChars);
      for (const [i, chunk] of chunks.entries()) {
        const user = `Page ${page.file}${chunks.length > 1 ? ` (part ${String(i + 1)} of ${String(chunks.length)})` : ""}\n\n${chunk}`;
        let answer;
        try {
          answer = await ask(model, "crawl", CRAWL_SYSTEM, user, CRAWL_SCHEMA, validateCrawl);
        } catch (error) {
          opts.onNotice?.(`${page.file}: the model could not read it: ${errorMessage(error)}`);
          continue;
        }
        if (answer === undefined) {
          spent = true;
          opts.onNotice?.(`--max-turns reached (${String(maxTurns)}); some pages were not crawled.`);
          break;
        }
        const terms = Array.isArray(answer["terms"]) ? (answer["terms"] as unknown[]) : [];
        for (const item of terms) {
          if (typeof item !== "object" || item === null) continue;
          const t = item as Record<string, unknown>;
          const label = nonEmpty(t["label"]);
          if (label === undefined) continue;
          const definition = nonEmpty(t["definition"]);
          const line = lineOf(page.content, label);
          found.push({
            file: page.file,
            label,
            altLabels: strings(t["alt-labels"]),
            ...(definition === undefined ? {} : { definition }),
            confidence: score(t["confidence"]),
            ...(line === undefined ? {} : { line }),
            ...(page.language === undefined ? {} : { language: page.language }),
          });
        }
      }
    }
    for (const candidate of newCandidates(mergeFound(found), known, minPages)) {
      const concept = { label: candidate.label, from: candidate.from, altLabels: candidate.altLabels, ...(candidate.language === undefined ? {} : { language: candidate.language }) };
      const fields = ["/label", ...(candidate.altLabels.length > 0 ? ["/alt-labels"] : []), "/definition"];
      if (candidate.confidence === undefined || candidate.definition === undefined) {
        // Named only by keywords: a draft decides it.
        const got = await draft(candidate.label, candidate.language, {}, candidate.from);
        if (got === undefined || "skip" in got || got.status === "below-threshold") {
          entries.push({
            action: "skip",
            file: displayPath(join(outDir ?? cwd, `${slugOf(candidate.label)}${ext}`), cwd),
            id: slugOf(candidate.label),
            label: candidate.label,
            ...(candidate.language === undefined ? {} : { language: candidate.language }),
            source: "crawl",
            from: fromList(candidate.from, cwd),
            ...(got !== undefined && "skip" in got
              ? { definition: { status: "missing" as const }, reason: got.skip }
              : {
                  definition: {
                    status: "below-threshold" as const,
                    ...(got === undefined ? {} : { confidence: got.confidence }),
                    ...(modelName === undefined ? {} : { model: modelName }),
                  },
                }),
          });
          continue;
        }
        await create(concept, "crawl", { drafted: got, fields });
        continue;
      }
      if (candidate.confidence < threshold) {
        entries.push({
          action: "skip",
          file: displayPath(join(outDir ?? cwd, `${slugOf(candidate.label)}${ext}`), cwd),
          id: slugOf(candidate.label),
          label: candidate.label,
          ...(candidate.language === undefined ? {} : { language: candidate.language }),
          source: "crawl",
          from: fromList(candidate.from, cwd),
          definition: { status: "below-threshold", confidence: candidate.confidence, ...(modelName === undefined ? {} : { model: modelName }) },
        });
        continue;
      }
      await create(concept, "crawl", { drafted: { definition: candidate.definition, confidence: candidate.confidence }, fields });
    }
  }

  if (!dryRun) {
    for (const { path, content } of writes) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }

  const count = (action: FillAction): number => entries.filter((e) => e.action === action).length;
  return {
    entries,
    summary: {
      created: count("create"),
      filled: count("fill"),
      skipped: count("skip"),
      withoutDefinition: entries.filter(
        (e) => (e.action === "create" || e.action === "skip") && e.definition.status !== "drafted" && e.definition.status !== "carried",
      ).length,
      turns,
    },
    dryRun,
    threshold,
  };
}

/** An existing term page with `definition` set, and the model that drafted it recorded in `meta-provenance`. */
async function fillInPlace(
  path: string,
  file: string,
  definition: string,
  provenance: { confidence: number } | undefined,
  model: Model | undefined,
): Promise<string> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    throw new TermError(`${file}: could not be read: ${errorMessage(error)}`);
  }
  const extractor = extractorForExtension(extname(path)) ?? extractorByName("markdown");
  if (extractor?.apply === undefined) throw new TermError(`${file}: manni cannot write its metadata.`);
  const patch: Record<string, unknown> = { definition };
  if (provenance !== undefined && model !== undefined) {
    const held = extractor.extract(content, path).data[META_PROVENANCE_KEY];
    const merged = mergeMetaProvenance(held, model.identity.model, "fields", [{ name: "/definition", confidence: provenance.confidence }]);
    if (merged !== undefined) patch[META_PROVENANCE_KEY] = merged.list;
  }
  try {
    return extractor.apply(content, patch, { filePath: path });
  } catch (error) {
    throw new TermError(`${file}: ${errorMessage(error)}`);
  }
}
