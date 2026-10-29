---
name: fresh
description: Write or update a documentation page.
metadata:
  evals:
    - id: read-the-page
      assertion: The session read the page before editing it.
      grader: tool-usage
      options:
        tool: Read
        expect: used
---

# Fresh

Read the page before editing it.
