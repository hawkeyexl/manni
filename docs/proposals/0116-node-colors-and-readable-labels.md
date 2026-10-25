# 0116: Node type colors and readable zoom labels

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Depends on:** 0114 (explorer), 0115 (whole-graph canvas)

## Problem

The user could see the whole graph but could not distinguish its node types,
and the small truncated labels remained difficult to read when zooming.

## Decision and interface

One shared presentation module supplies categorical colors for both renderers,
the type legend, filter markers, result markers and inspector type labels.
Documents are blue, sections teal, concepts purple, audiences amber, personas
pink, journeys green and other nodes gray. Each category has light and dark
variants with at least 4.5:1 contrast against the graph background. These are
data categories; the brand/control accent remains blue. Existing shapes and
written type names remain, so color is not the only way to distinguish a type.
Selection adds a separate ring and retains the node's type color.

Graph labels use screen coordinates in both SVG and canvas. Their semibold
text is at least 14px and grows to 20px with zoom, with opaque theme-aware
backgrounds and type-colored outlines. Titles wrap at word boundaries across
up to two lines, or three for selected/hovered nodes. Overlapping labels are
suppressed with priority given to selection, then hover. At high density,
labels start appearing at a graph scale of 0.65; selected and hovered labels
are available at every scale. No nodes or edges are omitted by this change.
The inspector continues to expose the complete title.

There are no new controls, URL parameters, config keys, CLI flags, artifact
formats, dependencies or public API changes.

## Verification

- Dedicated tests check all seven category colors in both themes for contrast
  and uniqueness, increasing but bounded label font sizes, wrapping,
  selected-node priority, collision handling and viewport containment.
- The browser dogfood checks that SVG node types have distinct computed fills,
  then opens the full canvas graph and checks that zoom enlarges labels and
  produces visible labels. It saves full-graph and zoomed-label screenshots.
- Existing search, selection, complete-graph counts, light/dark accessibility,
  mobile portrait/landscape/320px and retry tests continue in Chromium and WebKit.
- Astro check, the production build, strict TypeScript and focused lint/tests
  cover the shared module and both renderers.
