---
name: release-notes
description: Drafts release notes from merged pull requests.
metadata:
  evals:
    - The session reads the changelog before drafting.
    - id: judged-tone
      assertion: The notes use the house voice.
      provider: openai
      model: gpt-4o-mini
    - id: used-git-log
      grader: tool-usage
      assertion: The session runs git log.
    - id: lint-clean
      grader: tool:vale
      assertion: The notes pass the style check.
    - id: notes-parse
      assertion: The notes file parses as Markdown.
      grader: command
      command: [node, check.js, "{trace}"]
      success-exit-codes: [0, 3]
      timeout-ms: 5000
      generated-assertion-hash: sha256-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0
      target:
        source: file
        path: out/NOTES.md
---

Read the changelog, then draft the notes.
