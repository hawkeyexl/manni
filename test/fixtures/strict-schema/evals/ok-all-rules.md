---
eval-suite: smoke-tests
evals:
  - The page names the operator's minimum Kubernetes version.
  - use: link-check
    severity: warning
  - id: judge-install
    assertion: The install steps run in the order shown.
    provider: anthropic
    model: claude-sonnet-4-5
  - id: local-judge
    assertion: Every command block has a caption.
    provider: llama-cpp
    model: qwen3.5-4b
  - id: sample-runs
    assertion: The sample exits cleanly.
    grader: command
    command: [python, examples/app.py]
    success-exit-codes: [0, 1, 255]
    timeout-ms: 30000
    generated-assertion-hash: sha256-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0
    target:
      source: file
      path: ../examples/app.py
---

Install the operator on Kubernetes 1.29 or later.
