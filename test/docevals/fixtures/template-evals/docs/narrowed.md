---
title: Lint a page
type: how-to
evals:
  - use: shows-the-command
    skip: true
  - id: tgdp-overview-names-the-task
    assertion: The page opens by naming its task.
    grader: tool:regex
    options:
      pattern: "This guide"
      match: contains
---

# Lint a page

This guide lints one page.
