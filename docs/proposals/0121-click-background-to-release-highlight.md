# 0121: Release a pinned highlight by clicking outside nodes

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Extends:** 0120

## Decision

The user requested direct graph interaction in place of the Clear highlight
button introduced by 0120. Remove that button. Clicking or tapping anywhere in
the graph outside a node releases the pinned neighborhood. Clicking a connection
also shows its relationship, preserving the existing interaction. Node details,
filters, scope and graph positions stay intact.

Clicking another node still switches the pin. Dragging to pan and zooming keep
it. Both SVG edge targets and the shared graph background handler release the
pin, covering small and full-corpus canvas graphs. The graph hint and guide
describe the gesture. No dependencies or public API changes are required.

## Verification

Browser regressions first failed on the remaining button, then passed with
background click clearing in SVG, connection tap clearing, canvas background
tap clearing and preserving the pin during a drag. Chromium and WebKit run the
existing mobile, fullscreen and accessibility checks alongside these cases.
