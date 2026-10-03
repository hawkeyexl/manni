---
title: Rate limits
description: How many requests a client may send.
meta-provenance:
  - generated-by: claude-sonnet-5
    evals: [limits-stated]
  - generated-by: mock-model
    fields: [/description]
    evals: [retry-named]
    confidence:
      /description: 0.9
      retry-named: 0.75
evals:
  - id: limits-stated
    assertion: The page states the request limit.
    examples: { pass: States 100 requests per minute., fail: Names no limit. }
  - id: retry-named
    assertion: The page names the header a refused client reads.
    examples: { pass: Names Retry-After., fail: Names no header. }
---
Requests are limited to 100 per minute.
A refused request carries a Retry-After header.
