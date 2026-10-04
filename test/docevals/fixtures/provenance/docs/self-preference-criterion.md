---
title: Rate limits
meta-provenance:
  - generated-by: claude-fable-5
    evals: [limits-stated]
    confidence:
      limits-stated: 0.8
evals:
  - id: limits-stated
    assertion: The page states the request limit.
    examples: { pass: States 100 requests per minute., fail: Names no limit. }
---
Requests are limited to 100 per minute.
A refused request carries a Retry-After header.
