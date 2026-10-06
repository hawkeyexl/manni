/**
 * The session ledger (proposal 0079, "The ledger"). What each turn of one
 * session did, and what the in-loop judge found for each rule, so a rule
 * about a procedure that spans turns is judged with what earlier turns did.
 *
 * Only the hook writes it, one file per session and one per subagent, so
 * parallel SubagentStops never share a file. `check` by hand reads it and
 * never writes it. A missing or unreadable ledger is an empty history.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DEFAULT_CAPTURE_DIR } from "../capture/types.js";
import { makeRedactor } from "../judge/redact.js";
import type { Trace } from "../trace/types.js";
import { pathKey, type RuleSource } from "./sources.js";
import type { TurnSlice } from "./turn.js";

export type LedgerOutcome = "followed" | "broken" | "needs-review" | "not-applicable";

export interface LedgerEntry {
  /** The turn's first event, as an ordinal in the trace. */
  turn: number;
  outcome: LedgerOutcome;
  /** The judge's reasoning, cut to `NOTE_CHARS`. */
  note: string;
}

/** What one turn did, read from the trace with no model. */
export interface TurnFacts {
  turn: number;
  /** Whether any rule source governed the turn. */
  inScope: boolean;
  /** The rule sources in scope, by display path. */
  sources: string[];
  /** Bash commands, each clipped to `COMMAND_CHARS`. */
  commands: string[];
  /** Files written or edited, relative to the project. */
  wrote: string[];
  /** Rule sources the turn read. */
  read: string[];
  skills: string[];
  /** Subagent types the turn spawned. */
  agents: string[];
}

export interface Ledger {
  version: 1;
  /** The last `FACT_TURNS` turns the hook saw, oldest first. */
  turns: TurnFacts[];
  /** Keyed `<source>#<id>`. `text` is the rule text's sha256, so an edited rule starts fresh. */
  rules: Record<string, { text: string; entries: LedgerEntry[] }>;
}

export const LEDGER_ENTRIES = 10;
export const HISTORY_ENTRIES = 5;
export const NOTE_CHARS = 200;
export const FACT_TURNS = 30;
export const COMMAND_CHARS = 120;
const LIMIT = { commands: 10, wrote: 10, read: 5, skills: 10, agents: 10 } as const;
/** Runs of turns a rule's source missed, shown in its history. */
const GAP_RUNS = 3;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** A session or agent id, hashed so nothing in it can climb out of the directory. */
export function idHash(id: string): string {
  return sha256(id).slice(0, 32);
}

/** `<project>/.manni/tracevals/sessions/<session hash>[.<agent id hash>].ledger.json` */
export function ledgerPath(projectDir: string, sessionId: string, agentId: string | null): string {
  const agent = agentId === null ? "" : `.${idHash(agentId)}`;
  return join(projectDir, DEFAULT_CAPTURE_DIR, `${idHash(sessionId)}${agent}.ledger.json`);
}

export const emptyLedger = (): Ledger => ({ version: 1, turns: [], rules: {} });

const OUTCOMES = new Set<unknown>(["followed", "broken", "needs-review", "not-applicable"]);

function isEntry(v: unknown): v is LedgerEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.turn === "number" && OUTCOMES.has(e.outcome) && typeof e.note === "string";
}

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const FACT_LISTS = ["sources", "commands", "wrote", "read", "skills", "agents"] as const;

function isFacts(v: unknown): v is TurnFacts {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.turn === "number" &&
    typeof f.inScope === "boolean" &&
    FACT_LISTS.every((k) => isStrings(f[k]))
  );
}

/** Never throws: anything but a well-formed ledger reads as an empty one. */
export async function readLedger(path: string): Promise<Ledger> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return emptyLedger();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyLedger();
  const { version, turns, rules } = parsed as Record<string, unknown>;
  if (version !== 1 || typeof rules !== "object" || rules === null) return emptyLedger();
  const ledger = emptyLedger();
  if (Array.isArray(turns)) ledger.turns = turns.filter(isFacts);
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value !== "object" || value === null) continue;
    const { text, entries } = value as Record<string, unknown>;
    if (typeof text !== "string" || !Array.isArray(entries)) continue;
    ledger.rules[key] = { text, entries: entries.filter(isEntry) };
  }
  return ledger;
}

