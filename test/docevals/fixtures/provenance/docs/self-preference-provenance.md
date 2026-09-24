---
title: Rate limits
provenance:
  - generated-by: claude-fable-5
    lines: 1-2
    integrity: sha256-10da811a04e33fe95f73331ef9cfdf4e54b052e3197fb9005562bd0e29bc799d
evals:
  - id: limits-stated
    assertion: The page states the request limit.
    examples: { pass: States 100 requests per minute., fail: Names no limit. }
---
Requests are limited to 100 per minute.
A refused request carries a Retry-After header.
