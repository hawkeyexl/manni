# 0080: tracevals holds a session to what it was asked and the procedures it ran

- **Status:** Proposed
- **Serves:** Maya · M25, "Catch a broken rule before the agent hands back".
  It widens the rules to what she asked for and the procedures her skills set.
- **Depends on:** [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md),
  for the hook path, the judge, the ledger and the sources table.
- **Relates to:** [0049](0049-tracevals-domain.md), for the domain. Tracevals
  ADRs [01015](tracevals/01015-grade-each-artifact-against-the-window-it-governed.md)
  (windows) and [01024](tracevals/01024-capture-a-session-manifest-so-staleness-is-exact.md)
  (capture).
- **Supersedes, in part:** [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md),
  for four things. Those are the judge's wording, the earlier-turns block, the
  skill window under hooks, and its exclusion of specs, which 0080 reverses.
  0079's Status line is the only edit.
- **Touches:** `src/tracevals/rules/` (sources, extraction, the judge prompt, the
  earlier-turns block), `src/tracevals/core/config-schema.json`,
  `src/tracevals/CLAUDE.md` (the window invariant), `docs/src/content/docs/tracevals/`
- **Verdict:** Every rule is judged against the session so far, not the last
  turn alone. A rule blocks only on what the last turn did or claimed. The
  prompts the user typed, an approved plan and the specs the session touched
  become rule sources. A skill's procedure needs nothing new. Its order, gates,
  routes and required steps are rules, and the longer view is what lets the
  judge see them.

## Problem

### Maya, told "done" when it is not

Maya asks the agent for a settings toggle, a migration and a
test. Two hours later the agent says the work is finished. The migration is
there and the test is there. The toggle is not. 0079 had nothing to check,
because no rules file asked for a toggle. She did.

The same happens with a spec. The session works through
`specs/001-login/tasks.md` and ticks T014, "Write the reset-password test". No
test file exists. 0079 left specs out on purpose, and said checking work
against them needed a proposal of its own.

Then there is a long skill. `authoring-workflow` runs passes in a set order,
with the agents behind them.

- Line editing begins only "after structural issues are resolved".
- The AI Tell Audit runs "immediately before every Proofer deployment".
- The Reviewer's `route_to` names the next pass.
- "If edit type is not specified, ask."
- The Citation Verifier is "a mandatory pass before publication".
- The `meta-reflection` skill comes last.

The agent sends the draft to the Proofer when the Reviewer routed it back to
the Writer. No single turn shows that anything went wrong.

The outcome Maya wants is the 0079 block, for these too. It names what she
asked for, or the spec item, or the procedure step. It says what the turn did
instead. And it lands before the agent hands back.

### What 0079 cannot do

1. **It judges one turn.** The judge reads the last turn, and its earlier-turns
   block lists 15 records of commands and files. A route, a gate or a skipped
   pass shows only across many turns, in the agents' results.
2. **Skill windows end early.** A skill's window ends at the next skill call.
   authoring-workflow calls `identify-ai-tells` and `meta-reflection` partway
   through, so its own rules leave scope while it is still running.
3. **No request is a source.** The sources table is files that govern the
   agent. What the user asked for, a plan they approved and the spec the agent
   works from are none of those.
4. **Done is not a turn.** A rule like "add a toggle" is not broken on a turn
   that leaves it for later. It is broken on the turn that claims the work is
   finished without it. The judge's wording has no way to say so.

## Decision

### Every rule is judged against the session

There is one kind of rule. Each is judged at a Stop against the last turn, with
what the session did before it. A turn-only kind was considered and is not
kept. Its one use was that an old break blocks once, not on every later turn.
The new wording gives that. It blocks only on what the last turn did or
claimed. A rule about content, such as "no innerHTML", is seen in the turn
that wrote the content either way.

The system prompt becomes this.

