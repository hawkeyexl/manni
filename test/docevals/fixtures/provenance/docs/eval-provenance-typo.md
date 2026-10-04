---
title: Rate limits
eval-provenance:
  - generated-by: claude-fable-5
    evals: [limits-stated]
evals:
  - id: limits-stated
    assertion: The page states the request limit.
    examples: { pass: States 100 requests per minute., fail: Names no limit. }
---
Requests are limited to 100 per minute.
