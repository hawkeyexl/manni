---
evals:
  - id: config-valid
    assertion: The config parses.
    target:
      source: file
      path: ~/app/config.yaml
# expect: /evals/0/target/path
---

A shell expands a leading tilde to the home directory, so it is not relative.
