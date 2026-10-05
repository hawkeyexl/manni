// tracevals-1x1: stage the demo repository the video films.
//
// Input is real fixture material: every message in both traces is a line of
// `test/tracevals/fixtures/traces/claude-session.jsonl`, and the eval shapes
// are `test/tracevals/fixtures/project/CLAUDE.md`'s. What this script does is
// *subtract*: it drops the plugin skill, the subagents, the slash commands and
// the deliberately-malformed line that fixture carries to exercise the parser,
// because each of them prints a row the video's story has no use for. It then
// re-chains `parentUuid` so the trimmed transcript is still a single thread,
// and rewrites the recorded `cwd` to the staged directory so artifact lookup
// needs no `--project` flag on screen.
//
// Staging the input is allowed; faking the output is not
// (docs/content-strategy/design.md, "Honesty"). Nothing here touches what the
// command prints.
//
//   node media/capture-tracevals/make-demo.mjs <target-dir>
import { mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const target = resolve(process.argv[2] ?? join(repo, "media", "scratch-tracevals"));

const FIXTURE = join(
  repo,
  "test",
  "tracevals",
  "fixtures",
  "traces",
  "claude-session.jsonl",
);

const raw = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "");
const rows = raw.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null; // the fixture's deliberately-malformed line
  }
});

const byId = (id) => {
  const r = rows.find(
    (r) =>
      r?.message?.content?.some?.(
        (c) => c.type === "tool_use" && c.id === id,
      ),
  );
  if (!r) throw new Error(`no message carries tool_use ${id}`);
  return r;
};
const at = (i) => {
  if (!rows[i]) throw new Error(`fixture line ${i} is not a message`);
  return structuredClone(rows[i]);
};

/** Keep only the named tool_use blocks of a message, in the fixture's order. */
function onlyTools(row, ids) {
  row.message.content = row.message.content.filter(
    (c) => c.type !== "tool_use" || ids.includes(c.id),
  );
  return row;
}

const SESSION = "11111111-1111-1111-1111-111111111111";

/**
 * Re-chain a trimmed transcript. Claude Code writes one `parentUuid` thread,
 * and a message whose parent was dropped is an orphan the reader would have to
 * guess about. Timestamps are left exactly as the fixture recorded them.
 */
function thread(rows, cwd) {
  let parent = null;
  return rows.map((row) => {
    const out = { ...row };
    if ("parentUuid" in out) out.parentUuid = parent;
    if ("cwd" in out) out.cwd = cwd;
    if (out.uuid) parent = out.uuid;
    return JSON.stringify(out);
  });
}

/** The skill listing, with only the skill this demo is about. */
function listing() {
  const row = at(2);
  row.attachment.skillCount = 1;
  row.attachment.names = ["fix-bug"];
  row.attachment.content =
    "- fix-bug: Fix a reported bug, reproducing it with a failing test first.";
  return row;
}

function traces(cwd) {
  const win = cwd.replace(/\//g, "\\");
  const head = [at(0), at(1), listing(), at(7)];
  // toolu_004 Read src/app.ts, toolu_006 Edit src/app.ts. The fixture pairs
  // each with a second tool the story does not need (a `npm test` Bash and a
  // `notes.md` Write); both are dropped so the report has one thing to say.
  const read = onlyTools(byId("toolu_004"), ["toolu_004"]);
  const edit = onlyTools(byId("toolu_006"), ["toolu_006"]);
  const invoke = at(9); // tool_use Skill { skill: fix-bug }
  const loaded = at(10); // its tool_result
  const done = at(23);

  return {
    // Edited src/app.ts, never invoked the skill the rules name.
    "session-1.jsonl": thread(
      [...head, read, edit, done].map((r) => structuredClone(r)),
      win,
    ),
    // Same work, through the skill.
    "session-2.jsonl": thread(
      [...head, invoke, loaded, read, edit, done].map((r) =>
        structuredClone(r),
      ),
      win,
    ),
  };
}

// Flow-style `options:` on purpose. Block style is four more rows per eval,
// and the whole file has to fit one 1080px frame at a phone-legible size
// (design.md, "Capture geometry"). The keys are the same either way.
const CLAUDE_MD = `---
metadata:
  evals:
    - id: read-before-edit
      assertion: The session read a source file before editing one.
      grader: tool-usage
      options: { tool: Read, expect: used }
    - id: source-edits-use-the-skill
      assertion: A session that edits source files invokes the fix-bug skill.
      grader: skill-invoked
      options: { skill: fix-bug, expect: used, when: { file-access: "src/**" } }
---

# House rules

- Read a file before you edit it.
- Source edits go through the fix-bug skill.
`;

// test/tracevals/fixtures/project/.claude/skills/fix-bug/SKILL.md, prose only:
// this demo's evals live in CLAUDE.md, so the skill declares none of its own.
const SKILL_MD = `---
name: fix-bug
description: Fix a reported bug, reproducing it with a failing test first.
---

# Fix Bug

1. Reproduce the bug with a failing test.
2. Apply the minimal fix.
3. Re-run the test to confirm it passes.
`;

mkdirSync(join(target, ".claude", "skills", "fix-bug"), { recursive: true });
const write = (rel, body) => {
  const p = join(target, rel);
  writeFileSync(p, body);
  // Before the session ended (2026-06-29T22:25Z), or every run carries a
  // "modified after the session ended" warning about instructions that in the
  // story predate the session.
  const t = new Date("2026-06-20T09:00:00Z");
  utimesSync(p, t, t);
  return p;
};

write("CLAUDE.md", CLAUDE_MD);
write(join(".claude", "skills", "fix-bug", "SKILL.md"), SKILL_MD);
for (const [name, lines] of Object.entries(traces(target))) {
  write(name, lines.join("\n") + "\n");
}

console.log(`staged ${target}`);
