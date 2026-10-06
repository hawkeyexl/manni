/**
 * The session ledger (proposal 0079, "The ledger"). What the in-loop judge
 * found for each rule on each turn of one session, so a rule about a
 * procedure that spans turns is judged with what earlier turns did.
 *
 * Only the hook writes it, one file per session and one per subagent, so
 * parallel SubagentStops never share a file. `check` by hand reads it and
 * never writes it. A missing or unreadable ledger is an empty history.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_CAPTURE_DIR } from "../capture/types.js";

export type LedgerOutcome = "followed" | "broken" | "needs-review" | "not-applicable";

export interface LedgerEntry {
  /** The turn's first event, as an ordinal in the trace. */
  turn: number;
  outcome: LedgerOutcome;
  /** The judge's reasoning, cut to `NOTE_CHARS`. */
  note: string;
}

export interface Ledger {
  version: 1;
  /** Keyed `<source>#<id>`. `text` is the rule text's sha256, so an edited rule starts fresh. */
  rules: Record<string, { text: string; entries: LedgerEntry[] }>;
}

export const LEDGER_ENTRIES = 10;
export const HISTORY_ENTRIES = 3;
export const NOTE_CHARS = 200;

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

const empty = (): Ledger => ({ version: 1, rules: {} });

const OUTCOMES = new Set<unknown>(["followed", "broken", "needs-review", "not-applicable"]);

function isEntry(v: unknown): v is LedgerEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.turn === "number" && OUTCOMES.has(e.outcome) && typeof e.note === "string";
}

/** Never throws: anything but a well-formed ledger reads as an empty one. */
export async function readLedger(path: string): Promise<Ledger> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return empty();
  }
  if (typeof parsed !== "object" || parsed === null) return empty();
  const { version, rules } = parsed as Record<string, unknown>;
  if (version !== 1 || typeof rules !== "object" || rules === null) return empty();
  const ledger = empty();
  for (const [key, value] of Object.entries(rules)) {
    if (typeof value !== "object" || value === null) continue;
    const { text, entries } = value as Record<string, unknown>;
    if (typeof text !== "string" || !Array.isArray(entries)) continue;
    ledger.rules[key] = { text, entries: entries.filter(isEntry) };
  }
  return ledger;
}

/**
 * The block a rule's item carries, or "" when the ledger holds nothing for it
 * before `before` other than turns it did not apply to.
 */
export function historyBlock(ledger: Ledger, key: string, text: string, before: number): string {
  const rule = ledger.rules[key];
  if (rule?.text !== sha256(text)) return "";
  const shown = rule.entries
    .filter((e) => e.turn < before && e.outcome !== "not-applicable")
    .slice(-HISTORY_ENTRIES);
  if (shown.length === 0) return "";
  const lines = shown.map((e) => `- turn ${String(e.turn)}: ${e.outcome}.${e.note !== "" ? ` ${e.note}` : ""}`);
  return `# Earlier in this session\n\n${lines.join("\n")}`;
}

export interface TurnResult {
  key: string;
  text: string;
  outcome: LedgerOutcome;
  note: string;
}

/** The ledger with this turn's results, replacing any earlier record of the same turn. */
export function recordTurn(ledger: Ledger, turn: number, results: TurnResult[]): Ledger {
  const next: Ledger = { version: 1, rules: { ...ledger.rules } };
  for (const r of results) {
    const hash = sha256(r.text);
    const prior = next.rules[r.key];
    const kept = prior?.text === hash ? prior.entries.filter((e) => e.turn !== turn) : [];
    const entries = [...kept, { turn, outcome: r.outcome, note: r.note.slice(0, NOTE_CHARS) }]
      .sort((a, b) => a.turn - b.turn)
      .slice(-LEDGER_ENTRIES);
    next.rules[r.key] = { text: hash, entries };
  }
  return next;
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
