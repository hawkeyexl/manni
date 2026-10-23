# 0105: A citation finding names the readers of its page

- **Status:** Proposed
- **Serves:**
  - Devin · D5, "Gate citations in CI without blocking on prose". A pull
    request reports the stale sentences and the readers they fail.
  - Maya · M5, "Pin a claim and catch it going stale". The roll-up shows how
    far one source change reaches.
- **Relates to:** Three earlier proposals.
  - [0044](0044-citations-and-drift.md) is `manni cite check` and its reporters.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) is `manni check`,
    which prints each domain's own report.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy domain, its records and its per-field gate.
- **Supersedes:** Nothing.
- **Touches:** `src/strategy/core/serving.ts`, `src/strategy/index.ts`,
  `src/cite/commands/check.ts`, `src/cite/types.ts`, the cite reporters, and
  the cite CI, cite CLI reference and strategy overview pages.

## Problem

`cite` pins sentences to source lines. `strategy` says which personas and
journeys each page serves. Nothing joins the two. So a code change that stales
a sentence says where it is stale and never for whom.

This repository shows it. Five pins point into the summary block of
`src/cite/reporters/pretty.ts`. They sit on four pages, which serve every
persona and six journeys between them. A one-line edit to the warning-count
format turns all five red. The pull request then shows five `::error`
annotations on four pages it never touched. Each names a pin id, a source path
and a commit.

None says that the change breaks the getting-started path for Maya, the CI page
for Devin and the fix page for Theo. To learn that, the reviewer opens four
sidecars and runs `manni strategy get` about ten times. Nobody does. So a hub
change and a niche change look the same in review.

## Worked example

Devin owns the CI gate, and his journey is D5. The repository runs the Action
with `command: check` and `format: github`.

A teammate's pull request edits the summary line in
`src/cite/reporters/pretty.ts`. `manni check -f github` runs cite's own
reporter, so each of the five annotations reads as before, plus one sentence:

```text
::error file=docs/src/content/docs/cite/ci/index.mdx,line=87,title=manni%3Acite/source-changed::summary-counts-apart (src/cite/reporters/pretty.ts:439-448): changed since b9712a2, 1 commit. Check the sentence against the source, then run manni cite update --accept --only summary-counts-apart. Serves devin (Devin, Platform / CI Engineer) and d5 (Gate citations in CI without blocking on prose).%0Amanni:cite source-changed: The cited lines are not what they were.%0AGuide: https://hawkeyexl.github.io/manni/cite/fix/#source-changed
```

The job exits `1`, as it would without the sentence. Devin pulls the branch and
runs `manni cite check -q`. After the last page and before the summary line it
prints the roll-up:

```text
The pages with findings serve 4 personas and 6 journeys.
  devin   Devin, Platform / CI Engineer                    3 errors on 2 pages
  maya    Maya, Documentation Engineer                     3 errors on 2 pages
  theo    Theo, Doc Contributor                            3 errors on 2 pages
  sara    Sara, Schema Author / Information Architect      2 errors on 1 page
  d5      Gate citations in CI without blocking on prose   3 errors on 2 pages
  m5      Pin a claim and catch it going stale             3 errors on 2 pages
  t2      Read a citation failure and fix it               3 errors on 2 pages
  d18     Put a number on how long the docs were wrong     2 errors on 1 page
  m6      Keep citations out of the page                   2 errors on 1 page
  s5      Make citations part of the standard              2 errors on 1 page

344 files checked, 340 passed, 4 failed, 5 findings
```

His pull request bot reads `manni cite check -f json` and its `impact` list.
Before merge, the review shows what a small format change costs. Five
sentences go stale for all four personas, across six journeys. The author fixes the docs in the
same pull request.

## Decision

### 1. It lives in cite's own report

The finding is cite's, and so are the reporters that print it. `manni check`
renders each domain's own reporter. So the family verb, the Action and the
hooks get the sentence and the roll-up with no change in `src/family/`.