```text
You check the last turn of an AI coding agent's session against one rule.
The last turn starts at the last prompt the user typed and runs to the end of the transcript.
The transcript shows the user's prompts, the agent's tool calls with their inputs, and its replies.
"Earlier in this session" lists what the session did before the last turn.

A prompt the user typed overrides any rule. Doing what the user explicitly asked is never a violation.

Judge only from what the transcript and the earlier turns show. Do not guess.
A rule applies only once the session does the kind of work it covers.
Score it broken only for what the last turn did, or for the last turn saying the work is done without it.
```

The item's last line becomes this. The schema, the bar and Jev's three options
are 0079's.

```text
First say in one or two sentences what the session shows about this rule. Then score each as a whole number from 0 to 100: the rule does not apply yet, or the last turn did nothing it covers; the session follows it; the last turn broke it, or the last turn says the work is done without it.
```

The three scores read different spans on purpose. `followed` and
`not-applicable` read the whole session, because a rule can be kept or not yet
reached across many turns. `not-followed` reads the last turn, because that is
all a block can ask the agent to fix. The scores stay independent. So a long
record of keeping a rule never lowers the score for a break in the last turn.
The bar reads `not-followed` first, as in 0079.

`TURN_JUDGE_PROMPT_VERSION` goes to 7. Both texts are cache-key parts, so no
verdict from 0079's wording replays.

A break from an earlier turn stays in the ledger. A later turn that neither
repeats it nor claims the work is done past it does not block again.

### Earlier in this session, from the transcript

0079 builds its shared block from the ledger. That holds only the turns the hook
parsed, 15 at most in the block. The block is now read from the transcript, the
same file the turn comes from. Every earlier turn with a fact gets a line, newest
last. A line now names five more kinds of fact.

| Fact | Line |
|---|---|
| A skill call | `ran skill identify-ai-tells` |
| An agent spawn | `spawned technical-nonfiction-reviewer, which returned {"route_to":"writer", …` |
| A question to the user | `asked the user` |
| A task ticked | `ticked T014 in specs/001-login/tasks.md` |
| A plan approved | `had a plan approved` |

- **Order.** A line lists commands, files written, rule sources read, skill
  calls, spawns, a question, ticks and an approval, in that order.
- **Agent results.** An agent's result is its first line, clipped to 120
  characters. It is redacted like everything else in the block. A line names
  up to 10 spawns, and a spawn with no result is `spawned <type>`.
- **Ticks.** A task is ticked when an Edit's or a MultiEdit's old string has a
  line `- [ ] <text>` and its new string has `- [x] <text>`. Spec Kit, Kiro and
  OpenSpec all keep tasks this way. The line names the task's leading id, or
  its text clipped to 60 characters when it has none.
- **The budget.** The block keeps 0079's share of the render budget, a quarter
  of what the turn may use. Its oldest lines go first. A marker line says how
  many went, as in `- (turns 1–40: 52 lines left out)`, or
  `- (turn 3: 1 line left out)` for one.

```text
# Earlier in this session

- turn 52: spawned technical-nonfiction-planner, which returned {"status":"done","files_created":["notes/Outline.md"]…
- turn 140: wrote ch3-tests.md; spawned technical-nonfiction-writer, which returned {"status":"done"…
- turn 260: spawned technical-nonfiction-reviewer, which returned {"route_to":"writer","issues":[…
- turn 301: ran npm test; wrote specs/001-login/tasks.md; ticked T014 in specs/001-login/tasks.md
```

The ledger keeps its records, which still say which turns had which sources in
scope. The per-rule history block is unchanged.

### Procedures are rules

A skill's procedure is made of sentences about order, gates, routes,
conditionals, escalation, required steps and the last step. Each is a rule. The
judge reads it against the earlier-turns block, which now carries every pass and
what it returned. No flow grammar is added. Extraction keeps these sentences.
0079's extraction kept them only when one turn could show them.
`RULES_PROMPT_VERSION` goes to 2.

From the repo copy of authoring-workflow and its agents:

