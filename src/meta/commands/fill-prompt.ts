/**
 * Prompt and schema construction for `fill`.
 *
 * The central idea is the **envelope schema**: each candidate property is asked
 * for as a `{ value, confidence, reasoning }` object, and the whole response is
 * one object keyed by property. `buildEnvelopeSchema` builds three views of
 * that envelope from one candidate list:
 *
 * - **sent**, what the provider is given. Each `value` is the projection of the
 *   property's subschema (`fill-projection.ts`): a plain typed shape a local
 *   grammar can represent, since a merged `allOf` would compile to `null`.
 * - **skeleton**, which checks the response's shape and nothing else. A
 *   response that fails it is a whole-file error.
 * - **full**, each property's own subschema lifted verbatim, which checks every
 *   value on its own. A malformed `date-time` fails that one field, never the
 *   file, which is what lets confidence be the *last* check rather than the
 *   only one.
 */
import { projectValue, type ProjectionDefs } from "./fill-projection.js";
import type { Candidate, Proposal, ProposalSet } from "./fill-types.js";

/**
 * Part of the cache key: bump whenever the prompt wording or the envelope
 * schema construction changes, so stale proposals are not replayed.
 */
export const FILL_PROMPT_VERSION = 5;

/**
 * Characters of document sent per inference call.
 *
 * This was the point at which the document stopped being read: anything past it
 * was replaced with `[body truncated]`, so a long reference page was described
 * from its introduction and its own conclusion was never seen. Same number, but
 * it now bounds a *chunk* — the whole file is sent, in as many calls as it takes.
 *
 * It is docmeta's budget rather than the model's because no per-model input
 * context size is discoverable: the inference catalog publishes `uri`,
 * `sizeBytes`, `license` and tier, and its `maxTokens` is an *output* cap. So
 * overflow cannot be predicted, only hit — which is why the caller treats a
 * provider overflow as a signal to shrink this and retry, rather than trying to
 * compute the right value up front.
 */
export const DEFAULT_CHUNK_CHARS = 12000;

/**
 * Split a document into chunks of at most `chunkChars`.
 *
 * Splits on a line boundary when there is one inside the budget, so a chunk
 * rarely ends mid-sentence; a single line longer than the budget is cut anyway,
 * because a minified file has no boundary to prefer. Concatenating the result
 * reproduces the input exactly — the test asserts that, because "the whole file
 * is sent" is the entire point of the change.
 */
export function splitBody(body: string, chunkChars: number): string[] {
  if (body.length <= chunkChars) return [body];
  const chunks: string[] = [];
  let at = 0;
  while (at < body.length) {
    const end = Math.min(at + chunkChars, body.length);
    let cut = end;
    if (end < body.length) {
      const nl = body.lastIndexOf("\n", end - 1);
      // Only honour the boundary if it makes progress; otherwise the line is
      // longer than the budget and there is nothing to prefer.
      if (nl > at) cut = nl + 1;
    }
    chunks.push(body.slice(at, cut));
    at = cut;
  }
  return chunks;
}

/**
 * Combine per-chunk proposals, keeping the most confident value for each key.
 *
 * Confidence is already the accept/reject axis — `gate()` compares each
 * proposal against the threshold — so choosing between two proposals spends the
 * same currency once more rather than introducing a second one. (It is a
 * threshold, not a ranking: this is the first place two proposals are compared
 * against each other.) A value found in a page's conclusion therefore competes
 * on equal terms with one guessed from its introduction, which is the whole
 * point of reading past the first chunk. Ties keep the earlier chunk —
 * arbitrary, but stable across runs.
 *
 * `passes` says whether a value meets its property's rules. A passing value
 * beats a failing one whatever their confidence, since a failing value is
 * never written. A `null` value is the model declining and is never kept.
 */
export function mergeProposals(
  sets: ProposalSet[],
  passes: (key: string, proposal: Proposal) => boolean = () => true,
): ProposalSet {
  const merged: ProposalSet = {};
  const held = new Map<string, boolean>();
  for (const set of sets) {
    for (const [key, proposal] of Object.entries(set)) {
      if (proposal.value === null) continue;
      const ok = passes(key, proposal);
      const current = merged[key];
      const heldOk = held.get(key);
      if (
        current === undefined ||
        heldOk === undefined ||
        (ok && !heldOk) ||
        (ok === heldOk && proposal.confidence > current.confidence)
      ) {
        merged[key] = proposal;
        held.set(key, ok);
      }
    }
  }
  return merged;
}

