import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordFacts, type Ledger } from "../../../src/tracevals/rules/ledger.js";
import { timelineBlock } from "../../../src/tracevals/rules/timeline.js";
import { isTypedPrompt } from "../../../src/tracevals/rules/turn.js";
import type { Trace } from "../../../src/tracevals/trace/types.js";
import { session, type SessionStep } from "./rules-session.js";

const cwd = join(tmpdir(), "demo");
const at = (...parts: string[]): string => join(cwd, ...parts);
const opts = { cwd, root: cwd, redact: ["SECRET-\\w+"], sources: [{ path: at("CLAUDE.md"), displayPath: "CLAUDE.md" }] };
const HEAD = "# Earlier in this session\n\n";

/** Ordinals of the typed prompts, which is where each turn starts. */
const starts = (trace: Trace): number[] =>
  trace.events.filter((e) => e.sidechain !== true && isTypedPrompt(e)).map((e) => e.index);

/** The block for every turn before the last. */
function earlier(steps: SessionStep[], over: Partial<Parameters<typeof timelineBlock>[2]> = {}): string {
  const trace = session(steps, cwd);
  return timelineBlock(trace, starts(trace).at(-1) ?? 0, { ...opts, ...over });
}

const lines = (block: string): string[] => block.split("\n").slice(2);

