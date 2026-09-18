---
title: Limits
citations:
  - id: retries-row
    claim:
      lines: 5
      integrity: sha256-1bcbc12893dcbf81db0c2fdf88fc00739a5cc2ce359fceb5aade59a10e56e845
    source:
      file: src/limits.ts
      lines: 3
      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
---
# Limits

| Flag | Default | What it does |
|---|---|---|
| `--retries` | 5 | How many times a request is retried. |
| `--timeout` | 10 | Seconds a request waits before it is given up. |
| `--max-files` | 10000 | Files one run reads at most. |
