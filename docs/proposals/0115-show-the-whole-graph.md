# 0115: Show the whole graph without a node limit

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Supersedes in part:** 0114, decision 6's 150-node rendering limit.

## Problem and decision

The user tried Reset and still could not see the whole graph. The 150-node limit
made an apparently complete view omit most of the corpus. The user explicitly
asked to see everything. This replaces the limit, without adding a second mode
or changing the URL contract.

Show everything is a persistent toolbar button. It clears the query, type and
relationship filters, focus and selection, and selects Graph. Reset also shows
the complete graph. Every filtered graph likewise contains every match.

At up to 300 nodes the existing SVG renderer is used. Larger graphs draw all
nodes and their connections on a high-DPI canvas. This threshold changes only
the renderer, never the number of nodes. D3 still computes the layout in its
worker, and controls the shared pan/zoom transform. Canvas redraws are coalesced
with requestAnimationFrame, use cached shape paths and batch edge strokes.
Panning and zooming naturally clip content outside the viewport. Fit graph
fits the entire matching graph, with a lower zoom limit of 0.01.

Canvas hit testing reverses the viewport transform and selects the nearest
node within a touch-sized target. The inspector and the keyboard-accessible
list use the same complete node set. Theme changes redraw the canvas. There
are no new dependencies, config keys, CLI flags, artifact formats or URL keys.

The browser reports `Laying out {count} nodes…` while computing and
`Showing all {count} matching nodes · {edges} connections` after rendering.
The initial persona view is retained; Show everything offers the direct route
out of it that was missing.

## Verification and acceptance

- [x] Every matching node is rendered, including all 3,366 nodes and 9,199
  navigable connections in this repository's corpus.
- [x] Show everything clears filters and neighborhood focus and survives URL reload.
- [x] Graph selection, inspector, search, zoom, list view, empty state and retry
  work in Chromium and WebKit; mobile portrait, landscape and 320px layouts pass.
- [x] A pure hit-testing regression checks closest-node selection and missing positions.
- [x] Astro check, production build, strict TypeScript, targeted lint, metadata
  validation and the nine focused explorer tests pass.
- [x] The CLI exploration guide remains below the explorer; its introduction
  explains Show everything and that there is no node-count limit.

Browser evidence is written by `node scripts/check-explorer-browser.mjs` to
`.manni/explorer-qa/`, including each engine's `*-everything.png` screenshot.
These checks use browser/device emulation, not a physical phone.
