---
title: Retry an upload
description: How many times an upload retries.
created: 2024-01-02
authors: [Ada Lovelace]
supersedes: old.md
audiences: [readers]
personas: [pat]
journeys: [j1]
graph:
  label: Retries
provenance:
  - generated-by: model-x
    lines: "8"
    integrity: sha256-5ea6b0df0443806b10e83091fca418ba9406a1bdee6687f1f68a2afcdf3a7785
meta-provenance:
  - generated-by: model-y
    fields: [/graph/label]
review:
  status: done
  notes: Ask Pat before the next release.
internal: Not for any graph.
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
---

# Retry an upload

## Retry limits

Uploads retry three times.

<!-- meta {"created":"2024-02-03","applies-to":["cli"]} -->
Backoff doubles each time.

Pat is [the persona](../strategy/pat.md) this page serves.
