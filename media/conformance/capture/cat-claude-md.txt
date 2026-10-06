---
metadata:
  evals:
    - id: run-npm-ci-first
      grader: ai
      assertion: Run `npm ci` before `npm test` in a fresh worktree.
      options:
        when:
          command-matches: '\bnpm (test|run)\b'
    - id: no-force-push
      grader: ai
      assertion: Never run `git push --force`.
      options:
        when:
          command-matches: '\bgit push\b'
---
# Conformance demo

This project declares its own rules, so they are never extracted.
