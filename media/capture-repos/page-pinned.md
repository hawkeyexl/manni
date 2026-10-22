---
title: Limits
description: The request timeout and the retry count.
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
      commit-sha: b0daa71bc04122bf9550dca3b1ee24a0ffcc3c66
  - id: retries
    claim:
      lines: 5
      integrity: sha256-b4b4aac2de6df22dba4777361b6c422a6073d389b2590aba508488bcb9823d4c
    source:
      repo: sdk
      file: src/client.ts
      lines: 2
      integrity: sha256-4bcf2ce6f6f0c00258d3ee02a4e5f3a104f732fb9839b38e5ebb7a95b6af5e68
      commit-sha: ce9ce7673d97af461a65b2185fa002a2d11e52f7
---
# Limits

A request times out after 30 seconds.

The SDK retries a failed request three times.
