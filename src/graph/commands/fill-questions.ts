/**
 * The question pass of `manni graph fill` (proposal 0087). It re-pins moved
 * answers, pairs questions with the passage that answers them, re-pairs
 * changed answers, and drafts questions until a page has `perPage`. It runs
 * beside the `graph:` field pipeline, with its own completeness rule, prompt
 * and cache key, and writes `sample-questions`, ai-context's key, outside the
 * `graph:` block.
 *
 * The model quotes, and the tool pins. A quote is found in the body, and the
 * whole lines it touches are pinned under cite's hashing rule. So a quote is
 * never written, and a quote the page does not hold never becomes a pin.
 * Re-pinning needs no model and spends no turn.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { splitBody } from "../../meta/commands/fill-prompt.js";
import {
  findWindows,
  lineSpec,
  parseLines,
  pinOfLines,
  spellLines,
  type PageLines,
} from "../../shared/pin.js";
import { formatOf, metadataOf, type DocFormat } from "../core/analyze.js";
import { writeGraphFields } from "../core/frontmatter-edit.js";
import {
  COPIED_SHARE,
  copiedPairs,
  questionKey,
  readQuestionFile,
} from "../core/questions.js";
import type { QuestionRequest } from "../llm/prompt.js";
import { bodyOf, freshness, matchList } from "./questions.js";

/** The page key questions live under (manni:ai-context:1.1.0). */
export const QUESTIONS_KEY = "sample-questions";

export type QuestionAction =
  | "drafted"
  | "paired"
  | "re-paired"
  | "re-pinned"
  | "dropped"
  | "not-paired";

/** What `fill` did with one question, as the report lists it. */
export interface QuestionOutcome {
  action: QuestionAction;
  question: string;
  /** The page a golden-set file's answer is on. */
  file?: string;
  /** The answer's lines as written now. */
  lines?: string;
  /** The lines a re-pinned answer moved from. */
  from?: string;
  confidence?: number;
  /** Why a question was dropped or not paired. */
  reason?: string;
}

/** The model, as the question pass reaches it. */
export interface QuestionAsker {
  /** `provider/model`, as `generated-by` records it. */
  generatedBy: string;
  /**
   * The model's answer for one piece of the body, from the cache or one
   * turn. `undefined` when the turn budget is spent.
   */
  ask(request: QuestionRequest, chunk: string): Promise<Record<string, unknown> | undefined>;
}

export interface QuestionSettings {
  perPage: number;
  confidenceThreshold: number;
  chunkChars: number;
  writeProvenance: boolean;
}

export interface PageQuestionsInput {
  path: string;
  format: DocFormat;
  content: string;
  title: string;
  /** The page's concepts for the prompt, read only when a model is asked. */
  concepts: () => Promise<QuestionRequest["concepts"]>;
  settings: QuestionSettings;
  /** `undefined` under `--offline` with no local model on disk. */
  asker: QuestionAsker | undefined;
  /** Every question asked anywhere, by `questionKey`, and where it is asked. */
  known: Map<string, string>;
}

export interface PageQuestionsResult {
  /** The page with its questions written, or as it came. */
  content: string;
  outcomes: QuestionOutcome[];
  /**
   * `complete` asked nothing of a model and changed nothing. `unchanged`
   * asked, and every answer was gated. `skipped` needed a model it could not
   * reach, and changed nothing.
   */
  state: "complete" | "changed" | "unchanged" | "skipped";
  /** Why the model's part was skipped: `offline` or `turn budget`. */
  skipped?: string;
  warnings: string[];
}

