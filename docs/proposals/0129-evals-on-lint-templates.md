# 0129: Evals on lint templates, and TGDP's guidance as built-in evals

- **Status:** Proposed
- **Serves:** Two journeys.
  - Sara · S7, "Describe a doctype as a template". The template that holds a
    doctype's shape now holds its content checks too.
  - Maya · M12, "Keep one eval library the whole corpus shares". A doctype's
    evals reach its pages through lint's routing, with no suite per type.
- **Depends on:** Four proposals.
  - [0048](0048-docevals-domain.md) defines the evals tool and the
    `manni:evals:1.0.0` entry forms a template now reuses.
  - [0050](0050-lint-domain.md) defines lint's routing, which docevals now
    reads.
  - [0061](0061-lint-template-grammar.md) defines the template grammar this
    key joins.
  - [0088](0088-findings-say-what-the-template-asks-for.md) gave each built-in
    section a `description:` drawn from upstream's guides.
- **Supersedes** no proposal. lint's
  [01003](lint/01003-remove-the-language-model-and-be-deterministic.md)
  removed the model from lint and deferred the migration of `instructions:`.
  It did not rule out evals on a template, and it stays as written.
- **Verdict:** A lint template carries an `evals` list in the page entry form.
  `manni docevals` grades it on every page lint routes to that template, between
  suite evals and page entries. The seven built-in TGDP templates ship TGDP's
  content guidance as `ai` evals. They attach to every typed page with no
  config and block a judged run.

## Problem

Sara writes down the shape of a how-to in a lint template. The file holds the
headings, the sections and the code blocks, and lint enforces it on every
`type: how-to` page. But half of what makes a how-to a how-to is about its
content, and the file has nowhere to say it. TGDP's own guide for the doctype
is mostly content rules. Each step asks for one action, each command shows its
result, and the page teaches no concepts.

- **Template instructions go nowhere.** lint refuses `instructions:` at load.
  The refusal printed a `docevals.evals` snippet to paste into
  `manni.config.yaml`, and the pasted eval reached no page.
- **Built-in templates drop the guidance.** The TGDP built-ins carry the
  guide's structure and a `description:` per section. The guide's content
  rules reach authors as prose and are never checked.
- **Suites repeat the routing, and drift from it.** To reach pages, Maya builds
  a suite per page type and sets `eval-suite:` on each page or manifest. That
  repeats the routing lint already does from `type:`, and nothing checks that
  the two agree. A page that changes from `type: how-to` to `type: reference`
  keeps its how-to suite in silence.
- **This repository has the gap.** Its suites are per domain, each just
  `no-todo-markers`. 74 pages declare `type: how-to` and 69 declare
  `type: reference`, and no eval knows either.

## Decision

1. **A template carries `evals`.** The key is a list on a template, never on a
   section. Each entry takes the form of one item of a page's `evals:` list in
   `manni:evals:1.0.0`. That is a bare assertion, a `use:` reference or an
   inline entry with an `id`. The loader validates each entry against that
   vocabulary's own `evalEntry`, the bytes pages validate against. lint never
   grades them, and no `manni lint` finding changes.
2. **Inheritance goes by id through `extends`.** A child inherits its parent's
   evals. A child inline entry with an inherited id replaces it in place. A
   child `use:` naming an inherited id narrows it, through `skip`, `severity`,
   `weight`, `type` and `options`. A `use:` naming nothing inherited refers to
   `docevals.evals`. Every other entry is appended.
3. **A template cannot carry a command.** An inline `grader: command` entry is
   refused at load by both tools. A page can name its own template, and a
   command inside it would run with the operator's permissions. A command
   lives under `docevals.evals` and a template reaches it with `use:`.
4. **docevals routes as lint does.** The template step comes from lint's own
   routing, exported once and used by both tools. That is `$template`, then
   `lint.overrides`, then the page's `type` with the built-ins included, then
   `lint.template`. It reads the same `manni.config.yaml`, and needs no
   `lint:` section.
5. **The order is suite, then template, then page.** A template's inline
   entry replaces a suite eval with the same id. A page entry wins over both,
   and a page `use: <template eval id>` narrows the template's eval. A page
   lint routes nowhere gets no template evals and no message.
6. **The built-ins carry TGDP's guidance, always, and it blocks.** Every
   built-in TGDP template ships `tgdp-*` evals drawn from upstream's guides at
   `v1.6.0`. They attach to every page whose `type:` is a TGDP doctype, with
   no config. Each is `ai`, `regression` and `error`, so a failing verdict
   fails a judged run. This is the user's explicit decision.
7. **The built-ins are `ai` alone.** No built-in eval is deterministic. Each
   asks something only a reader of the finished page can judge. A regex
   version of "each step starts with a verb" would fail good pages and pass
   bad ones. This is the user's explicit decision too.
