# 0068: a manifest owns what the marks say

- **Status:** Proposed
- **Serves:** Maya · M6, who keeps each page's bookkeeping in a manifest
  beside it, and Sara · S1, whose schemas already say where each field lives.
- **Depends on:** [0041](0041-collections.md), which gave a collection its
  manifests. [0047](0047-field-location.md), which marked each field `page`
  or `external`. [0060](0060-a-manifest-per-page-as-built.md), for the
  `{page}` placeholder.
- **Supersedes, in part:** [0041](0041-collections.md) and
  [0047](0047-field-location.md), for a manifest's required `keys`. In each
  the Status line is the only edit.
- **Touches:** `src/meta/core/config.ts`, the external-metadata code under
  `src/meta/core/`, `test/**`,
  `docs/src/content/docs/meta/reference/configuration.mdx`,
  `docs/src/content/docs/meta/set-up/external-metadata.mdx`
- **Verdict:** A manifest's `keys` becomes optional. A manifest with no
  `keys` owns every field the page's schemas mark `x-manni-location:
  external`, less the keys another manifest names.

## Problem

A collection that keeps its bookkeeping in a manifest has to list every key
the manifest owns.

```yaml
externalMetadata:
  - file: "{page}.meta.yaml"
    keys: [authors, owner, stakeholders, reviewed-by, created,
           last-reviewed, review-interval, verified-against,
           source-of-truth, personas, journeys, visibility,
           supersedes, remove-by, provenance, meta-provenance,
           evals, eval-suite, eval-skip]
```

Every name in that list is already written down. The vocabularies mark each
of those fields `external`, and the marks are what `validate` warns on and
what `relocate` follows. So the config states one fact twice. When a
vocabulary gains an external field, the list goes stale without a word. The
new field is then refused from the manifest it belongs in.

## Decision

`keys` becomes optional. Written, it means what it means today. Left out, the
manifest owns what the marks say.

| Key | Type | Required | What it does |
|---|---|---|---|
| `collections[].externalMetadata[].keys` | `string[]` | no | Present, the manifest owns exactly these keys, as before. Absent, it owns every top-level key the page's resolved schema set marks `x-manni-location: external`. A key another manifest in the collection names in its own `keys` is left out. |

```yaml
externalMetadata:
  - file: "{page}.citations.yaml"
    keys: [citations]
  - file: "{page}.meta.yaml"          # owns the other external fields
```

### Ownership is per page

Marks come from a page's schema set, and an override gives some pages a
different set. So a manifest with no `keys` can own different fields for two
pages. That is the point, and not a hazard. A page's schema set names where
that page's fields live, so a glossary page and a how-to page can differ.

### Rules

1. **At most one manifest per collection may omit `keys`.** Two would claim
   the same marked fields. The config is refused, exit 2:
   `collections[0].externalMetadata: entries 1 and 2 both omit keys; at most one manifest may own the external-marked fields`.
2. **Written `keys` win.** A marked field another manifest names belongs to
   that manifest.
3. **A join field is never owned.** A manifest joined on a field reads that
   field from the page, marked or not.
4. **A URL manifest may omit `keys`.** It owns the marked fields, and
   `derive` refuses to stamp into it, as it refuses any key a URL manifest
   owns today.
5. **Nothing marked means nothing owned.** A page whose schemas mark no
   field `external` reads the manifest as empty.

Everything downstream of ownership is unchanged. A page carrying a key its
manifest owns is the existing `external:owned` error, exit 1. `get` and
`query` name the manifest as the value's origin. `relocate` moves a marked
field into the manifest, and `derive` stamps a managed field there.

## Stress test

1. **A vocabulary gains an external field.** The manifest owns it at once,
   with no config edit.
2. **A field is both named and marked.** The naming manifest owns it. The
   one without `keys` does not.
3. **Two manifests omit `keys`.** Refused at load, exit 2, naming both
   entries.
4. **A glossary override with a different set.** Its pages' manifest owns
   that set's external fields. A how-to page in the same collection owns its
   own set's.
5. **A mark that says `page`.** The field is never owned implicitly, so it
   stays on the page. A page that wants it in a manifest names it in `keys`.
6. **A config written before this.** Every manifest has `keys`, so nothing
   changes.

## Open questions

None.
