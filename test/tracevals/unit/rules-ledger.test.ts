import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  historyBlock,
  ledgerPath,
  readLedger,
  recordTurn,
  writeLedger,
  type Ledger,
  type TurnResult,
} from "../../../src/tracevals/rules/ledger.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "turn-ledger-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const KEY = "CLAUDE.md#run-tests";
const TEXT = "Run the tests after editing code.";
const result = (outcome: TurnResult["outcome"], note = ""): TurnResult => ({ key: KEY, text: TEXT, outcome, note });
const empty: Ledger = { version: 1, rules: {} };

describe("ledgerPath", () => {
  it("hashes the session and the agent into the sessions directory", () => {
    const main = ledgerPath(dir, "s1", null);
    const agent = ledgerPath(dir, "s1", "a1");
    expect(dirname(main)).toBe(join(dir, ".manni", "tracevals", "sessions"));
    expect(main).toMatch(/[0-9a-f]{32}\.ledger\.json$/);
    expect(agent).toMatch(/[0-9a-f]{32}\.[0-9a-f]{32}\.ledger\.json$/);
    expect(ledgerPath(dir, "s1", "a2")).not.toBe(agent);
    expect(dirname(ledgerPath(dir, "../x", "../y"))).toBe(dirname(main));
  });
});

describe("readLedger", () => {
  it("reads a missing or unreadable ledger as empty", async () => {
    expect(await readLedger(join(dir, "missing.json"))).toEqual(empty);
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{not json");
    expect(await readLedger(bad)).toEqual(empty);
    await writeFile(bad, JSON.stringify({ version: 2, rules: {} }));
    expect(await readLedger(bad)).toEqual(empty);
  });

  it("round-trips what writeLedger wrote, atomically", async () => {
    const path = join(dir, "nested", "l.ledger.json");
    const ledger = recordTurn(empty, 4, [result("broken", "No test run.")]);
    await writeLedger(path, ledger);
    expect(await readLedger(path)).toEqual(ledger);
    expect(await readdir(dirname(path))).toEqual(["l.ledger.json"]);
  });
});

describe("recordTurn", () => {
  it("replaces the same turn's entry, as the repair pass does", () => {
    const first = recordTurn(empty, 4, [result("broken", "No test run.")]);
    const repaired = recordTurn(first, 4, [result("followed", "Ran npm test.")]);
    expect(repaired.rules[KEY]?.entries).toEqual([{ turn: 4, outcome: "followed", note: "Ran npm test." }]);
  });

  it("keeps the last ten entries and cuts notes to 200 characters", () => {
    let ledger = empty;
    for (let turn = 0; turn < 12; turn++) ledger = recordTurn(ledger, turn, [result("followed", "x".repeat(300))]);
    const entries = ledger.rules[KEY]?.entries ?? [];
    expect(entries.map((e) => e.turn)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(entries[0]?.note).toHaveLength(200);
  });

  it("starts an edited rule fresh", () => {
    const old = recordTurn(empty, 1, [result("broken")]);
    const edited = recordTurn(old, 5, [{ ...result("followed"), text: "Run the tests." }]);
    expect(edited.rules[KEY]?.entries).toEqual([{ turn: 5, outcome: "followed", note: "" }]);
  });
});

describe("historyBlock", () => {
  const ledger = [
    [1, "not-applicable"],
    [2, "followed"],
    [3, "broken"],
    [4, "needs-review"],
    [5, "followed"],
    [9, "broken"],
  ].reduce<Ledger>(
    (l, [turn, outcome]) => recordTurn(l, turn as number, [result(outcome as TurnResult["outcome"], `n${String(turn)}`)]),
    empty,
  );

  it("shows the last three earlier entries that were not not-applicable", () => {
    expect(historyBlock(ledger, KEY, TEXT, 9)).toBe(
      "# Earlier in this session\n\n- turn 3: broken. n3\n- turn 4: needs-review. n4\n- turn 5: followed. n5",
    );
  });

  it("ignores the current turn and later ones", () => {
    expect(historyBlock(ledger, KEY, TEXT, 3)).toBe("# Earlier in this session\n\n- turn 2: followed. n2");
  });

  it("is empty with no history, only not-applicable history, or an edited rule", () => {
    expect(historyBlock(empty, KEY, TEXT, 9)).toBe("");
    expect(historyBlock(ledger, KEY, TEXT, 2)).toBe("");
    expect(historyBlock(ledger, KEY, "Run the tests.", 9)).toBe("");
    expect(historyBlock(ledger, "CLAUDE.md#other", TEXT, 9)).toBe("");
  });

  it("drops the note's separator when there is no note", () => {
    const bare = recordTurn(empty, 1, [result("broken")]);
    expect(historyBlock(bare, KEY, TEXT, 2)).toBe("# Earlier in this session\n\n- turn 1: broken.");
  });
});

describe("ledger directory", () => {
  it("is created on first write", async () => {
    const project = join(dir, "fresh");
    await mkdir(project);
    const path = ledgerPath(project, "s", null);
    await writeLedger(path, empty);
    expect(await readLedger(path)).toEqual(empty);
  });
});
