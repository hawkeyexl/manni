---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# A turn budget replaces the cost budget, and cost accounting is removed

## Context and Problem Statement

moose-docevals bounds LLM spend with a dollar ceiling. That is `--max-cost` on `run` (`src/cli.ts:129`) and on `fill` (`src/cli.ts:207`), plus the config keys `judge.max-cost-usd` and `fill.max-cost-usd`. A per-provider `pricing` override exists so the estimate behind that ceiling is accurate.

Two problems, and they are different in kind.

**The ceiling cannot be enforced.** `src/judge/judge.ts:93` checks `spentUsd >= maxCostUsd` *before* calling `runEnsemble`, and adds the cost *after* it returns, at `:128`. Judging runs under a bounded-concurrency pool sized by `config.defaults.concurrency`, which defaults to 4 (`src/core/config.ts:395`). Up to `concurrency` evals can clear the check while `spentUsd` is still the pre-dispatch figure, and then all of them spend. The overshoot is up to `concurrency × cost-per-eval`: at defaults, four evals past a ceiling that had already tripped. A ceiling that is approximate in the direction of spending more is not a ceiling.

**A dollar figure is the wrong thing to ask a user to predict.** It needs a price table, which goes stale on every provider price change and which this repo does not own. It is meaningless for `claude-cli`, which reports no usage at all, and for self-hosted OpenAI-compatible endpoints. And it makes the user convert "how much work should this do" into dollars *before* the run, just to say it at all.

The sibling tool docmeta hit the same wall and already moved. Its CHANGELOG records `--max-cost-usd` and `fill.maxCostUsd` as removed, replaced by `--max-turns` / `fill.maxTurns`. The documented behavior is "Stop after this many inference calls. Counts **calls, not files**: a long document is split across several." No default, positive-integer floor. `moose.config.yaml` is a shared family config ([ADR 01008](01008-rename-to-moose-docevals-and-share-one-family-config.md)); two tools reading the same file should not bound work in two vocabularies.

## Decision Drivers

- **The check and the debit sit on opposite sides of the call.** Any budget tallied *after* dispatch is unenforceable under a worker pool, whatever unit it is denominated in.
- **Turns are knowable before dispatch; dollars are not.** The number of calls an eval will make is `runs`. Its cost is a token prediction multiplied by a price table.
- **The price table is not ours.** `$defs/pricing` (`src/core/config-schema.json:122`) exists purely to patch a table that goes stale. Its own `description` warns that a half-filled override prices those tokens as free. That under-reports cost and lets `max-cost-usd` ride past the ceiling it exists to enforce.
- **Two providers report no usage at all.** `claude-cli` and self-hosted endpoints get a dollar figure of zero, which reads as "free" rather than "unmeasured".
- **One family, one vocabulary.** docmeta already ships `--max-turns`; a shared config file with two spellings of "do less work" is a papercut on every page that documents either tool.
- **A cache hit must not consume budget.** The docs corpus replays committed cache fixtures with no API key ([ADR 01004](01004-test-the-docs-through-moose-docevals-itself.md)). A budget that counted cached work would bound that run by a number with nothing to do with it.

## Considered Options

- **Turn budget, cost accounting removed.**
- **Fix the cost ceiling in place**, claiming estimated cost before dispatch.
- **Keep both a cost ceiling and a turn budget.**
- **Keep cost reporting, drop only the ceiling.**

## Decision Outcome

The chosen option is to **replace the cost budget with a turn budget, and delete cost accounting entirely.**

**Added.** `--max-turns <n>` on `run` and `fill`; config `judge.max-turns` and `fill.max-turns`. Semantics are copied from docmeta verbatim. Stop after this many inference calls, *calls, not pages*. No default, so an unset budget is unbounded. Floor of 1, validated through the `parseIntArg` already at `src/cli.ts:49`, which rejects anything below 1 and routes through `fail()` for exit 2. No new validation code.

`calibrate` is deliberately left without the flag, though it judges and therefore spends. It calls the judge once per golden case in a loop, and the counter lives inside a single judge invocation. A `--max-turns` there would silently mean *per case* rather than per run. A cap that reads as a total and is not one is worse than no cap. Giving `calibrate` a real budget means first batching its cases into one judge call, which is a change to that command rather than to this one.

**Removed.** `--max-cost` on both commands. `judge.max-cost-usd` and `fill.max-cost-usd` (`src/core/config-schema.json:82` and `:103`). `EvalResult.costUsd` (`src/types.ts:77`) and `RunReport.cost.totalUsd`. The `pricing` key on both provider blocks and the `$defs/pricing` block behind it. `normalizePricing` and the `Pricing` type (`src/core/config.ts:76` and `:18`). The `costOfRuns` / `costOfUsage` / `pricingFor` imports in `src/judge/judge.ts` and `src/commands/fill.ts`. `FillReport.costUsd`. And the dollar figure from the human and markdown reporters (`src/reporters/human.ts:99`, `src/reporters/markdown.ts:63`).

**Renamed.** `RunReport.cost` becomes `RunReport.usage`. Once `totalUsd` is gone that block holds `totalTokens`, `cachedEvals`, and `judgedEvals`. Those are counts, not money, and leaving it called `cost` invites the next reader to put a dollar field back into it. The token counts stay: they are what the response cache is judged by, and they cost nothing to keep.

