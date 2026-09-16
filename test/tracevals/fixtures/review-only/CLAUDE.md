---
metadata:
  evals:
    - id: queued-for-a-human
      assertion: A person confirmed the session's approach was sound.
      grader: human
---

# Review-only project rules

A deliberately minimal corpus: its single eval is `human`, so a deterministic
run produces exactly one `needs-review` and nothing else. That makes
`failOnNeedsReview` the only thing deciding the exit code, which is what the
flag test needs — the main fixture always exits 1 on its engineered
deterministic failure and would mask the flag entirely.
