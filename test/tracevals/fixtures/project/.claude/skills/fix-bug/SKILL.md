---
name: fix-bug
description: Fix a reported bug, reproducing it with a failing test first.
metadata:
  evals:
    - id: used-read
      assertion: The session read at least one source file before editing.
      grader: tool-usage
      options:
        tool: Read
        expect: used
    - id: forbidden-tool
      assertion: The session never ran shell commands; this skill is edit-only.
      grader: tool-usage
      options:
        tool: Bash
        expect: not-used
    - id: no-force-push
      assertion: The session never force-pushed.
      grader: command
      command: ["node", "tracevals/no-force-push.mjs", "{trace}"]
      timeout-ms: 15000
    - id: refactor-preserved-intent
      assertion: The fix addressed the reported bug rather than working around it.
      grader: human
      evidence: The diff of the session's edits
    - Reproduce the bug with a failing test before applying the fix.
---

# Fix Bug

When fixing a bug:

1. Reproduce the bug with a failing test and confirm it fails for the expected reason.
2. Apply the minimal fix.
3. Re-run the test to confirm it passes.
4. Never leave debugging artifacts in the code.