8. **The `instructions` refusal points at the new home.** It keeps exit 2 and
   now prints a template `evals` entry in place of a config eval.

### What attaching them always costs

A judged run, meaning one without `--deterministic-only`, now grades every
typed page against its doctype's TGDP evals. A run that passed before can exit
1 with no change to the corpus. Deterministic runs are unaffected, CI's
`docs:check-docevals` among them, because they skip every `ai` eval.

The opt-outs are four, each at a different scope.

- A template that extends the built-in narrows an eval with `use: <id>` and
  `skip: true`. That covers the repository.
- A page entry `use: <id>` with `skip: true` covers one page.
- `--eval` selects the evals one run grades.
- Routing the doctype to a template that does not extend the built-in drops
  them all.

## Worked example

Sara starts from this repository. The page
`docs/src/content/docs/cite/set-up/citations-in-a-sidecar.mdx` has
`type: how-to`, and the root config has no `lint:` section.

She upgrades and changes nothing else.

```text
$ manni docevals list docs/src/content/docs/cite/set-up/citations-in-a-sidecar.mdx
docs/src/content/docs/cite/set-up/citations-in-a-sidecar.mdx (suite: cite) (template: tgdp:how-to:1.6)
  - no-todo-markers [tool:regex, regression, config]
      The page carries no TODO, TBD or FIXME markers.
  - tgdp-overview-names-the-task [ai, regression, template]
      The overview says which task the guide covers and when or why a reader would want to do it.
  …
```

A judged run, `manni docevals run --ai-only docs/src/content/docs/cite/`, grades
every typed page against its doctype's evals. A failing verdict exits 1.

manni's how-tos often show a config-file route beside a CLI route, so TGDP's
"one method" rule does not fit here. She also wants each how-to to show its
command. She writes `templates/how-to.yaml` and registers it under
`lint.templates`.

```yaml
templates:
  how-to:
    extends: tgdp:how-to:1.6
    types: [how-to]
    evals:
      - use: tgdp-one-method
        skip: true
      - id: shows-the-command
        assertion: The page shows the manni command it is about.
        grader: tool:regex
        options: { pattern: "manni [a-z]+", match: contains }
```

`manni lint templates show templates/how-to.yaml#how-to` prints the sections,
then an `Evals` block. It lists six `tgdp-*` evals, with `tgdp-one-method`
marked `(skip)`, then `shows-the-command`. `docevals list` now names
`(template: templates/how-to.yaml#how-to)`. `--deterministic-only` grades
`shows-the-command` on every how-to, and a page without a command exits 1 on
its `type:` line. When she next edits the template, `--since origin/main`
selects every page routed to it and no other page.

The how-to doctype is one file that extends TGDP's. She wrote no suite and no
`eval-suite:` for it.

## Interface

### Template file

Before, `instructions:` is refused with exit 2 and nothing else is accepted.

```yaml
templates:
  how-to:
    sections:
      - id: title
        instructions: [Must mention the intent of the document]
```

After:

```yaml
templates:
  how-to:
    types: [how-to]
    extends: tgdp:how-to:1.6
    evals:
      - Must mention the intent of the document
      - use: no-todo-markers
        severity: warning
      - use: tgdp-one-method
        skip: true
      - id: shows-the-command
        assertion: The page shows the manni command it is about.
        grader: tool:regex
        options: { pattern: "manni [a-z]+", match: contains }
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `templates.<name>.evals` | list of eval entries | the parent's, else none | no | Evals `manni docevals` grades on every page lint routes to this template. |

The template schema keeps `$id: manni-lint:template:2`, because the key is
optional and additive. No config key and no flag is added.

### Commands

| Command | Behavior |
|---|---|
| `docevals run` | Grades template evals. `--since` and `--newer-than` select a page when its local template or a local `extends` parent changed. Built-in and URL templates never select. |
| `docevals list` | The pretty header gains ` (template: <ref>)`, and a template eval's tag is `template`. JSON gains `template` per page and `source: "template"` per eval. |
| `docevals promote` | `--write` edits no template. A template eval's proposal carries `source: "template"` and an `error`, and the exit code is unchanged. |
| `lint templates show` | Pretty prints an `Evals` block after the sections, and `-f json` adds `evals`. `-f markdown` is unchanged. |
| `lint check`, `lint structure` | Accept the key. Findings are unchanged. |

A template eval's `location` in `run` output is the page's `type:` or
`$template` line. When an override or `lint.template` routed the page, it is
the page alone.

### Messages

Each exits 2 before any page is graded.

```text
templates/how-to.yaml: "templates.how-to.evals[1]" uses grader command, which a template cannot carry. Define it under docevals.evals in manni.config.yaml and reference it with use: has-steps.
templates/how-to.yaml: "templates.how-to.evals" defines "shows-the-command" twice
templates/how-to.yaml#how-to: evals use "no-such-eval", which no template it extends and no docevals.evals entry in manni.config.yaml defines
templates/how-to.yaml is not a valid template file: /templates/how-to/evals/0 must have required property 'assertion'.
```

The `instructions` refusal keeps exit 2 and now reads as follows.

```text
templates.yaml: "templates.how-to.sections.title" uses `instructions`, which manni lint does not evaluate. Move it to the template's evals, which manni docevals grades on every page this template routes:

  templates:
    how-to:
      evals:
        - id: how-to-title
          assertion: Must mention the intent of the document