```json
[
  { "id": "structure-before-line",
    "text": "Begin line editing only after the structural issues are resolved." },
  { "id": "audit-before-proofer",
    "text": "Run the AI Tell Audit immediately before every Proofer pass.",
    "when": { "tool-used": "Agent" } },
  { "id": "follow-reviewer-route",
    "text": "Send the draft to the pass the Reviewer names in route_to." },
  { "id": "ask-edit-type",
    "text": "If the edit type is not specified, ask the user before editing.",
    "when": { "tool-used": "Agent" } },
  { "id": "verify-citations",
    "text": "Run the Citation Verifier before publication." },
  { "id": "reflect-last",
    "text": "Invoke the meta-reflection skill at the end of the workflow." }
]
```

The copy that ran is the copy judged. The resolution is 0079's, so the 6-pass
plugin copy and the 8-pass repo copy never mix.

**The window under hooks.** This window holds under hooks and in
`tracevals check`. A skill's and a slash command's sources stay in scope from
the first invocation to the end of the session. The skills a skill
calls do not end it. ADR 01015's window still governs batch `run`, which this
proposal does not change.

### What the session was asked

Six formats join the sources table. A second extraction prompt reads them. It
asks what the session is to build or keep, and returns rules in 0079's shape. It
keeps a spec's own ids, such as `FR-001`, `T014` or `1.2`. Its version is
`REQUIREMENTS_PROMPT_VERSION = 1`. It shares the rules cache under a key slot
of its own, so a rules file keeps its entries.

| Format | Files | In scope when |
|---|---|---|
| `prompt` | Every prompt the user typed in the session, in order. A subagent's own run has only its sidechain prompts, so those are its sequence. | Always |
| `plan` | The plan of the last approved `ExitPlanMode`. That is its `plan` input, or else the last file the session wrote under the Claude config directory's `plans/` before the call. | From the approval on |
| `speckit-spec` | `specs/<feature>/spec.md`, `plan.md`, `tasks.md` | Once the session touches a file under `specs/<feature>/` |
| `kiro-spec` | `.kiro/specs/<name>/requirements.md`, `design.md`, `tasks.md` | Once the session touches a file under that directory |
| `openspec-change` | Every `.md` file under `openspec/changes/<id>/`, never under `changes/archive/` | Once the session touches a file under that change |
| `plans` | A file named in `conformance.plans` | Once the session touches it |

- **Prompts.** Extraction reads the typed prompts as one numbered sequence. It
  returns the set that stands now, so a later prompt can change or drop an
  earlier item. The sequence's sha256 is the cache key, so each new prompt
  costs one extraction. A question with nothing to build yields no rules.
- **An approved plan.** An `ExitPlanMode` call is approved when its result is
  not an error, which is how a rejection is recorded. A later approval replaces
  the plan. The trigger's turn number is the call's ordinal in the trace.
- **Specs.** A spec tree holds many features, so only a touched one counts.
  An archived OpenSpec change is done, and never counts.
- **Exclusion.** `conformance.exclude` removes a plan file or a spec file from
  these rows too. Typed prompts are not a file, so no glob removes them.

The rules read like any others.

```json
[
  { "id": "dark-mode-toggle", "text": "Add a dark mode toggle to the settings page." },
  { "id": "keep-public-api", "text": "Do not change the exports of src/index.ts.",
    "when": { "file-access": "src/index.ts" } },
  { "id": "T014", "text": "Write the reset-password test." }
]
```

"Add a dark mode toggle" does not apply yet while the work goes on. It is
followed once the toggle exists. It is broken on the turn that says the work is
done without one. A ticked task is the agent saying that task is done.

0079 left specs out because checking code against them is a different job, with
different false positives. Two things answer that. A spec counts only once the
session touches it. And it blocks only when the last turn breaks it, or calls it
done when it is not.

### Config

Before:

```yaml
tracevals:
  conformance:
    hook: { provider: anthropic, model: claude-haiku-4-5, runs: 1 }
    include: []
    exclude: []
```

After. One key is new.

