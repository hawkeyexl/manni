---
title: Limits
description: The request timeout and the retry count, pinned to two code checkouts.
citations:
  - id: timeout
    claim:
      lines: 3
      integrity: sha256-8c00bfdfc50fe899e5a0dda616a7961e4c925c909129582ac1000b4eaf33d44b
    source:
      repo: api
      file: lib/limits.ts
      lines: 2
      integrity: sha256-4ba04f0f883521a7e20ab550e78258e3fc1b40e52f3278b885d992c6b864bd5d
  - id: retries
    claim:
      lines: 5
      integrity: sha256-c315c7eabc99ccdde43c763146f93b4a3b25ae7d0b08d5f5be67c918ca446a03
    source:
      repo: sdk
      file: src/client.ts
      lines: 2
      integrity: sha256-4bcf2ce6f6f0c00258d3ee02a4e5f3a104f732fb9839b38e5ebb7a95b6af5e68
---
# Limits

A request times out after 30 seconds.

The client retries a failed request three times.
