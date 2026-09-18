---
title: Limits
citations:
  - id: retries-block
    quote: true
    claim:
      integrity: sha256-8bc6281f6b2217a4a8dab525bec1d3a6be8ac00eee3e15aef8099c6def6b4a32
    source:
      file: src/limits.ts
      lines: 3
      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
---
# Limits

Retries are configured once.
<!-- cite retries-block -->
The value lives in the source.

```ts
export const RETRIES = 3;
```
