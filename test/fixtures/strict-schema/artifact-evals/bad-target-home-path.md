---
metadata:
  evals:
    - id: notes-parse
      assertion: The notes file parses.
      target:
        source: file
        path: ~/NOTES.md
# expect: /metadata/evals/0/target/path
---

A shell expands a leading tilde to the home directory, so it is not relative.
