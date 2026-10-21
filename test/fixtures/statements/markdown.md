---
title: Statements in Markdown
description: Every meta statement case, in Markdown.
---

# Statements in Markdown

<!-- meta sha256-3e793febee24429f9d75a01c322c6932360ce4055ee52754ae6a5701832d9517 {"last-verified":"2026-10-21"} -->
A paragraph whose pin is current.

<!-- meta {"verified-by":[{"tool":"doc-detective","check":"first-steps"}]} -->
1. An unpinned first step.
2. Its second step.

<!-- meta sha256-29c9f2b5462193fe88cf36e57b93c9650739c479e0870d326fd656ba95ddc56c {"last-verified":"2026-10-21"} -->
A paragraph edited after it was pinned.

A paragraph with a statement
<!-- meta {"concepts":["install"]} -->
inside it.

<!-- cite stacked-entry -->
<!-- meta {"concepts":["install"]} -->
A paragraph under a stacked cite marker and meta statement.

```md
<!-- meta {"not":"read"} -->
```

<!-- meta {"concepts": ["install"} -->
A paragraph under a payload that is not JSON.

<!-- meta {"verifed-by":[]} -->
A paragraph under an unknown field.

<!-- meta {"personas":["maya"]} -->
A paragraph under a field that lives in the manifest.

[comment]: # (meta {"concepts":["a (b)"]})
A paragraph under a line form holding a parenthesis.

<!-- meta {"verified-by":[{"tool":"doc-detective","passed":"yesterday"}]} -->
A paragraph under a value its schema refuses.

<!-- meta sha256-4b4a4f584ca8be99b534b1f2e0cc0dff6a0948494496e634aa5985a119e6b20a {"applies-to":["windows"],"graph":{"type":"task"}} -->
## Install on Windows

Body text that a section statement does not pin.

<!-- meta {"graph":{"type":"task"}} -->
A block statement that sets graph.

<!-- meta {"concepts":["install"]} -->
