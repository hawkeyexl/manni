---
title: Two readers
personas: [Theo, maya, theo]
evals:
  - id: finish-task
    assertion: A reader can fix the failing field from this page alone.
    grader: ai
    options:
      readers: personas
---

# Two readers

Fix the field the error names, then run `manni meta validate` on the file.
