# 0119: Hover highlights a node's immediate neighborhood

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Depends on:** 0114–0118

## Problem and behavior

The user wants to follow a node's connections in a dense graph without losing
the surrounding graph. Hovering a node now keeps that node and its directly
connected neighbors at full opacity. It emphasizes incoming and outgoing edges
incident to the node and dims unrelated nodes and edges. Type colors remain.
Labels concentrate on the highlighted neighborhood, with the hovered label
given priority. The hovered node gains a visible ring.

The shared one-hop helper receives the graph's currently visible edges. It
does not expand the current scope, add hidden nodes or follow transitive links.
An isolated node highlights itself. Hover is transient: moving away, panning,
zooming, filtering or selecting clears it. Selection and shared URL state are
independent of hover.

SVG graphs update classes and labels; keyboard node focus has the same effect.
Canvas graphs batch the same bright/dim edges and draw muted nodes first so they
cannot obscure highlighted neighbors. All nodes remain available for hit
testing. High-zoom hit targets include square/rectangular node corners.
Clearing hover restores normal rendering. No new controls, flags, config,
URL parameters, dependencies or artifact formats are introduced.

## Verification

- A fixture regression checks incoming and outgoing neighbors, exclusion of
  second-hop nodes, and isolated/empty hover states.
- Browser QA checks the bright node, neighbors and incident edges, muted
  unrelated elements, unchanged selection/URL and restoration on pointer exit.
- SVG keyboard focus and the full-corpus canvas view are exercised in Chromium
  and WebKit, alongside the existing phone, filter, fullscreen and accessibility
  regressions. Screenshots are `*-node-hover.png` and `*-canvas-node-hover.png`
  under `.manni/explorer-qa/`.
