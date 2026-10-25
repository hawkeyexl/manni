# 0123: Start on the whole graph and offer random-node discovery

- **Status:** Implemented (worktree; pending merge); random scope superseded by 0124
- **Serves:** Maya · M18 / Sara · S17
- **Extends:** 0114, 0115, 0122

## Decision

The user wants the first visit to show everything instead of Sara's persona
neighborhood. Remove that special startup override. With no URL fragment, the
existing empty defaults show all node kinds, no selection or neighborhood, and
the complete graph. Explicit shared URLs remain authoritative.

Add a toolbar button displaying 🎲, with accessible name and tooltip Random node.
It chooses uniformly from current search/filter/neighborhood results, excluding
the selected node whenever another result exists. A single result remains
selectable; zero results or initial loading disable the control. Selection uses
the normal inspector, pinned highlight and automatic neighborhood-focus behavior.
The button works in Graph, List and mobile fullscreen. Reset and Show everything
continue to return to the full graph. No dependencies or URL keys change.

## Verification

Fixture tests cover empty startup state, random-result membership, avoiding the
current selection and empty/single-result behavior. The browser regression first
failed on the persona startup scope. Chromium and WebKit check the full-corpus
landing view, random focus and highlight, metadata-filter membership, empty-state
disablement and a fullscreen phone tap. An explicit Sara deep link keeps the
existing SVG workflow coverage and proves URL state still restores.

Dogfood uses the repository's generated 3,366-node corpus. Landing screenshots
are `*-landing-whole-graph.png` in `.manni/explorer-qa/`; the same browser script
continues its desktop/mobile, fullscreen and accessibility checks. The guide and
demo beat sheet describe the new entry point.