/** The source half of a `<source>#<id>` key. */
const sourceOf = (key: string): string => key.slice(0, key.lastIndexOf("#"));

/**
 * The entries a rule's history keeps in view: its latest, its first
 * `followed`, then its `broken` ones from newest back, at most
 * `HISTORY_ENTRIES`, oldest first.
 */
function keyEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const broken = entries.filter((e) => e.outcome === "broken").reverse();
  const picked = [entries.at(-1), entries.find((e) => e.outcome === "followed"), ...broken];
  return [...new Set(picked.filter((e): e is LedgerEntry => e !== undefined))]
    .slice(0, HISTORY_ENTRIES)
    .sort((a, b) => a.turn - b.turn);
}

/** The last `GAP_RUNS` runs of consecutive recorded turns whose sources leave `source` out. */
function gaps(turns: TurnFacts[], source: string): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let open: { from: number; to: number } | undefined;
  for (const t of turns) {
    if (t.sources.includes(source)) {
      open = undefined;
    } else if (open !== undefined) {
      open.to = t.turn;
    } else {
      open = { from: t.turn, to: t.turn };
      runs.push(open);
    }
  }
  return runs.slice(-GAP_RUNS);
}

/**
 * The block a rule's item carries, or "" when the ledger holds nothing for it
 * before `before` other than turns it did not apply to. Runs of recorded
 * turns where its source was not in scope are marked, so a hole in the
 * history does not read as quiet.
 */
export function historyBlock(ledger: Ledger, key: string, text: string, before: number): string {
  const rule = ledger.rules[key];
  if (rule?.text !== sha256(text)) return "";
  const shown = keyEntries(
    rule.entries.filter((e) => e.turn < before && e.outcome !== "not-applicable"),
  );
  if (shown.length === 0) return "";
  const entries = shown.map((e) => ({
    turn: e.turn,
    line: `- turn ${String(e.turn)}: ${e.outcome}.${e.note !== "" ? ` ${e.note}` : ""}`,
  }));
  const holes = gaps(
    ledger.turns.filter((t) => t.turn < before),
    sourceOf(key),
  ).map((g) => ({
    turn: g.from,
    line:
      g.from === g.to
        ? `- (turn ${String(g.from)}: not in scope)`
        : `- (turns ${String(g.from)}–${String(g.to)}: not in scope)`,
  }));
  const lines = [...entries, ...holes].sort((a, b) => a.turn - b.turn).map((l) => l.line);
  return `# This rule earlier in this session\n\n${lines.join("\n")}`;
}

const posix = (p: string): string => p.split(sep).join("/");

/** A path as the turn named it, relative to the project root when it is under it. */
export function projectPath(path: string, cwd: string, root: string): string {
  const abs = resolve(cwd, path);
  const r = relative(root, abs);
  return posix(r === "" || r.startsWith("..") || isAbsolute(r) ? abs : r);
}

/** `s` cut to at most `max` characters, the last an ellipsis when cut. */
export const clipTo = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

/**
 * What the turn did, read from its window. Commands and paths pass through
 * the judge's redactor. `sources` are the rule sources in scope, none for a
 * turn that stopped before they were resolved.
 */
export function turnFacts(
  trace: Trace,
  turn: TurnSlice,
  sources: Pick<RuleSource, "path" | "displayPath">[],
  opts: { cwd: string; root: string; redact: readonly string[] },
): TurnFacts {
  const w = turn.window;
  const scrub = makeRedactor(opts.redact);
  const take = (items: string[], n = Number.POSITIVE_INFINITY): string[] =>
    [...new Set(items)].slice(0, n);
  const clip = (s: string): string => clipTo(s, COMMAND_CHARS);
  const rel = (path: string): string => projectPath(path, opts.cwd, opts.root);
  const commands = w.toolCalls.flatMap((c) =>
    c.name === "Bash" && typeof c.input.command === "string"
      ? [clip(scrub(c.input.command.replace(/\s+/g, " ").trim()))]
      : [],
  );
  const reads = new Set(
    w.fileAccesses.filter((a) => a.op === "read").map((a) => pathKey(resolve(opts.cwd, a.path))),
  );
  return {
    turn: turn.from,
    inScope: sources.length > 0,
    sources: take(sources.map((s) => s.displayPath)),
    commands: take(commands, LIMIT.commands),
    wrote: take(
      w.fileAccesses.filter((a) => a.op !== "read").map((a) => scrub(rel(a.path))),
      LIMIT.wrote,
    ),
    read: take(
      sources.filter((s) => reads.has(pathKey(s.path))).map((s) => s.displayPath),
      LIMIT.read,
    ),
    skills: take(
      w.skillInvocations.map((s) => s.name),
      LIMIT.skills,
    ),
    agents: w.empty
      ? []
      : take(
          trace.agentSpawns
            .filter((a) => a.index >= turn.from && a.index <= turn.to)
            .map((a) => a.subagentType),
          LIMIT.agents,
        ),
  };
}

