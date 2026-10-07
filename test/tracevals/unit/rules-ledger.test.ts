import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyWindow } from "../../../src/tracevals/graders/util.js";
import {
  COMMAND_CHARS,
  historyBlock,
  ledgerPath,
  readLedger,
  recordFacts,
  recordTurn,
  rollup,
  turnFacts,
  writeLedger,
  type Ledger,
  type TurnFacts,
  type TurnResult,
} from "../../../src/tracevals/rules/ledger.js";
import type { TurnSlice } from "../../../src/tracevals/rules/turn.js";
import type { Trace } from "../../../src/tracevals/trace/types.js";

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
const empty: Ledger = { version: 1, turns: [], rules: {} };

/** One turn's facts, in scope under CLAUDE.md unless overridden. */
const facts = (turn: number, over: Partial<TurnFacts> = {}): TurnFacts => ({
  turn,
  inScope: true,
  sources: ["CLAUDE.md"],
  commands: [],
  wrote: [],
  read: [],
  skills: [],
  agents: [],
  ...over,
});

/** Record `[turn, outcome]` pairs for KEY, each with note `n<turn>`. */
const history = (pairs: [number, TurnResult["outcome"]][], from: Ledger = empty): Ledger =>
  pairs.reduce((l, [turn, outcome]) => recordTurn(l, turn, [result(outcome, `n${String(turn)}`)]), from);

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
    const ledger = recordFacts(recordTurn(empty, 4, [result("broken", "No test run.")]), facts(4, { commands: ["npm test"] }));
    await writeLedger(path, ledger);
    expect(await readLedger(path)).toEqual(ledger);
    expect(await readdir(dirname(path))).toEqual(["l.ledger.json"]);
  });

  it("drops a malformed turn record and keeps the rest", async () => {
    const path = join(dir, "partial.json");
    await writeFile(path, JSON.stringify({ version: 1, turns: [facts(1), { turn: 2, inScope: true }], rules: {} }));
    expect((await readLedger(path)).turns).toEqual([facts(1)]);
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
    for (let turn = 0; turn < 12; turn++) ledger = recordTurn(ledger, turn, [result("needs-review", "x".repeat(300))]);
    const entries = ledger.rules[KEY]?.entries ?? [];
    expect(entries.map((e) => e.turn)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(entries[0]?.note).toHaveLength(200);
  });

  it("pins the first followed entry and every broken one through the trim", () => {
    const pairs: [number, TurnResult["outcome"]][] = [[0, "followed"], [1, "broken"]];
    for (let turn = 2; turn < 14; turn++) pairs.push([turn, turn === 6 ? "broken" : "followed"]);
    const turns = (history(pairs).rules[KEY]?.entries ?? []).map((e) => e.turn);
    expect(turns).toHaveLength(10);
    expect(turns).toEqual([0, 1, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("keeps the latest entry when every other one is pinned", () => {
    const pairs: [number, TurnResult["outcome"]][] = [];
    for (let turn = 0; turn < 12; turn++) pairs.push([turn, "broken"]);
    pairs.push([12, "needs-review"]);
    const turns = (history(pairs).rules[KEY]?.entries ?? []).map((e) => e.turn);
    expect(turns).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("starts an edited rule fresh", () => {
    const old = recordTurn(empty, 1, [result("broken")]);
    const edited = recordTurn(old, 5, [{ ...result("followed"), text: "Run the tests." }]);
    expect(edited.rules[KEY]?.entries).toEqual([{ turn: 5, outcome: "followed", note: "" }]);
  });

  it("keeps the turns' facts", () => {
    const ledger = recordTurn(recordFacts(empty, facts(1)), 1, [result("followed")]);
    expect(ledger.turns).toEqual([facts(1)]);
  });
});

describe("recordFacts", () => {
  it("replaces the same turn, as the repair pass does, and keeps the last 30, oldest first", () => {
    let ledger = recordFacts(empty, facts(3, { commands: ["npm test"] }));
    ledger = recordFacts(ledger, facts(3, { commands: ["npm ci", "npm test"] }));
    expect(ledger.turns).toEqual([facts(3, { commands: ["npm ci", "npm test"] })]);
    for (let turn = 40; turn > 4; turn--) ledger = recordFacts(ledger, facts(turn));
    expect(ledger.turns.map((t) => t.turn)).toEqual(Array.from({ length: 30 }, (_, i) => i + 11));
  });
});

describe("turnFacts", () => {
  const cwd = join(tmpdir(), "repo");
  const call = (name: string, input: Record<string, unknown>, index: number) => ({ name, input, index, sidechain: false });
  const window = {
    ...emptyWindow("turn", "last turn", ""),
    empty: false,
    toolCalls: [
      ...Array.from({ length: 12 }, (_, i) => call("Bash", { command: `npm run step${String(i)}` }, 10 + i)),
      call("Bash", { command: "npm ci" }, 30),
      call("Read", { file_path: "CLAUDE.md" }, 31),
    ],
    fileAccesses: [
      { path: "CLAUDE.md", op: "read" as const, index: 31 },
      { path: "AGENTS.md", op: "read" as const, index: 32 },
      { path: "src/a.ts", op: "edit" as const, index: 33 },
      { path: "src/a.ts", op: "write" as const, index: 34 },
      { path: "src/SECRET-abc.ts", op: "write" as const, index: 35 },
    ],
    skillInvocations: [{ name: "demo", via: "skill-tool" as const, index: 36 }],
  };
  const slice: TurnSlice = { window, from: 10, to: 40, sessionTurnCount: 2 };
  // Only what turnFacts reads of a trace.
  const trace = {
    agentSpawns: [
      { subagentType: "Explore", index: 37 },
      { subagentType: "Plan", index: 4 },
    ],
  } as unknown as Trace;
  const sources = [
    { path: join(cwd, "CLAUDE.md"), displayPath: "CLAUDE.md" },
    { path: join(cwd, "src", "AGENTS.md"), displayPath: "src/AGENTS.md" },
  ];
  const opts = { cwd, root: cwd, redact: ["SECRET-\\w+"] };

  it("records the turn's commands, writes, source reads, skills and agents, bounded", () => {
    const f = turnFacts(trace, slice, sources, opts);
    expect(f).toMatchObject({
      turn: 10,
      inScope: true,
      sources: ["CLAUDE.md", "src/AGENTS.md"],
      read: ["CLAUDE.md"],
      skills: ["demo"],
      agents: ["Explore"],
    });
    expect(f.commands).toHaveLength(10);
    expect(f.commands[0]).toBe("npm run step0");
    expect(f.wrote).toEqual(["src/a.ts", "src/[redacted].ts"]);
  });

  it("never counts a read for a source with no file, such as the typed prompts", () => {
    // A synthetic source's path is "", which resolves to the process's cwd.
    const atCwd = { ...slice, window: { ...window, fileAccesses: [{ path: process.cwd(), op: "read" as const, index: 31 }] } };
    const prompt = { path: "", displayPath: "prompt" };
    const f = turnFacts(trace, atCwd, [...sources, prompt], { ...opts, cwd: process.cwd() });
    expect(f.read).not.toContain("prompt");
    expect(f.sources).toContain("prompt");
  });

  it("clips and redacts each command, on one line", () => {
    const long = { ...slice, window: { ...window, toolCalls: [call("Bash", { command: `echo SECRET-xyz\n${"y".repeat(300)}` }, 11)] } };
    const [command] = turnFacts(trace, long, sources, opts).commands;
    expect(command).toHaveLength(COMMAND_CHARS);
    expect(command?.startsWith("echo [redacted] yyy")).toBe(true);
    expect(command?.endsWith("…")).toBe(true);
  });

  it("is out of scope, and empty, for a turn that stopped before its sources", () => {
    const none: TurnSlice = { window: emptyWindow("turn", "last turn", "nothing"), from: 12, to: 11, sessionTurnCount: 1 };
    expect(turnFacts(trace, none, [], opts)).toEqual(facts(12, { inScope: false, sources: [] }));
  });
});

describe("historyBlock", () => {
  const ledger = history([
    [1, "not-applicable"],
    [2, "followed"],
    [3, "broken"],
    [4, "needs-review"],
    [5, "followed"],
    [9, "broken"],
  ]);

  it("shows the first followed, every broken and the latest, oldest first", () => {
    expect(historyBlock(ledger, KEY, TEXT, 9)).toBe(
      "# This rule earlier in this session\n\n- turn 2: followed. n2\n- turn 3: broken. n3\n- turn 5: followed. n5",
    );
  });

  it("keeps the first followed through a long run, at most five lines", () => {
    const pairs: [number, TurnResult["outcome"]][] = [[0, "followed"]];
    for (let turn = 1; turn < 9; turn++) pairs.push([turn, turn % 2 === 0 ? "broken" : "needs-review"]);
    const lines = historyBlock(history(pairs), KEY, TEXT, 99).split("\n").slice(2);
    expect(lines).toEqual([
      "- turn 0: followed. n0",
      "- turn 2: broken. n2",
      "- turn 4: broken. n4",
      "- turn 6: broken. n6",
      "- turn 8: broken. n8",
    ]);
  });

  it("ignores the current turn and later ones", () => {
    expect(historyBlock(ledger, KEY, TEXT, 3)).toBe("# This rule earlier in this session\n\n- turn 2: followed. n2");
  });

  it("is empty with no history, only not-applicable history, or an edited rule", () => {
    expect(historyBlock(empty, KEY, TEXT, 9)).toBe("");
    expect(historyBlock(ledger, KEY, TEXT, 2)).toBe("");
    expect(historyBlock(ledger, KEY, "Run the tests.", 9)).toBe("");
    expect(historyBlock(ledger, "CLAUDE.md#other", TEXT, 9)).toBe("");
  });

  it("drops the note's separator when there is no note", () => {
    const bare = recordTurn(empty, 1, [result("broken")]);
    expect(historyBlock(bare, KEY, TEXT, 2)).toBe("# This rule earlier in this session\n\n- turn 1: broken.");
  });

  it("marks runs of recorded turns where the rule's source was not in scope", () => {
    let withGaps = history([[1, "followed"], [6, "broken"]]);
    for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
      withGaps = recordFacts(withGaps, facts(turn, (turn >= 2 && turn <= 4) || turn === 7 ? { sources: ["AGENTS.md"] } : {}));
    }
    expect(historyBlock(withGaps, KEY, TEXT, 9)).toBe(
      "# This rule earlier in this session\n\n" +
        "- turn 1: followed. n1\n" +
        "- (turns 2–4: not in scope)\n" +
        "- turn 6: broken. n6\n" +
        "- (turn 7: not in scope)",
    );
  });
});

describe("rollup", () => {
  it("is null when the ledger holds nothing", () => {
    expect(rollup(empty)).toBeNull();
  });

  it("counts each rule's outcomes, the repairs, and the turns its source was out of scope", () => {
    let ledger = history([
      [1, "followed"],
      [2, "broken"],
      [3, "needs-review"],
      [4, "followed"],
      [5, "not-applicable"],
      [6, "broken"],
    ]);
    ledger = recordTurn(ledger, 2, [{ key: "src/AGENTS.md#one-change", text: "One change.", outcome: "followed", note: "" }]);
    for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
      ledger = recordFacts(ledger, facts(turn, turn > 5 ? { sources: ["src/AGENTS.md"] } : {}));
    }
    expect(rollup(ledger)).toEqual({
      turns: 7,
      rules: [
        {
          source: "CLAUDE.md",
          rule: "run-tests",
          followed: 2,
          broken: 2,
          repaired: 1,
          needsReview: 1,
          notApplicable: 1,
          notInScope: 2,
          last: { turn: 6, outcome: "broken" },
        },
        {
          source: "src/AGENTS.md",
          rule: "one-change",
          followed: 1,
          broken: 0,
          repaired: 0,
          needsReview: 0,
          notApplicable: 0,
          notInScope: 5,
          last: { turn: 2, outcome: "followed" },
        },
      ],
    });
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
