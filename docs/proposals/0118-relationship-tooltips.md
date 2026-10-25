# 0118: Relationship tooltips on graph connections

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Depends on:** 0114–0117

## Problem and behavior

The user wants to see a relationship by hovering the connection itself, rather
than selecting a node and opening its Connections tab.

Hovering highlights a connection and shows its readable relationship label,
source → relationship → target, and compact RDF predicate. Multiple relationships
between the same pair, including inverse directions, are listed separately.
Tooltip text uses the normal text/element APIs, never HTML from graph data.

Small SVG graphs provide wider invisible pointer targets and focusable,
named connection controls. Pointer hit testing chooses the closest segment
rather than whichever overlapping line happens to be painted last. Keyboard
focus and Enter/Space show the same tooltip; Escape dismisses it.

Full canvas graphs use the same segment-distance hit test after undoing pan
and zoom, with a screen-sized hit tolerance. Nodes retain pointer priority.
The hovered connection is highlighted and gains a direction arrow. Mobile
users tap a connection to show its relationships. Moving away, panning,
filtering or selecting a node dismisses transient relationship state.

No controls, config, CLI, URL state or output artifact formats are added.
The existing Connections list remains the keyboard-accessible route through
the full canvas graph.

## Verification

A pure hit-test regression covers closest segments, endpoints, distant pointers
and missing positions. Browser dogfood tests SVG mouse/touch/keyboard tooltips,
source/target arrows and predicate text, and hover over a visible canvas segment.
Screenshots are `*-relationship.png` and `*-canvas-relationship.png` under
`.manni/explorer-qa/`. The fullscreen, metadata, mobile and accessibility checks
continue in Chromium and WebKit.