/** One outcome, with the pin its lines are read from once every pin is final. */
type Tracked = QuestionOutcome & { pin?: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Confidence to 2 decimals, as the field pipeline writes it. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A score in range, or 0: unscored counts as 0, as the field gate counts it. */
function score(value: unknown): number {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : 0;
}

/** A pin's lines, or undefined for a malformed one. */
function linesOf(pin: Record<string, unknown>): PageLines | undefined {
  const spec = pin.lines;
  return typeof spec === "number" || typeof spec === "string" ? parseLines(spec) : undefined;
}

interface Proposal {
  pairs: { index: number; quote: string; confidence: number }[];
  drafts: { question: string; quote: string; confidence: number }[];
}

/** The model's answer, read leniently: a malformed item is skipped, not fatal. */
function readProposal(value: Record<string, unknown>): Proposal {
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter(isRecord) : [];
  return {
    pairs: list(value.pairs).flatMap((p) =>
      typeof p.index === "number" && typeof p.quote === "string"
        ? [{ index: p.index, quote: p.quote, confidence: score(p.confidence) }]
        : [],
    ),
    drafts: list(value.drafts).flatMap((d) =>
      typeof d.question === "string" && d.question.trim() !== "" && typeof d.quote === "string"
        ? [{ question: d.question.trim(), quote: d.quote, confidence: score(d.confidence) }]
        : [],
    ),
  };
}

/**
 * The whole body lines a quote touches, found as a substring of the body with
 * runs of whitespace folded, so a quote that rewraps a line still matches.
 */
export function locateQuote(
  body: readonly string[],
  quote: string,
): (PageLines & { ambiguous?: true }) | undefined {
  const wanted = quote.replace(/\s+/gu, " ").trim();
  if (wanted === "") return undefined;
  const text = body.join("\n");
  let folded = "";
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (/\s/u.test(ch)) {
      if (!space && folded !== "") {
        folded += " ";
        at.push(i);
      }
      space = true;
    } else {
      folded += ch;
      at.push(i);
      space = false;
    }
  }
  const found = folded.indexOf(wanted);
  if (found < 0) return undefined;
  const lineAt = (offset: number): number => text.slice(0, offset).split("\n").length;
  const start = at[found];
  const end = at[found + wanted.length - 1];
  if (start === undefined || end === undefined) return undefined;
  // The first match is the one pinned; a quote the page holds twice says so,
  // so the caller can warn that the pin may name the wrong copy.
  const twice = folded.indexOf(wanted, found + 1) >= 0;
  return { start: lineAt(start), end: lineAt(end), ...(twice ? { ambiguous: true as const } : {}) };
}

/** The warning for a quote the page holds more than once. */
function twiceWarning(path: string, question: string, lines: PageLines): string {
  return `${path}: the answer to "${question}" appears more than once, so ${spellLines(lines)} is pinned; check it is the right one.`;
}

/** The pin `fill` writes for body lines it found. */
function pinFor(body: readonly string[], lines: PageLines): Record<string, unknown> {
  return { lines: lineSpec(lines), integrity: pinOfLines(body, lines) };
}

/**
 * Every pin back on the lines it hashes, after the write. On HTML and XML the
 * metadata sits in the body lines are counted from, so writing questions
 * shifts every answer below it. A pin that no longer matches is found again
 * near where the shift puts it.
 */
function relocate(
  pins: readonly Record<string, unknown>[],
  before: readonly string[],
  after: readonly string[],
): boolean {
  const delta = after.length - before.length;
  let moved = false;
  for (const pin of pins) {
    const lines = linesOf(pin);
    const integrity = pin.integrity;
    if (lines === undefined || typeof integrity !== "string") continue;
    if (pinOfLines(after, lines) === integrity) continue;
    const length = lines.end - lines.start + 1;
    const around = lines.start + delta;
    const { starts } = findWindows(after, length, integrity, undefined, { around });
    const [first, ...rest] = starts;
    if (first === undefined) continue;
    const nearest = rest.reduce(
      (best, s) => (Math.abs(s - around) < Math.abs(best - around) ? s : best),
      first,
    );
    pin.lines = lineSpec({ start: nearest, end: nearest + length - 1 });
    moved = true;
  }
  return moved;
}

/** Outcomes as reported: each one's lines read from its pin, now final. */
function settle(tracked: readonly Tracked[]): QuestionOutcome[] {
  return tracked.map(({ pin, ...outcome }) => {
    const lines = pin === undefined ? undefined : linesOf(pin);
    return lines === undefined ? outcome : { ...outcome, lines: spellLines(lines) };
  });
}

