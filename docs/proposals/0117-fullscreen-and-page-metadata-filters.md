# 0117: Fullscreen and page metadata filters

- **Status:** Implemented (worktree; pending merge)
- **Serves:** Maya · M18 / Sara · S17
- **Depends on:** 0114–0116 (explorer, complete graph and readable presentation)

## Problem and worked example

The user wants more space for the graph and a way to filter page metadata such
as `type: how-to`, which differs from the graph's Document or Section kinds.

Maya chooses Show everything, checks Document under Node kinds, then chooses
how-to under Content type. She sees the corpus's 75 how-to pages. An additional
language Is en condition narrows that to 56 pages. Her URL restores the same
conditions after a reload. She chooses Fullscreen, explores at her current zoom,
and uses Exit fullscreen or Escape to return without losing her filters.

## Interface and behavior

- Rename the existing type checkbox legend to Node kinds. Existing `type=` URL
  keys retain their graph-kind meaning.
- Add Content type under Page metadata. Its options are the dataset's `/type`
  values, with page counts; the default is Any content type.
- Add metadata filter creates a row with Field, Condition and Value controls,
  plus Remove filter. Fields are discovered from the canonical exported page
  metadata, including nested paths. Values offer suggestions and accept typed
  text. Change/Enter applies the condition. Empty unfinished text conditions
  have no effect.
- Conditions are Is (case-insensitive scalar or array-member equality),
  Contains text (case-insensitive substring in a scalar/member), Is present and
  Is missing. Multiple conditions use AND. Metadata predicates apply only to
  nodes with a source page; sections and typed records use their source page's
  values. Check Document to show just pages. Clear filters and Show everything
  remove metadata conditions too.
- Shared URL keys: optional `contentType` (string, default empty) and repeatable
  `meta`, one JSON tuple `[JSON-Pointer, operator, value]` per condition. Operators
  are `is`, `contains`, `present`, `missing`. Malformed tuples or unknown operators
  are ignored. Fullscreen itself is ephemeral and is never entered by a URL.
- Fullscreen fills the browser viewport and uses native fullscreen where
  supported. The phone fallback is equally usable without that API. The explorer
  is temporarily mounted under body so site-header stacking contexts cannot cover
  it. It returns to its original DOM position on exit. Background content becomes
  inert, focus stays within the expanded explorer, Escape exits and focus/scroll
  are restored. Entering/exiting preserves zoom and filter state. Mobile graph
  mode collapses the filter drawer and hides the separate result list; List
  remains available.

No CLI flags, config keys, dependencies, artifact formats or public API change.

## Verification

Dedicated fixture tests cover how-to filtering, section inheritance, arrays,
nested properties, booleans, present/missing fields, AND semantics and shared
URL restoration. Browser dogfood checks the real 75/56-page counts, row removal,
clear/reset, native fullscreen and a deliberately forced phone fallback,
Escape, zoom preservation, focus restoration and the absence of a site-header
overlay. Existing Chromium/WebKit desktop, phone and accessibility checks remain.
Screenshots include `*-fullscreen.png`, `*-fullscreen-mobile.png` and
`*-how-to.png` under `.manni/explorer-qa/`.