```yaml
tracevals:
  conformance:
    hook: { provider: anthropic, model: claude-haiku-4-5, runs: 1 }
    include: []
    exclude: []                 # also removes plan and spec files
    plans: [docs/plans/*.md]    # new
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `conformance.plans` | list of globs | `[]` | Files that say what to build, beyond the known spec formats. Each is a source once the session touches it. A folder of plans holds plans for other work, so a file counts only when touched. `include` names files that govern the agent, and those apply on every turn. |

Its errors are the loader's, as for `include`.

### `manni tracevals check <trace>`

It gains no option and no exit code. A source that is not a file prints under
its format's name.

```
$ manni tracevals check ~/.claude/projects/my-book/3b265d00.jsonl
.claude/skills/authoring-workflow/SKILL.md
  ✖ follow-reviewer-route  Send the draft to the pass the Reviewer names in route_to.
      not-followed 88, followed 6, not-applicable 4. The Reviewer routed to the writer at turn 260; this turn ran the proofer. (0.88)
specs/001-login/tasks.md
  ✖ T014  Write the reset-password test.
      not-followed 90, followed 5, not-applicable 3. This turn ticked T014, and no test file exists. (0.90)
prompt
  ✖ dark-mode-toggle  Add a dark mode toggle to the settings page.
      not-followed 86, followed 8, not-applicable 4. This turn says the work is done, and settings has no toggle. (0.86)

