---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# A self-contained HTML report

## Context and Problem Statement

Every output format was machine-facing (`json`, `sarif`, `junit`) or terminal-facing (`human`,
`markdown`, `github`). The content strategy names the corpus owner and the standard owner as the
primary audience, and they are neither. They want to see which pages failed, what the judge
actually quoted, and whether the suite met its target. Neither of them is reading SARIF.

## Decision Drivers

- ADR 01014 already set the precedent that a reporter is a legitimate unit of work.
- A report that is emailed, attached to a PR, or opened from a CI artifact directory must survive
  having no network. Those contexts strip or block external requests.
- The judge's `observed` quotation is the reason to open the report at all. A verdict without the
  text it rests on is not reviewable.

## Considered Options

- Point people at `--format markdown`.
- Generate a site (a directory of assets).
- One self-contained HTML file.

## Decision Outcome

The chosen option is **one self-contained HTML file**, `--format html`, registered in `REPORT_FORMATS`
(the single source of truth per ADR 01007).

No CDN, no external stylesheet, no web font, and no script. Everything is inline. It carries
per-eval verdicts with the judge's `observed` quotes and consensus numbers, plus findings grouped
by page. It also carries weighted suite summaries including the criteria block (ADR 01032),
baseline and review state, and the self-preference marker (ADR 01034).

### Consequences

- Good, because it opens from a file:// URL, a CI artifact, or an email attachment and looks the
  same in all three.
- Good, because it respects `prefers-color-scheme`. The file is opened in whatever the reader
  already uses. A white sheet in a dark editor is the kind of small rudeness that stops people
  opening it twice.
- Good, because a partial suite renders as "partial" rather than as a failure, which is ADR 01018's
  rule reaching one more surface.
- Bad, because the markup and styles live in a template string rather than in files a designer
  would edit. Self-containment is the requirement; that is what it costs.
- Neutral, because it is not a replacement for SARIF or JUnit. Those are consumed by machines that
  are perfectly happy, and nothing about them changes.

### Confirmation

`test/unit/format.test.ts` pins the format list and the allowed-set message. A CI step renders the
report over the fixture corpus and fails if it contains any `src`/`href` pointing at `http(s):`.
A report that reaches for a CDN renders unstyled, and one that reaches anywhere at all tells a
third party where it was opened.
