---
name: fix-bug
description: Fix a reported bug, reproducing it with a failing test first.
---

# Fix Bug

When fixing a bug:

1. Reproduce the bug with a failing test and confirm it fails for the expected reason.
2. Apply the minimal fix.
3. Re-run the test to confirm it passes.
4. Never leave debugging artifacts in the code.