export const FILL_SYSTEM_PROMPT = [
  "You infer document metadata from the document itself.",
  "",
  "You are given a page's existing metadata, the JSON Schema properties that are",
  "missing or currently invalid, and the page body. Propose a value for each",
  "property you can determine from the page.",
  "",
  "Rules:",
  "- Base every value on evidence in the page. Never invent facts, URLs, dates,",
  "  authors, or identifiers that the page does not support.",
  "- Omit a property, or answer null as its value, rather than guessing at it. A",
  "  missing property is a normal, expected outcome.",
  "- Report an honest confidence between 0 and 1 that the value is correct and",
  "  that a careful human reviewer would agree with it. Do not inflate it.",
  "  Reserve values above 0.9 for values the page states plainly.",
  "- Keep `reasoning` to one sentence naming the evidence you used.",
  "- Match each property's described purpose, not just its type.",
].join("\n");

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** JSON Schema for one proposal, wrapping `value`, the schema its value takes. */
function proposalSchema(
  candidate: Candidate,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const described =
    typeof candidate.subschema.description === "string"
      ? candidate.subschema.description
      : undefined;
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "reasoning"],
    description: described
      ? `Proposed value for "${candidate.key}": ${described}`
      : `Proposed value for "${candidate.key}".`,
    properties: {
      value,
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Honest self-reported confidence that this value is correct. Do not inflate.",
      },
      reasoning: {
        type: "string",
        description: "One sentence naming the evidence in the page.",
      },
    },
  };
}

/** One envelope: every candidate optional, and no key nobody asked about. */
function envelopeOf(
  properties: [string, Record<string, unknown>][],
  defs?: ProjectionDefs,
): Record<string, unknown> {
  return {
    $schema: DIALECT,
    type: "object",
    additionalProperties: false,
    // Both blocks are reproduced under their original names so a lifted
    // subschema's `$ref` (`#/$defs/X` on 2020-12, `#/definitions/X` on
    // draft-07) still resolves against the envelope root.
    ...(defs !== undefined && Object.keys(defs.$defs).length > 0 ? { $defs: defs.$defs } : {}),
    ...(defs !== undefined && Object.keys(defs.definitions).length > 0
      ? { definitions: defs.definitions }
      : {}),
    properties: Object.fromEntries(properties),
  };
}

/** The three views of one file's envelope. See the module comment. */
export interface Envelope {
  /** What the provider is given: each asked candidate's projected `value`. */
  sent: Record<string, unknown>;
  /** The response's shape alone. Every `value` is `{}`. */
  skeleton: Record<string, unknown>;
  /** Every candidate's full subschema, which checks each value on its own. */
  full: Record<string, unknown>;
  /** The candidates the model is asked about. */
  asked: Candidate[];
  /** Candidates no value can satisfy. The model is never asked about them. */
  unsatisfiable: Candidate[];
}

/**
 * Build one file's envelope. Every candidate is optional so the model can
 * decline; `additionalProperties: false` means it cannot invent keys. The
 * definitions from the source schemas go with the full view, so any `$ref`
 * inside a lifted subschema still resolves. The sent view needs none: the
 * projection has already followed every `$ref`.
 */
export function buildEnvelopeSchema(
  candidates: Candidate[],
  defs: ProjectionDefs,
): Envelope {
  const asked: Candidate[] = [];
  const unsatisfiable: Candidate[] = [];
  const sent: [string, Record<string, unknown>][] = [];
  for (const candidate of candidates) {
    const projected = projectValue(candidate.subschema, defs);
    if ("schema" in projected) {
      asked.push(candidate);
      sent.push([candidate.key, proposalSchema(candidate, projected.schema)]);
    } else {
      unsatisfiable.push(candidate);
    }
  }
  return {
    sent: envelopeOf(sent),
    skeleton: envelopeOf(asked.map((c) => [c.key, proposalSchema(c, {})])),
    full: envelopeOf(
      candidates.map((c) => [c.key, proposalSchema(c, c.subschema)]),
      defs,
    ),
    asked,
    unsatisfiable,
  };
}

export interface UserPromptParams {
  filePath: string;
  existing: Record<string, unknown>;
  candidates: Candidate[];
  body: string;
  /** Set when the document was split, so the model knows it sees a slice. */
  part?: { index: number; total: number };
}

/**
 * The second request for values that failed their properties' rules. It asks
 * only for those properties, and names what each value broke, in Ajv's words:
 * `/resource: must match format "uri"`.
 */
export function buildRetryPrompt(
  params: UserPromptParams & { rejected: string[] },
): string {
  return buildUserPrompt(params, [
    "# Rejected values",
    "Each value below broke a rule of its property's schema. Propose it again,",
    "following the rule, or answer null.",
    ...params.rejected.map((line) => `- ${line}`),
    "",
  ]);
}

export function buildUserPrompt(
  params: UserPromptParams,
  /** Lines placed before the page body. */
  before: string[] = [],
): string {
  const { filePath, existing, candidates, body, part } = params;
  const wanted = candidates.map((c) => {
    const description =
      typeof c.subschema.description === "string"
        ? ` — ${c.subschema.description}`
        : "";
    const why = c.present
      ? "currently invalid, propose a replacement"
      : "missing";
    return `- ${c.key} (${why})${description}`;
  });

  return [
    `# File`,
    filePath,
    "",
    "# Existing metadata",
    Object.keys(existing).length > 0
      ? JSON.stringify(existing, null, 2)
      : "(none)",
    "",
    "# Properties to propose",
    ...wanted,
    "",
    ...before,
    part === undefined
      ? "# Page body"
      : `# Page body (part ${part.index} of ${part.total})`,
    body,
  ].join("\n");
}
