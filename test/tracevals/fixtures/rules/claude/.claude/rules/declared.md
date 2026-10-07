---
metadata:
  evals:
    - "The agent ran npm ci before npm test."
    - id: no-force-push
      grader: ai
      assertion: The agent never force-pushed.
      options:
        when:
          command-matches: '\bgit push\b'
    - id: read-claude
      grader: file-access
      options:
        path: CLAUDE.md
---
Rules with their own evals.