```

`promote --write` on a template eval sets this `error`.

```text
eval "tgdp-one-method" is declared in tgdp:how-to:1.6; promote --write does not edit templates. Apply the proposal in the template or in one that extends it.
```

## The built-in evals

Upstream's guides are vendored verbatim beside the templates they mirror, as
`test/lint/fixtures/tgdp/guide_<doctype>.md` at `v1.6.0`. Each eval carries a
comment naming the guide lines it comes from. The selection keeps guidance a
reader of the finished page can verify, and leaves four kinds out.

- Heading and order rules, which lint checks.
- Step and list counts, which are lint's `lists.max`.
- Advice about the writing process.
- Advice no reader can verify, such as testing on every platform.

The seven templates carry 37 evals. How-to and concept carry six each,
release notes seven, tutorial and reference five each, and readme and
troubleshooting four each. The templates reference page lists every id and
assertion.

### Two candidates dropped

- **A tutorial step shows its result.** `guide_tutorial.md:114` calls the
  result "the last, and optional, element in a step". An eval would fail
  tutorials upstream calls complete.
- **A readme says why each prerequisite is needed.** `guide_readme.md:81`
  offers it as something to consider. Optional advice is not a blocking rule.

### Where upstream contradicts itself

Each eval follows the guide's rule where its own example disagrees, or is
narrowed until the two agree.

- **How-to imperatives.** `guide_how-to.md:49` asks for conditional
  imperatives, as in "To achieve w, do z". The example step at `:132` opens
  with such a lead-in. So `tgdp-steps-start-with-a-verb` allows a short
  lead-in before the verb.
- **Release-notes tense.** `guide_release-notes.md:57` asks for the past tense
  in bug fixes. The fix examples at `:230`, `:241` and `:251` all use the
  present. So `tgdp-present-tense` covers new features and improvements alone,
  and no eval sets a tense for fixes.
- **Deprecation notes.** `guide_release-notes.md:282-285` lists a removal date
  among what a deprecation names. The example at `:291-295` gives none.
  `tgdp-deprecations-are-complete` follows the list, so upstream's own example
  fails it.

## What was rejected

| Option | Verdict |
|---|---|
| A suite per doctype, set by `defaults` or by each page | Rejected. It repeats lint's routing, and a page that changes type keeps the old suite in silence. |
| Opt-in attachment of the built-in evals, through a config key | Rejected by the user. Guidance nobody turns on reaches no page, which is the gap this closes. |
| Non-blocking built-ins, at `warning` | Rejected by the user. A guide's rule that never fails a run is read as advice. |
| Deterministic built-ins, as regex or generated scripts | Rejected by the user. Each guide rule needs a reader's judgement, and a pattern would misjudge both ways. |
| Evals on a section | Rejected. A section rule matches headings, and an eval grades a page. An assertion about one section names it in its text. |
| Inline `command` evals on a template | Rejected. A page can name its own template, so a command there would run on content's say-so. |
| A second routing implementation in docevals | Rejected. Two copies would drift, and a page could be linted against one template and graded against another. |

## Consequences

- Good, because a doctype's shape and its content checks are one reviewable
  file, and changing it re-grades exactly the pages it routes.
- Good, because a typed page gets its doctype's guidance with no config.
- Good, because the `instructions` refusal now names a place the moved
  instruction reaches.
- Bad, because a judged run can exit 1 after an upgrade with no change to the
  corpus. The release note says so, and the opt-outs above undo it.
- Bad, because every typed page now costs judge calls in a judged run. A run
  that judges nothing new still replays from the cache.
- Neutral, because deterministic runs, and so the CI gates, are unchanged.

## Release

`feat(docevals)`, with the judged-run change stated in the release note.
Deterministic runs, the form CI gates on, behave as before, so the change
ships as a minor release.

## Acceptance

The PR carries the full checklist. In short, the key loads in lint and changes
no finding. The refusals exit 2 with the messages above. The built-ins carry
the `tgdp-*` evals with verified guide lines. docevals resolves suite, then
template, then page. `list`, `run`, `promote` and `templates show` print the
shapes above.