/** One page's questions: re-pin, then pair, re-pair and draft. */
export async function fillPageQuestions(input: PageQuestionsInput): Promise<PageQuestionsResult> {
  const { path, format, content, settings, asker, known } = input;
  const { body } = bodyOf(content, format);
  const held = metadataOf(content, path, format).data[QUESTIONS_KEY];
  const raw: unknown[] = Array.isArray(held) ? held : held === undefined ? [] : [held];

  const tracked: Tracked[] = [];
  const warnings: string[] = [];
  /** The list as it will be written. Items are copies, never the parsed values. */
  const items: unknown[] = [];
  /** Every pin with an integrity in `items`, to put back after the write. */
  const pins: Record<string, unknown>[] = [];
  /** Questions with no pin, or with a pin whose lines changed. */
  const needs: { at: number; question: string; stale: Set<unknown> }[] = [];
  let questions = 0;
  let changed = false;

  // 1. Re-pin, with no model.
  for (const value of raw) {
    if (typeof value === "string" && value !== "") {
      questions++;
      needs.push({ at: items.length, question: value, stale: new Set() });
      items.push(value);
      continue;
    }
    if (!isRecord(value) || typeof value.question !== "string" || value.question === "") {
      items.push(value);
      continue;
    }
    questions++;
    const question = value.question;
    const answers: unknown[] = Array.isArray(value.answers)
      ? (value.answers as unknown[]).map((a) => (isRecord(a) ? { ...a } : a))
      : [];
    const item: Record<string, unknown> = { ...value };
    if (Array.isArray(value.answers)) item.answers = answers;
    const stale = new Set<unknown>();
    for (const answer of answers) {
      if (!isRecord(answer)) continue;
      const lines = linesOf(answer);
      if (lines === undefined) continue;
      const integrity = answer.integrity;
      if (typeof integrity !== "string") {
        const minted = pinOfLines(body, lines);
        if (minted === undefined) {
          stale.add(answer);
          continue;
        }
        answer.integrity = minted;
        pins.push(answer);
        tracked.push({ action: "re-pinned", question, pin: answer });
        changed = true;
        continue;
      }
      const fresh = freshness(body, { lines, integrity, reviewed: true });
      if (fresh.state === "changed") {
        stale.add(answer);
        continue;
      }
      pins.push(answer);
      const [range] = fresh.ranges;
      if (fresh.state === "moved" && range !== undefined) {
        answer.lines = lineSpec(range);
        tracked.push({ action: "re-pinned", question, from: spellLines(lines), pin: answer });
        changed = true;
      } else if (fresh.state === "ambiguous") {
        warnings.push(
          `${path}: the answer to "${question}" moved, and ${matchList(fresh.ranges)}, so pin one of them by hand.`,
        );
      }
    }
    if (answers.length === 0 || stale.size > 0) {
      needs.push({ at: items.length, question, stale });
    }
    items.push(item);
  }

  const draft = Math.max(0, settings.perPage - questions);
  let state: PageQuestionsResult["state"] = "complete";
  let skipped: string | undefined;

  if (needs.length > 0 || draft > 0) {
    const proposals = asker === undefined ? "offline" : await ask(asker);
    if (typeof proposals === "string" || asker === undefined) {
      skipped = typeof proposals === "string" ? proposals : "offline";
      state = "skipped";
    } else {
      state = "unchanged";
      if (pair(proposals)) changed = true;
      if (drafts(proposals, asker)) changed = true;
    }
  }

  if (!changed) {
    return { content, outcomes: settle(tracked), state, ...(skipped ? { skipped } : {}), warnings };
  }

  // Pins are taken from the text as written: write, then put every pin back
  // on its lines, until a write moves nothing.
  const write = (): string =>
    writeGraphFields(content, path, format, {}, { page: { [QUESTIONS_KEY]: items } }).content;
  let next = write();
  let before = body;
  for (let round = 0; ; round++) {
    const after = bodyOf(next, format).body;
    if (!relocate(pins, before, after)) break;
    if (round === 2) {
      // Three writes and the pins still moved: write what there is, and say so.
      warnings.push(`${path}: the answer pins did not settle after three writes, so check their lines.`);
      break;
    }
    before = after;
    next = write();
  }
  return {
    content: next,
    outcomes: settle(tracked),
    state: "changed",
    ...(skipped ? { skipped } : {}),
    warnings,
  };

  /** Every chunk's answer, or the reason the model could not be asked. */
  async function ask(model: QuestionAsker): Promise<Proposal[] | string> {
    const request: QuestionRequest = {
      path,
      title: input.title,
      concepts: await input.concepts(),
      pair: needs.map((n) => n.question),
      draft,
    };
    const out: Proposal[] = [];
    for (const chunk of splitBody(body.join("\n"), settings.chunkChars)) {
      const answer = await model.ask(request, chunk);
      if (answer === undefined) return "turn budget";
      out.push(readProposal(answer));
    }
    return out;
  }

  /** 2 and 3. Pair each question with the best quote the page holds. */
  function pair(proposals: readonly Proposal[]): boolean {
    let wrote = false;
    for (const [n, need] of needs.entries()) {
      const action = need.stale.size > 0 ? "re-paired" : "paired";
      const question = need.question;
      const candidates = proposals
        .flatMap((p) => p.pairs.filter((c) => c.index === n + 1 && c.quote.trim() !== ""))
        .sort((a, b) => b.confidence - a.confidence);
      if (candidates.length === 0) {
        tracked.push({ action: "not-paired", question, reason: "no passage answers it" });
        continue;
      }
      let found: { lines: PageLines; confidence: number } | undefined;
      for (const c of candidates) {
        const lines = locateQuote(body, c.quote);
        if (lines !== undefined) {
          if (lines.ambiguous) warnings.push(twiceWarning(path, question, lines));
          found = { lines: { start: lines.start, end: lines.end }, confidence: c.confidence };
          break;
        }
      }
      if (found === undefined) {
        tracked.push({ action: "not-paired", question, reason: "answer not on page" });
        continue;
      }
      const confidence = round2(found.confidence);
      if (found.confidence < settings.confidenceThreshold) {
        tracked.push({ action: "not-paired", question, confidence, reason: "low confidence, not written" });
        continue;
      }
      // The pin is a draft even on a confirmed question, and the question
      // keeps its own standing.
      const pin = { ...pinFor(body, found.lines), reviewed: false };
      pins.push(pin);
      const item = items[need.at];
      if (typeof item === "string") {
        items[need.at] = { question: item, answers: [pin] };
      } else if (isRecord(item)) {
        const kept = Array.isArray(item.answers) ? (item.answers as unknown[]).filter((a) => !need.stale.has(a)) : [];
        item.answers = [...kept, pin];
      }
      tracked.push({ action, question, confidence, pin });
      wrote = true;
    }
    return wrote;
  }

  /** 4. Pool every chunk's drafts, gate them, and keep the most confident. */
  function drafts(proposals: readonly Proposal[], model: QuestionAsker): boolean {
    const pool = proposals.flatMap((p) => p.drafts).sort((a, b) => b.confidence - a.confidence);
    let accepted = 0;
    for (const d of pool) {
      if (accepted >= draft) break;
      const question = d.question;
      const confidence = round2(d.confidence);
      const located = locateQuote(body, d.quote);
      if (located === undefined) {
        tracked.push({ action: "dropped", question, reason: "answer not on page" });
        continue;
      }
      if (located.ambiguous) warnings.push(twiceWarning(path, question, located));
      const lines: PageLines = { start: located.start, end: located.end };
      const key = questionKey(question);
      const asked = key === "" ? undefined : known.get(key);
      if (asked !== undefined) {
        tracked.push({ action: "dropped", question, reason: `duplicate of ${asked}` });
        continue;
      }
      const copied = copiedPairs(question, body.slice(lines.start - 1, lines.end).join("\n"));
      if (copied && copied.copied / copied.of > COPIED_SHARE) {
        tracked.push({
          action: "dropped",
          question,
          reason: `copies its answer (${String(copied.copied)} of ${String(copied.of)} word pairs)`,
        });
        continue;
      }
      if (d.confidence < settings.confidenceThreshold) {
        tracked.push({ action: "dropped", question, confidence, reason: "low confidence, not written" });
        continue;
      }
      const pin = pinFor(body, lines);
      pins.push(pin);
      items.push({
        question,
        answers: [pin],
        ...(settings.writeProvenance ? { "generated-by": model.generatedBy, confidence } : {}),
        reviewed: false,
      });
      if (key !== "") known.set(key, path);
      tracked.push({ action: "drafted", question, confidence, pin });
      accepted++;
    }
    return accepted > 0;
  }
}

