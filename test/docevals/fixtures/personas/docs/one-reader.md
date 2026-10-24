---
title: One reader
personas:
  - theo
evals:
  - id: finish-task
    assertion: A reader can fix the failing field from this page alone.
    grader: ai
    options:
      readers: personas
  - id: plain-judge
    assertion: The page names the command that reruns the check.
    grader: ai
  - id: no-todo-markers
    assertion: The page carries no TODO markers.
    grader: tool:regex
    options:
      pattern: "\\bTODO\\b"
      match: not-contains
---

# One reader

Fix the field the error names, then run `manni meta validate` on the file.
