---
name: publish
description: Publishes a docs page.
---
# Publish a page

1. Spawn the `auditor` agent on the draft.
2. Only after the auditor reports no issues, spawn the `proofer` agent.
3. Run `npm run publish:docs` last.
