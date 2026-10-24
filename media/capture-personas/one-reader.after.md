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

Each error names its schema, then the field and what it needs:
`/title is required (schema: house)`. Add that field to the
page's frontmatter, then run `manni meta validate`.