### 2. Detected, never switched

The impact appears when a collection holds a `type: persona` or
`type: journey` record. Per field it follows 0102's gate. `journeys:` values
count only when a journey record exists, and `personas:` only when a persona
record does. With no records, every format prints what it printed before.
There is no flag and no config key.

### 3. Read only when there is something to say

The set is read only when the run reports a finding after the baseline, and
only when the config declares collections. A clean run, or one whose findings
are all baselined, reads nothing more.

### 4. Every reported finding on the page carries it

Whom a page serves is a fact about the page, not about a rule. So every
reported finding on a page that names records carries the sentence, whatever
its rule or severity.

### 5. Records come from every collection

The record set is lookup data, not the subject of the check. A positional or
`--collection` run still reads the records from every collection.

### 6. What a value prints

A value with a record prints `id (title)`, or the bare id when the record has
no title. A value that names no record is left out, since `strategy check`
reports it as `undefined-reference`. Ids group ignoring case and print as the
record spells them.

### 7. Order: worst first

Personas come first, then journeys. Within each, rows run by errors, warnings,
notices and findings, all descending, then by id with numeric collation. A
journey whose `lifecycle` is `draft` or `archived` comes after every live one.

### 8. It never moves a verdict

Findings, severities, the exit code and the baseline stay as they are. The
baseline's fingerprint already leaves out the message. When strategy cannot
read its set, cite says so once on stderr and reports without the impact:

```text
manni: personas and journeys left out of the report. manni.config.yaml: strategy does not carry "paths". Name a collection under collections:.
```

### 9. One shared roll-up

`src/strategy/core/serving.ts` loads whom each page serves, builds the
`impact` entries, and prints the sentence and the block. The strategy barrel
exports it, so a later domain can roll its own findings up the same way.

## Interface

No key, flag or rule is added. These are the output changes.

- **`pretty`.** One block before the summary line, only when the impact is not
  empty. A heading names the types present, then one row per record, padded to
  the widest id and title. No colour, and it prints under `-q` too.
- **`json`.** A top-level `impact` list between `summary` and `pages`, omitted
  when empty. Each entry holds `type`, `id`, `title`, `lifecycle`, `findings`,
  `errors`, `warnings`, `notices` and `pages`. `pages` spells each page as
  `pages[].file` does.
- **`github`, `sarif`, `junit`.** Each message gains
  `Serves <value>[, <value>…] and <value>.` after the finding's own text. It
  comes before the guidance lines, and before JUnit's line suffix.

## Known limits

- A red run reads every collection's set once. On a large corpus that costs a
  walk and a merged view. Narrowing the read to the finding pages is the
  upgrade path.
- Record titles reach CI logs and SARIF uploads. They come from the same
  repository as the pages. A team whose records are private and whose logs are
  public points the job at a config whose collections hold no record.
- A hub page that names many records adds a long sentence to each of its
  annotations.

## Rejected

| Option | Why not |
|---|---|
| A new verb, `manni strategy impact` | A second CI step, and a second annotation per finding. |
| The join in `manni check` | 0078's family verbs own no checks. Standalone `cite check` would miss it. |
| `--impact` or `cite.impact: true` | The tool can detect records. A switch for a detectable fact is one more way to be wrong. |
| Only `source-*` findings | A rule list to keep in step with the rules. Whom a page serves is true for any finding on it. |
| A roll-up annotation, a step summary or a PR comment | Not a finding, and UI rather than data. `json` carries the roll-up. |
| Audiences in the sentence | A persona names one audience, so it adds length and nothing new. |
| Raising a finding's severity by journey | A new rule surface nobody asked for. |

## Verification

The unit tests cover the lookup, the order and the printed lines over
`test/fixtures/cite/impact/`. The cite tests cover every format, the baseline,
the personas-only gate and the broken section. A built-bin case and a family
case cover `manni cite check` and `manni check -f json`. Run on this
repository, a change to the summary format names all four personas.
