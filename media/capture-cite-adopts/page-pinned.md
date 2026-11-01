---
title: Retry spec
citations:
  - id: retry-default
    claim:
      integrity: sha256-615b564b23c2318e86241a652d1c2466d2efc16db9f15b798a236cd08d33a80e
    source:
      file: lib/limits.ts
      lines: 2
      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
      commit-sha: bd41a58a927db115f6c03f31210938f7c4af0a3f
  - id: retry-default-test
    claim:
      integrity: sha256-615b564b23c2318e86241a652d1c2466d2efc16db9f15b798a236cd08d33a80e
    source:
      file: lib/limits.test.ts
      lines: 1
      integrity: sha256-2bc2ac2fefd7a390f0fe53da936b408d5af8b797d10e6e8c58a871e3d8d89cb1
      commit-sha: bd41a58a927db115f6c03f31210938f7c4af0a3f
---
# Retry spec

<!-- cite retry-default retry-default-test -->
Failed requests retry 3 times by default.