Two properties make a turn budget better than a patched cost ceiling, rather than merely a different unit bolted to the same mechanism.

**A turn budget is knowable before dispatch, so it can be claimed rather than tallied.** The number of inference calls an eval will make is `runs`, the ensemble size. Config fixes it, and it is readable before the provider is touched. That is not an estimate; it is the loop bound. So a worker can *claim* its turns from the budget up front and dispatch only if the claim succeeds. That makes the cap exact however many workers race for it. The overshoot above is not mitigated, it is structurally absent: there is no window between the check and the debit, because the debit *is* the check. Cost never had this property and could not be given it, since a call's cost is unknown until its response comes back.

**A cache hit is not a turn.** `JudgeRun.cached` already exists in the inference library, and `costOfRuns` already skips cached runs. Cost accounting had this part right, and turn accounting inherits it rather than reinventing it. `src/commands/fill.ts:210` already consults `cache.get(key)` before its budget check at `:213`; that ordering is the shape both paths keep. The consequence is load-bearing. **A fully-cached run must complete under `--max-turns 1`.** The docs corpus replays committed cache fixtures with no API key, and depends on exactly that.

### Consequences

- **Breaking, and loudly so.** A config carrying `max-cost-usd` now fails validation rather than being quietly ignored: `additionalProperties: false` under the `docevals:` namespace rejects it and exits 2. Loud was not sufficient on its own, though. Ajv reports that violation against the *parent* object, so the message was only `/docevals/judge: must NOT have additional properties`. The reader was left to diff their file against the schema to work out which key had died. This ADR therefore also changes the Ajv error formatting in `parseConfig` to read `e.params.additionalProperty` and name it, as `/docevals/judge: unknown key "max-cost-usd"`. The reason is the one already written above `findPreKebabKeys` in that file: a migration error that makes you guess is one people work around. The fix is general rather than special-cased to `max-cost-usd`; every unknown key under `docevals:` is now named. That is why this failure mode gets pinned in a test rather than assumed. The whole value of a loud break is that it stays loud.
- **A truncated run says so.** Skipped evals are excluded from a suite pass rate (`graded = passed + failed + errored` in `src/core/engine.ts`). Exhausting the budget would otherwise exit 0 having judged less than it was asked to, green with coverage quietly missing. The engine now raises a warning-level problem naming how many evals went unjudged. Warning and not error deliberately: the cap was asked for, so tripping it is expected and must not fail an otherwise-clean build. Going quiet about it is the part that would be wrong. The dollar ceiling had the same hole and never reported it.
- **A public output contract changes.** `--format json` serializes the entire report (`src/reporters/json.ts`), so renaming `cost` to `usage` and dropping `totalUsd` breaks anyone parsing it.
- **Users lose the dollar figure.** That is accepted deliberately. It was only ever as good as a price table this repo does not own, and it was absent for `claude-cli` and self-hosted endpoints. It was also rendered to four decimal places, which reads as authoritative in every case. That includes the cases where it was zero because nothing had been measured.
- **The judge and fill caches remain the primary cost control**; the turn budget is a backstop, not a substitute for them.
- **Good.** One fewer config subtree to keep correct, and one fewer thing that can become wrong without anyone editing a file.

### Confirmation

Tests assert several things. `--max-turns 2` stops after two *uncached* calls and marks the remaining targets skipped with a turn-budget reason. A fully-cached run completes under `--max-turns 1`. Concurrent workers never exceed the cap, which is precisely the regression the old ceiling could not have caught. A config carrying `judge.max-cost-usd` or `fill.max-cost-usd` exits 2 with a message containing the dead key name, not just the parent object path. The JSON report carries `usage` and no `totalUsd`. The docs corpus continues to verify with no API key, which is the end-to-end form of the cache-hit property.

## Pros and Cons of the Options

### Turn budget, cost accounting removed

- Good, because the budget is claimable before dispatch, so the cap is exact under concurrency instead of approximate in the expensive direction.
- Good, because it deletes the price table, the `pricing` override, and `normalizePricing`. Those are three things that could become wrong without anyone touching them.
- Good, because it is docmeta's spelling, in a config file both tools read.
- Neutral, because a turn is not a uniform amount of money: a long page and a short one each cost one turn. The user is bounding *work*, and the tool can report turns honestly where it could never report dollars honestly.
- Bad, because it breaks existing configs and the JSON report shape.

### Fix the cost ceiling in place

- Good, because it keeps a unit users already understand.
- Bad, because claiming cost before dispatch requires an *estimated* cost, which means a price table plus a token prediction. That is strictly more machinery in service of a less honest number.
- Bad, because the estimate stays wrong for `claude-cli` and self-hosted endpoints, where usage is unavailable at every point in the call, not just before it.
- Bad, because it leaves the family config with two vocabularies for one concern.

### Keep both a cost ceiling and a turn budget

- Good, because nothing breaks.
- Bad, because it is two knobs for one concern, and the cost half keeps every defect described above.
- Bad, because it adds a question neither knob answers alone: which ceiling tripped, and how far the run was from the other one.

### Keep cost reporting, drop only the ceiling

- Good, because it removes the unenforceable half while keeping the number people like seeing.
- Bad, because that number is the same defect in a quieter form: stale prices, and a confident `$0.0000` for every `claude-cli` run.
- Bad, because keeping the report means keeping the price table and the `pricing` override that exist only to feed it, so almost nothing is actually removed.
