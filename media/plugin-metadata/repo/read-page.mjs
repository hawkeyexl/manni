// What Claude Code does on a Read: hand the PostToolUse envelope to the plugin's
// page-metadata hook, then show the context the hook returns. The hook is the
// real plugin script; only the envelope is staged.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const hook = process.env.MANNI_PAGE_HOOK;
const envelope = {
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  session_id: process.env.DEMO_SESSION ?? "demo-session",
  tool_input: { file_path: resolve(process.argv[2] ?? "") },
  cwd: process.cwd(),
};
const run = spawnSync(process.execPath, [hook], {
  input: JSON.stringify(envelope),
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
});
if (run.stdout.trim() !== "") {
  const reply = JSON.parse(run.stdout);
  process.stdout.write(`${reply.hookSpecificOutput.additionalContext}\n`);
}
