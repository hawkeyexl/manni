# 0122: Selecting a node shifts the explorer's neighborhood focus

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Extends:** 0114, 0120–0121

## Decision

Selecting a node previously updated the inspector and pinned highlight while
leaving the explorer centered on its earlier neighborhood. The user requested
that clicking a node shift focus to that node.

Graph clicks and taps, keyboard activation, results and inspector connections
now set the selected node, pinned highlight and neighborhood focus together.
The explorer recomputes and fits the new neighborhood. Clear the search so it
does not hide neighbors; retain node kinds, metadata, relationship filters,
connection depth and Graph/List view. Existing URL fields record the transition,
and Back restores the prior view.

Show whole graph returns to the wider graph while preserving selection and the
pin. Background clicks release the highlight without changing neighborhood
scope. The existing Focus here action remains available for explicitly loaded
URLs whose selection differs from their scope. No new public APIs, URL keys or
dependencies are required.

## Verification

The browser regression first failed because clicking a journey left `focus` on
Sara. Chromium and WebKit then exercise scope changes for SVG and full-corpus
canvas clicks, keyboard activation, search selection and mobile list selection.
Existing pin clearing, pan/zoom, filters, fullscreen and accessibility checks
remain in the same regression run.
