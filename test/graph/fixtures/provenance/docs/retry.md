---
title: Retry an upload
description: How many times an upload retries, and how long it waits.
last-updated: 2026-01-01
last-verified: 2026-10-20
verified-by:
  - tool: doc-detective
    check: retry-limits
    passed: 2026-10-20
citations:
  - id: retry-default
    claim:
      lines: 6
      integrity: sha256-7a2fe4c143e98d69afb54ba61decca51f615864cbb240bc9cf719c76eabc0657
    source:
      file: src/upload.ts
      lines: 1
      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
      commit-sha: COMMIT
    last-verified: 2026-10-19
    verified-by:
      - tool: lychee
        passed: 2026-10-19
  - id: retry-backoff
    claim:
      lines: 8
      integrity: sha256-5ea6b0df0443806b10e83091fca418ba9406a1bdee6687f1f68a2afcdf3a7785
    source:
      file: src/upload.ts
      lines: 2
      integrity: sha256-e75c5cff4f4dffd8a2c86c7de8a70112c1e96507719df00cd7d1d28c72f3ff71
      commit-sha: COMMIT
sample-questions:
  - question: How many times does an upload retry?
    answers:
      - lines: 6
        integrity: sha256-7a2fe4c143e98d69afb54ba61decca51f615864cbb240bc9cf719c76eabc0657
---

# Retry an upload

## Retry limits

Uploads retry three times.

The backoff is half a second.

<!-- meta {"last-verified":"2026-10-18"} -->
A verified sentence.

<!-- meta {"applies-to":["windows"]} -->
## Backoff

Backoff doubles each time.