/** Every question a page holds, as written, for the duplicate gate. */
export function questionsIn(content: string, path: string, format: DocFormat): string[] {
  const held = metadataOf(content, path, format).data[QUESTIONS_KEY];
  const raw: unknown[] = Array.isArray(held) ? held : held === undefined ? [] : [held];
  return raw.flatMap((v) =>
    typeof v === "string" ? [v] : isRecord(v) && typeof v.question === "string" ? [v.question] : [],
  );
}

/** Every question a golden-set file holds. A file that cannot be read is an operational error. */
export function questionsInFile(abs: string, label: string): string[] {
  return readQuestionFile(abs, label).map((q) => q.question);
}

/**
 * A golden-set file's answers re-pinned: a moved answer gets its new lines,
 * and one with no `integrity` gets one. Nothing is drafted or paired there.
 * The file is rewritten only when something changed and it is not a dry run.
 */
export function repinQuestionFile(
  abs: string,
  label: string,
  configDir: string,
  dryRun: boolean,
): { changed: boolean; outcomes: QuestionOutcome[]; warnings: string[] } {
  // One read: the file is validated and edited from the same bytes.
  const text = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  readQuestionFile(abs, label, text);
  // readQuestionFile throws when the file is absent, so text is set here. The
  // fallback only satisfies the type, which a throw does not narrow.
  const doc = parseDocument(text ?? "");
  const outcomes: QuestionOutcome[] = [];
  const warnings: string[] = [];
  const bodies = new Map<string, string[] | undefined>();
  const bodyAt = (file: string): string[] | undefined => {
    if (!bodies.has(file)) {
      const page = resolve(configDir, file);
      bodies.set(
        file,
        existsSync(page) ? bodyOf(readFileSync(page, "utf8"), formatOf(file)).body : undefined,
      );
    }
    return bodies.get(file);
  };
  let changed = false;
  const seq = doc.contents;
  for (const node of isSeq(seq) ? seq.items : []) {
    if (!isMap(node)) continue;
    const question: unknown = node.get("question");
    const answers = node.get("answers", true);
    if (typeof question !== "string" || !isSeq(answers)) continue;
    for (const answer of answers.items) {
      if (!isMap(answer)) continue;
      const file = answer.get("file");
      const spec = answer.get("lines");
      const lines = typeof spec === "number" || typeof spec === "string" ? parseLines(spec) : undefined;
      if (typeof file !== "string" || lines === undefined) continue;
      const body = bodyAt(file);
      if (body === undefined) continue;
      const integrity = answer.get("integrity");
      if (typeof integrity !== "string") {
        const minted = pinOfLines(body, lines);
        if (minted === undefined) continue;
        answer.set("integrity", minted);
        outcomes.push({ action: "re-pinned", question, file, lines: spellLines(lines) });
        changed = true;
        continue;
      }
      const fresh = freshness(body, { lines, integrity, reviewed: true });
      if (fresh.state === "changed") continue;
      const [range] = fresh.ranges;
      if (fresh.state === "moved" && range !== undefined) {
        answer.set("lines", lineSpec(range));
        outcomes.push({ action: "re-pinned", question, file, from: spellLines(lines), lines: spellLines(range) });
        changed = true;
      } else if (fresh.state === "ambiguous") {
        warnings.push(
          `${label}: the answer to "${question}" in ${file} moved, and ${matchList(fresh.ranges)}, so pin one of them by hand.`,
        );
      }
    }
  }
  if (changed && !dryRun) writeFileSync(abs, doc.toString(), "utf8");
  return { changed, outcomes, warnings };
}
