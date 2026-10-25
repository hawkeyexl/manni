# 0124: Random-node discovery searches beyond the current neighborhood

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Supersedes:** The random candidate scope in 0123

## Decision

The user wants repeated dice clicks to discover nodes across the whole graph,
rather than remain within the selected node's neighborhood. Build a separate
global candidate set using the active search, node-kind, relationship and page
metadata filters. Neighborhood scope and connection depth only constrain the
displayed graph, not random candidates. Reuse the same filter application for
global candidates and the visible neighborhood.

The dice button remains enabled when there are global matches even if the
current neighborhood has none. It disables only during initial loading or when
the global filters match nothing. Selection still excludes the current node
when alternatives exist, opens the inspector and focuses the new neighborhood.
Shared URL fields, dependencies and public APIs remain unchanged.

## Verification

A browser regression opens the scheme neighborhood with a Document-only search
for the template-writing page. The neighborhood has no matches, but the whole
graph has that page. It first failed because the dice button was disabled; the
fixed button selects the page, changes focus and retains the node-kind filter.
The existing Chromium/WebKit corpus workflow also checks metadata-filtered
random selection, globally empty results, mobile fullscreen and accessibility.