/** The ledger with this turn's facts, replacing any earlier record of the same turn. */
export function recordFacts(ledger: Ledger, facts: TurnFacts): Ledger {
  const turns = [...ledger.turns.filter((t) => t.turn !== facts.turn), facts]
    .sort((a, b) => a.turn - b.turn)
    .slice(-FACT_TURNS);
  return { ...ledger, turns };
}

export interface TurnResult {
  key: string;
  text: string;
  outcome: LedgerOutcome;
  note: string;
}

/**
 * Cut a rule's entries to `LEDGER_ENTRIES`. The first `followed`, every
 * `broken` and the latest are pinned, so the others go first, oldest first.
 * Only when every entry is pinned does the oldest `broken` go.
 */
function trim(entries: LedgerEntry[]): LedgerEntry[] {
  const first = entries.find((e) => e.outcome === "followed");
  const out = [...entries];
  while (out.length > LEDGER_ENTRIES) {
    const last = out.length - 1;
    const loose = out.findIndex((e, i) => e !== first && e.outcome !== "broken" && i !== last);
    out.splice(loose >= 0 ? loose : out.findIndex((e) => e !== first), 1);
  }
  return out;
}

/** The ledger with this turn's results, replacing any earlier record of the same turn. */
export function recordTurn(ledger: Ledger, turn: number, results: TurnResult[]): Ledger {
  const next: Ledger = { ...ledger, rules: { ...ledger.rules } };
  for (const r of results) {
    const hash = sha256(r.text);
    const prior = next.rules[r.key];
    const kept = prior?.text === hash ? prior.entries.filter((e) => e.turn !== turn) : [];
    const entries = trim(
      [...kept, { turn, outcome: r.outcome, note: r.note.slice(0, NOTE_CHARS) }].sort(
        (a, b) => a.turn - b.turn,
      ),
    );
    next.rules[r.key] = { text: hash, entries };
  }
  return next;
}

export interface RuleRollup {
  source: string;
  rule: string;
  followed: number;
  broken: number;
  /** Broken entries that a later `followed` entry came after. */
  repaired: number;
  needsReview: number;
  notApplicable: number;
  /** Recorded turns where the rule's source was not in scope. */
  notInScope: number;
  last: { turn: number; outcome: LedgerOutcome };
}

export interface SessionRollup {
  /** Turns the ledger records. */
  turns: number;
  rules: RuleRollup[];
}

/** Each rule's record over the session, or null when the ledger holds nothing. */
export function rollup(ledger: Ledger): SessionRollup | null {
  const keys = Object.keys(ledger.rules);
  if (ledger.turns.length === 0 && keys.length === 0) return null;
  const rules = keys.flatMap((key): RuleRollup[] => {
    const entries = ledger.rules[key]?.entries ?? [];
    const last = entries.at(-1);
    if (last === undefined) return [];
    const source = sourceOf(key);
    const n = (o: LedgerOutcome): number => entries.filter((e) => e.outcome === o).length;
    return [
      {
        source,
        rule: key.slice(source.length + 1),
        followed: n("followed"),
        broken: n("broken"),
        repaired: entries.filter(
          (e, i) =>
            e.outcome === "broken" && entries.slice(i + 1).some((f) => f.outcome === "followed"),
        ).length,
        needsReview: n("needs-review"),
        notApplicable: n("not-applicable"),
        notInScope: ledger.turns.filter((t) => !t.sources.includes(source)).length,
        last: { turn: last.turn, outcome: last.outcome },
      },
    ];
  });
  return { turns: ledger.turns.length, rules };
}

/** Temp file and rename, so a reader never sees half a ledger. Throws on failure. */
export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
