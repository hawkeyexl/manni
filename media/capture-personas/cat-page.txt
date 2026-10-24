---
title: One reader
personas:
  - theo
evals:
  - id: names-schema
    assertion: The page names the schema that fired.
    grader: ai
    options:
      readers: personas
  - id: plain-judge
    assertion: The page names the command that reruns the check.
    grader: ai
---

# One reader

Fix the field, then run `manni meta validate`.
