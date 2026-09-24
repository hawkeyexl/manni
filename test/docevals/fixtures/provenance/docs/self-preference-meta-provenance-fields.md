---
title: Rate limits
description: How many requests a client may send, and what a refusal looks like.
meta-provenance:
  - generated-by: claude-fable-5
    fields: [/description]
    confidence:
      /description: 0.9
evals:
  - id: description-matches
    assertion: The description names what the page covers.
    target: frontmatter
    examples: { pass: Mentions request limits., fail: Describes something else. }
---
Requests are limited to 100 per minute.
A refused request carries a Retry-After header.