Last turn of 3b265d00: 21 rules from 6 sources. 3 broken.
```

The closing lines say "sources" where 0079's said "files", because a prompt is
not a file.

- `Last turn of 3b265d00: 21 rules from 6 sources. None broken.`
- `Last turn of 3b265d00: 21 rules from 6 sources, none apply to this turn.`
- `Last turn of 3b265d00: no rule sources governed it.`
- `Last turn of 3b265d00: nothing happened after the last prompt.`

All four exit 0. Exit 1 still means a rule broken with a confident verdict.

In `--format json`, a `sources` row can carry the six new formats. A `prompt`
row's `path` is `prompt`. A `plan` row's is the plan file, or `plan` when the
plan came only as input. `trigger` says why each is in scope.

```json
{ "sources": [
    { "path": "prompt", "format": "prompt", "trigger": "typed prompts 1-4",
      "rules": 3, "origin": "extracted" },
    { "path": "plan", "format": "plan", "trigger": "approved at turn 210",
      "rules": 5, "origin": "extracted" },
    { "path": "specs/001-login/tasks.md", "format": "speckit-spec",
      "trigger": "touched specs/001-login/tasks.md", "rules": 12, "origin": "extracted" }
] }
```

Nothing else in the report changes.

### Under the hooks

`hooks.json`, the gates, `prepare`, `release` and the model host are 0079's.
Two words of the block reason change. It now says the turn broke rules "from
the files and requests that governed it".

```json
{"decision":"block","reason":"This turn broke 3 rules from the files and requests that governed it. Fix the work, or say why the rule does not apply here, then finish.\n\n<report>"}
```

Every turn has a typed prompt, which is a source, so gate 4 rarely stops a turn
and gate 6 decides.

`prepare` extracts 0079's always-on sources again, once, under the new
`RULES_PROMPT_VERSION`. Prompts and specs are not known at session start, so it
does not extract them.

## Alternatives considered

### A flow grammar

A procedure could declare steps, each matched to a tool call. Then come kinds
of flow rule, such as order, gate, route, exclusion, required and final. Order
would be checked from the transcript, with no model. A draft did this. It is
rejected. It is a language every skill author and every extraction would have
to learn. It still fell back to a model for what no tool call shows. The
judge reads the same sentences, with every pass and its result in front of it.

### Turn rules and session rules

A `span` on each rule could keep 0079's turn rules beside new session rules. It
is rejected. No rule was found that needs the turn alone. The case for one was
an old break blocking again, and the wording handles that.

### A requirements check of its own

Requests could have their own scores, such as claimed, met, not met and
dropped, beside rules. It is rejected. "The last turn says the work is done
without it" is the claim, and a later prompt dropping an item is extraction's
job. One item and one bar serve every source.

### Parsing each spec format

Spec Kit's `FR-001`, Kiro's numbered criteria and OpenSpec's requirement
headings could each be parsed. It is rejected. Extraction keeps those ids, and
three parsers would each need tests for a format that changes on its own
schedule.

## Stress test

1. **A side question mid-task.** The user asks "why is the build slow?" while
   the toggle is open. The answer says nothing about the toggle being done, so
   that rule does not apply to the turn.
2. **The user drops a goal.** "Forget the toggle." Prompt extraction returns
   the set that stands, without it.
3. **A Proofer with no audit.** The earlier-turns block shows the last
   `identify-ai-tells` before the previous Proofer pass. The judge scores
   `audit-before-proofer` broken.
4. **A route ignored.** The Reviewer returned `route_to: writer`, and the next
   spawn is the Proofer. Both are in the block.
5. **An unnamed edit type.** The editor is spawned with no "structural" or
   "line". The turn's own render shows the prompt it was given.
6. **Joining at the Writer.** The session reads `status.md`, which lists the
   Planner pass as done. The rule on running the Planner first does not apply.
7. **A plugin copy beside a repo copy.** The copy that ran is judged, with its
   own passes.
8. **A tick with nothing behind it.** The block names the tick, and the turn
   shows no test written.
9. **An archived OpenSpec change.** It is never a source.
10. **Two Spec Kit features.** Only the one the session touched counts.
11. **A plan replaced by a second approval.** The second plan is the source.
12. **An old break.** Turn 9 broke a rule, and the repair pass did not fix it.
    Turn 12 neither repeats the break nor claims the work is done past it. It is
    not blocked again. The ledger still shows the break.
13. **A long session.** The block drops its oldest lines and says how many. A
    pass from hours ago may fall out, and the judge can still say the rule does
    not apply yet.
14. **Jev.** It gets the same state and three options. Its shorter state limit
    means a shorter block.
15. **A long record, then a break.** A rule was followed on 20 turns, and the
    last turn breaks it. `followed` may score high from the session. The break
    is scored on its own, in `not-followed`, so it still reaches the bar.
16. **A prompt full of chat.** Extraction returns no rules from a prompt with
    nothing to build or keep.

## Consequences

- An agent hears that it skipped what was asked for, or a spec item, or a
  procedure step, in the block 0079 already sends.
- The earlier-turns block is read from the transcript. So a turn the hook never
  saw still counts as history.
- Prompt, plan and spec items cost one extraction per version, the same as
  rules files.
- Rules that apply to every turn grow in number. A session's requests and a
  long skill's procedure each add some.

## Known limits

- Each in-scope rule with no `when` costs one judge call per Stop on a hosted
  model. Requests often have none.
- The block is cut to a quarter of the render budget, so a long session's
  early passes can fall out.
- Order is judged by a model reading the block, never checked from the
  transcript.
- A `Write` that rewrites a whole tasks file is not seen as a tick.
- The judge never sees a tool result. It sees each call and its input, and
  the earlier-turns block adds only the first line of an agent's result. Evidence
  that lives in a result is missed. On a benchmark of labeled turns, no judge
  saw that `npm run setup` ran `npm ci`, because only `package.json` said so.
- Small models invent overrides. "A prompt the user typed overrides any
  rule" is read too freely. On the same benchmark, Qwen3.5-4B took "ship it" as
  leave to force-push, and let the break through. Every typed prompt is now a
  source too, so the precedence sentence carries more weight.
- An agent result shows only its first 120 characters. A route named later in
  the result is missed.

## Open questions

- **Order from the transcript.** Where a step leaves a tool call, order could
  be checked with no model. That needs a step grammar, which this proposal
  rejects for now.
- **TodoWrite.** The agent's own todo list marks items completed. Whether a
  completed todo counts as a claim, as a tick does, is open.
- **Batch `run`.** It still uses ADR 01015's windows and no request sources.
  Whether it should resolve them is open.
- **An off switch.** A repo might want rules files checked and requests not.
  No key turns requests off today.