describe("the earlier-turns timeline", () => {
  it("names each kind of fact a turn records, one line per turn, newest last", () => {
    const steps: SessionStep[] = [
      { prompt: "Set up." },
      { tool: "Bash", input: { command: "npm ci" }, result: "ok" },
      { tool: "Write", input: { file_path: at("src", "a.ts"), content: "x" }, result: "ok" },
      { tool: "Read", input: { file_path: at("CLAUDE.md") }, result: "rules" },
      { tool: "Read", input: { file_path: at("src", "b.ts") }, result: "code" },
      { tool: "Skill", input: { skill: "demo" }, result: "loaded" },
      { tool: "Agent", input: { subagent_type: "Explore", prompt: "look" }, result: '{"status":"done"}\nmore' },
      { tool: "Agent", input: { subagent_type: "Plan", prompt: "plan" } },
      { tool: "AskUserQuestion", input: { questions: [] }, result: "answered" },
      { prompt: "Do the tasks." },
      {
        tool: "Edit",
        input: {
          file_path: at("specs", "001", "tasks.md"),
          old_string: "- [ ] T014 Add login\n- [ ] Write the docs\n- [ ] Ship it",
          new_string: "- [x] T014 Add login\n- [X] Write the docs\n- [ ] Ship it",
        },
        result: "ok",
      },
      { tool: "ExitPlanMode", input: { plan: "p" }, result: "approved" },
      { prompt: "Plan again." },
      { tool: "ExitPlanMode", input: { plan: "q" }, result: "The user doesn't want to proceed", error: true },
      { prompt: "Now." },
      { tool: "Bash", input: { command: "npm run now" }, result: "ok" },
    ];
    const trace = session(steps, cwd);
    const [a, b] = starts(trace);
    expect(earlier(steps)).toBe(
      HEAD +
        `- turn ${String(a)}: ran npm ci; wrote src/a.ts; read CLAUDE.md; ran skill demo; ` +
        `spawned Explore, which returned {"status":"done"}; spawned Plan; asked the user\n` +
        `- turn ${String(b)}: wrote specs/001/tasks.md; ticked T014 in specs/001/tasks.md; ` +
        "ticked Write the docs in specs/001/tasks.md; had a plan approved",
    );
  });

  it("ticks a MultiEdit's edits, and reads the leading id of each kind", () => {
    const block = earlier([
      { prompt: "Go." },
      {
        tool: "MultiEdit",
        input: {
          file_path: at("tasks.md"),
          edits: [
            { old_string: "- [ ] 1.2 Create the form", new_string: "- [x] 1.2 Create the form" },
            { old_string: "  - [ ] FR-001: Log in", new_string: "  - [x] FR-001: Log in" },
            { old_string: `- [ ] ${"long ".repeat(20)}`, new_string: `- [x] ${"long ".repeat(20)}` },
          ],
        },
        result: "ok",
      },
      { prompt: "Now." },
    ]);
    const ticks = (lines(block)[0] ?? "").replace(/^- turn \d+: /, "").split("; ");
    expect(ticks.slice(0, 2)).toEqual(["ticked 1.2 in tasks.md", "ticked FR-001 in tasks.md"]);
    const text = /ticked (.+) in tasks\.md/.exec(ticks[2] ?? "")?.[1] ?? "";
    expect(text).toHaveLength(60);
    expect(text.endsWith("…")).toBe(true);
  });

  it("does not tick an edit that leaves the box empty or changes the text", () => {
    expect(
      earlier([
        { prompt: "Go." },
        { tool: "Edit", input: { file_path: at("t.md"), old_string: "- [ ] A", new_string: "- [x] B" }, result: "ok" },
        { prompt: "Now." },
      ]),
    ).not.toContain("ticked");
  });

  it("leaves out a rejected plan and a turn with no facts", () => {
    expect(
      earlier([
        { prompt: "Plan." },
        { tool: "ExitPlanMode", input: { plan: "q" }, result: "no", error: true },
        { say: "Fine." },
        { prompt: "Now." },
      ]),
    ).toBe("");
  });

  it("redacts a token in a command and in an agent's result, then clips each to 120 characters", () => {
    const block = earlier([
      { prompt: "Go." },
      { tool: "Bash", input: { command: "curl -H SECRET-abc https://x" }, result: "ok" },
      { tool: "Agent", input: { subagent_type: "Explore", prompt: "p" }, result: `token SECRET-xyz ${"y".repeat(300)}` },
      { prompt: "Now." },
    ]);
    expect(block).not.toContain("SECRET-");
    expect(block).toContain("ran curl -H [redacted] https://x");
    const result = /which returned (.+)$/.exec(lines(block)[0] ?? "")?.[1] ?? "";
    expect(result).toHaveLength(120);
    expect(result.startsWith("token [redacted] yyy")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
  });

  it("marks a turn the ledger recorded with no rules in scope", () => {
    const steps: SessionStep[] = [
      { prompt: "One." },
      { tool: "Bash", input: { command: "ls" }, result: "ok" },
      { prompt: "Two." },
      { tool: "Bash", input: { command: "pwd" }, result: "ok" },
      { prompt: "Now." },
    ];
    const [a, b] = starts(session(steps, cwd));
    const base = { inScope: true, sources: ["CLAUDE.md"], commands: [], wrote: [], read: [], skills: [], agents: [] };
    let ledger: Ledger = { version: 1, turns: [], rules: {} };
    ledger = recordFacts(ledger, { ...base, turn: a ?? 0, inScope: false, sources: [] });
    ledger = recordFacts(ledger, { ...base, turn: b ?? 0 });
    expect(lines(earlier(steps, { ledger }))).toEqual([
      `- turn ${String(a)}: ran ls (no rules in scope)`,
      `- turn ${String(b)}: ran pwd`,
    ]);
  });

  it("drops the oldest lines to fit, and says which turns went first", () => {
    const steps: SessionStep[] = [];
    for (let t = 0; t < 30; t++) {
      steps.push({ prompt: `Turn ${String(t)}.` }, { tool: "Bash", input: { command: `echo ${String(t)}` }, result: "ok" });
    }
    steps.push({ prompt: "Now." });
    const all = starts(session(steps, cwd)).slice(0, -1);
    const full = lines(earlier(steps));
    expect(full).toHaveLength(all.length);

    const cut = earlier(steps, { maxChars: 200 });
    expect(cut.length).toBeLessThanOrEqual(200);
    const [marker, ...kept] = lines(cut);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.at(-1)).toBe(full.at(-1));
    const left = full.length - kept.length;
    const firstKept = all[left];
    expect(kept[0]).toBe(`- turn ${String(firstKept)}: ran echo ${String(left)}`);
    expect(marker).toBe(`- (turns ${String(all[0])}–${String(all[left - 1])}: ${String(left)} lines left out)`);
  });

  it("is empty when nothing came before, as under a subagent's own run", () => {
    const trace = session([{ prompt: "Go." }, { tool: "Bash", input: { command: "ls" }, result: "ok" }], cwd);
    expect(timelineBlock(trace, 0, opts)).toBe("");
  });
});
