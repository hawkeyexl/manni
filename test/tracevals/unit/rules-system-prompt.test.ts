/**
 * The system prompt the session ran under, and a user output style, as rule
 * sources (proposal 0081). Both are read from the transcript's attachments.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveTurnSources,
  type RuleSource,
  type SourceOptions,
} from "../../../src/tracevals/rules/sources.js";
import { lastTurn } from "../../../src/tracevals/rules/turn.js";
import { session, type SessionStep } from "./rules-session.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "conformance", "styles");
const ROOT = join(FIX, "project");
const HOME = join(FIX, "home");
const ENV = { CLAUDE_CONFIG_DIR: join(HOME, ".claude"), HOME, USERPROFILE: HOME };
const MARKER = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

const opts = (over: Partial<SourceOptions> = {}): SourceOptions => ({
  projectDir: ROOT,
  projectRoot: ROOT,
  env: ENV,
  ...over,
});

const snapshot = (blocks: string[], version = "2.1.292"): SessionStep => ({
  attachment: {
    type: "prompt_snapshot",
    systemPrompt: blocks,
    reminderFold: true,
    echoWireToolInputs: false,
    contextRendering: "default",
  },
  version,
});

/** Claude Code writes the snapshot twice; the second also carries the tools. */
const pair = (blocks: string[], version?: string): SessionStep[] => {
  const first = snapshot(blocks, version);
  if (!("attachment" in first)) return [first];
  return [first, { ...first, attachment: { ...first.attachment, tools: [], cliPrefix: "cli" } }];
};

const style = (name: string, prompt: string): SessionStep => ({
  attachment: { type: "output_style_instructions", style: { name, prompt } },
});

const DEFAULT = ["You are a synthetic agent.", MARKER, "- Keep replies short."];

async function sourcesOf(steps: SessionStep[], over: Partial<SourceOptions> = {}, to?: number) {
  const trace = session(steps, ROOT);
  const turn = lastTurn(trace);
  const { sources } = await resolveTurnSources(trace, to === undefined ? turn : { from: 0, to }, opts(over));
  return sources;
}

const byPath = (sources: RuleSource[]) => new Map(sources.map((s) => [s.displayPath, s]));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("the system prompt", () => {
  it("is a source that never blocks when it carries the boundary marker", async () => {
    const sources = await sourcesOf([...pair(DEFAULT), { prompt: "Add a test." }, { say: "Done." }]);
    const content = DEFAULT.join("\n\n");
    expect(byPath(sources).get("system-prompt")).toEqual({
      path: "",
      displayPath: "system-prompt",
      format: "system-prompt",
      trigger: "recorded at turn 1, Claude Code 2.1.292",
      content,
      sha256: sha(content),
      blocks: false,
    });
  });

  it("is custom, and blocks, when the marker is missing", async () => {
    const replaced = ["- Never edit files.", "Web search is available."];
    const sources = await sourcesOf([...pair(replaced), { prompt: "Review it." }, { say: "Done." }]);
    const source = byPath(sources).get("system-prompt");
    expect(source?.trigger).toBe("recorded at turn 1, Claude Code 2.1.292, custom");
    expect(source?.content).toBe(replaced.join("\n\n"));
    expect(source?.blocks).toBe(true);
  });

  it("is the last snapshot at or before the turn's end", async () => {
    const later = ["Resumed on a newer version.", MARKER];
    const after = ["After the turn.", MARKER];
    const steps: SessionStep[] = [
      ...pair(DEFAULT, "2.1.290"),
      { prompt: "Add a test." },
      { say: "Done." },
      ...pair(later, "2.1.292"),
      { prompt: "Now the docs." },
      { say: "Done." },
      ...pair(after, "2.1.293"),
    ];
    // Records 0-1, 2-3, then the second pair at 4-5 and two more at 6-7.
    const source = byPath(await sourcesOf(steps, {}, 7)).get("system-prompt");
    expect(source?.content).toBe(later.join("\n\n"));
    expect(source?.trigger).toBe("recorded at turn 5, Claude Code 2.1.292");
  });

  it("is absent when the transcript records no snapshot", async () => {
    const sources = await sourcesOf([{ prompt: "Add a test." }, { say: "Done." }]);
    expect(sources.map((s) => s.format)).not.toContain("system-prompt");
  });

  it("is redacted with judge.redact before it is hashed", async () => {
    const memory = ["Intro.", MARKER, "Contents of /home/maya/.claude/CLAUDE.md:\n- Run `npm ci` first."];
    const sources = await sourcesOf([...pair(memory), { prompt: "Go." }, { say: "Done." }], {
      redact: ["/home/maya"],
    });
    const source = byPath(sources).get("system-prompt");
    expect(source?.content).not.toContain("/home/maya");
    expect(source?.content).toContain("Contents of [redacted]/.claude/CLAUDE.md");
    expect(source?.sha256).toBe(sha(source?.content ?? ""));
  });
});

describe("the output style", () => {
  it("a style a project file defines is its own source, holding what the agent saw", async () => {
    const seen = "- Cite a file and line for every claim.";
    const sources = await sourcesOf([...pair(DEFAULT), style("cite-lines", seen), { prompt: "Go." }, { say: "Done." }]);
    const source = byPath(sources).get(".claude/output-styles/cite.md");
    expect(source).toMatchObject({
      path: join(ROOT, ".claude", "output-styles", "cite.md"),
      format: "output-style",
      trigger: "style cite-lines",
      content: seen,
      blocks: true,
    });
    expect(byPath(sources).get("system-prompt")?.content).toBe(DEFAULT.join("\n\n"));
  });

  it("a user file is found by its base name when it names no style", async () => {
    const sources = await sourcesOf([...pair(DEFAULT), style("terse", "- Keep it short."), { prompt: "Go." }]);
    expect(byPath(sources).get("~/.claude/output-styles/terse.md")?.format).toBe("output-style");
  });

  it("a built-in style joins the system prompt, as default", async () => {
    const text = "- Explain each choice as you go.";
    const sources = await sourcesOf([...pair(DEFAULT), style("Explanatory", text), { prompt: "Go." }]);
    expect(sources.map((s) => s.format)).not.toContain("output-style");
    const source = byPath(sources).get("system-prompt");
    expect(source?.content).toBe(`${DEFAULT.join("\n\n")}\n\n${text}`);
    expect(source?.blocks).toBe(false);
  });

  it("is dropped by exclude, by its file path", async () => {
    const sources = await sourcesOf(
      [...pair(DEFAULT), style("cite-lines", "- Cite."), { prompt: "Go." }],
      { exclude: [".claude/output-styles/*.md"] },
    );
    expect(sources.map((s) => s.format)).not.toContain("output-style");
  });
});

describe("exclude by name", () => {
  const steps: SessionStep[] = [
    ...pair(DEFAULT),
    { prompt: "Plan it." },
    { tool: "ExitPlanMode", input: { plan: "- Add a test." }, result: "approved" },
    { say: "Done." },
  ];

  it("keeps all three when nothing is excluded", async () => {
    const formats = (await sourcesOf(steps)).map((s) => s.displayPath);
    expect(formats).toEqual(expect.arrayContaining(["system-prompt", "prompt", "plan"]));
  });

  it.each(["system-prompt", "prompt", "plan"])("drops %s", async (name) => {
    const left = (await sourcesOf(steps, { exclude: [name] })).map((s) => s.displayPath);
    expect(left).not.toContain(name);
    expect(left.length).toBeGreaterThan(0);
  });
});
