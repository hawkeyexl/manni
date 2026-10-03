---
title: Rate limits
description: How many requests a client may send, and what a refusal looks like.
evals:
  - id: limits-stated
    assertion: The page states the request limit.
    examples: { pass: States 100 requests per minute., fail: Names no limit. }
  - id: description-matches
    assertion: The description names what the page covers.
    target: frontmatter
    examples: { pass: Mentions request limits., fail: Describes something else. }
---
Requests are limited to 100 per minute.
A refused request carries a Retry-After header.
