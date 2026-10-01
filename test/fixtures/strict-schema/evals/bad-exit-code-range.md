---
evals:
  - id: sample-runs
    grader: command
    command: [python, app.py]
    success-exit-codes: [0, 256]
# expect: /evals/0/success-exit-codes/1
---

Run the sample.
