---
description: Write the release note for a change that has already landed.
argument-hint: "[version]"
allowed-tools: Read, Write
metadata:
  evals:
    # The window is the command's own span (ADR 01023): the session ran Bash
    # twice, both before /ship-it was invoked, so this passes. Unwindowed it
    # would be a false failure — the proof scoped grading needed.
    - id: no-shell-during-release
      assertion: Writing the release note runs no shell commands.
      grader: tool-usage
      options:
        tool: Bash
        expect: not-used
    - id: wrote-the-release-note
      assertion: The command writes the release note it promises.
      grader: tool-usage
      options:
        tool: Write
        expect: used
    - id: release-note-names-the-change
      assertion: The release note names what changed rather than restating the version.
      grader: ai
---

# Ship it

1. Read `CHANGELOG.md`.
2. Append one entry naming what actually changed.
3. Never run shell commands here; the release job does that.
