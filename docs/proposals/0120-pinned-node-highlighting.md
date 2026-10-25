# 0120: Clicking pins a node's highlighted neighborhood

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Extends:** 0119

## Problem and behavior

Hover highlighting disappears when the reader moves the pointer to inspect
something else. Clicking or tapping a node now pins its immediate incoming and
outgoing connections and neighboring nodes. Other pointer hovers do not replace
that neighborhood. Clicking another node switches the pin; **Clear highlight**
releases it without changing selection, filters or scope.

The pin survives pan, zoom, closing node details, switching views and URL
restoration. A `highlight` URL parameter records it separately from the selected
inspector node, so opening an existing URL with only `node` preserves ordinary
hover behavior. Reset and Show everything clear the pin. If filters hide the
pinned node, normal hover remains available until it becomes visible again.

SVG and canvas use the same visible-node priority rule and neighborhood lookup.
The control stays in the main toolbar, including mobile fullscreen. No CLI,
public package API, dependencies or published graph artifact formats change.

## Verification

- Fixture tests cover pin priority, pointer exit, clearing, filtered-out nodes
  and URL round trips.
- Chromium and WebKit exercise SVG pinning, moving across other nodes, switching
  pins, closing details, reloading and clearing. Canvas coverage checks pinning,
  pointer exit, zoom, closing details and clearing with the complete corpus.
- Existing phone, fullscreen, metadata, relationship and accessibility checks
  remain part of browser QA. Evidence is saved as `*-node-pinned.png` and
  `*-canvas-node-pinned.png` under `.manni/explorer-qa/`.
