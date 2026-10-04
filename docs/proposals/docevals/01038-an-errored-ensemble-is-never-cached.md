---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# An ensemble containing an errored run is never cached

## Context and Problem Statement

The shared inference layer's `runEnsemble` writes its results to the cache unconditionally: `if (cache && cacheKey) cache.set(cacheKey, results)`, with no inspection of what those results are. A `JudgeRun` can carry a `verdict` **or** an `error`, and both are persisted the same way.

That became concrete rather than theoretical while judging this repo's own docs corpus for the first time. Four concurrent judges against one local model exhausted GPU memory. Every run failed in about a millisecond with `A context size of 24 is too large for the available VRAM`, and **65 of 68 ensembles were written to `docs/.moose-docevals-cache/` as cached errors**. The cache files looked perfectly valid. Nothing distinguished them from real verdicts except reading their contents.

## Decision Drivers

- **An error is not a verdict.** It says nothing about the page; it says something about the machine, the network, or the moment.
- Errored runs already count against consensus and push an eval to human-review (a standing invariant). Caching one makes that state *permanent* rather than transient.
- The committed docs cache exists so CI can replay real verdicts with no provider reachable. A cached outage is committed to git and replayed forever.
- The failure is silent and self-concealing: a cached error looks like a cache hit, so the next run is fast, green-ish, and wrong.
- `--no-cache` is the only escape, and nothing in the output would tell you to reach for it.

## Considered Options

- **Leave it.** Accept that transient failures poison the cache and rely on people noticing.
- **Fix it upstream** in `@hawkeyexl/inference` and wait for a release.
- **Decline the write locally**, in moose-docevals' own cache policy.
- Cache errors, but expire them on a timer.

## Decision Outcome

The chosen option is to **decline the write locally**. A `VerdictCache` subclass in [src/judge/cache.ts](../src/judge/cache.ts) drops any ensemble containing a run with an `error`.

This does not violate the standing rule that providers, ensembles, caches, and price tables are the library's. The mechanism stays the library's `JsonCache` and the library's `runEnsemble`; what changes is *moose-docevals' policy about what is worth persisting*, which sits alongside the cache-key composition that already lives here. It is subclassed rather than wrapped because `JsonCache` has private fields and is therefore nominally typed. A structurally identical object does not satisfy `EnsembleOptions.cache`.

The upstream fix is still the right one and should follow. A library that caches an error by default will bite its other consumers the same way. This is not a workaround pending that fix so much as the correct division. The library cannot know whether an error is a property of the request or of the moment. The consumer can decide it never wants to find out the hard way.

### Consequences

- Good, because a transient failure now costs a re-run instead of corrupting a committed artifact.
- Good, because it makes the existing "errors count against consensus" invariant honest. An eval pushed to human-review by errors is re-judged next time rather than pinned there.
- Good, because it removes the failure mode where `--no-cache` is the only fix for a problem nothing names.
- Bad, because a genuinely deterministic error is re-attempted on every run rather than being answered from cache. A prompt that always overflows the model's context is one such error. That is the correct trade, because the expensive case is rare, and silently caching it would hide a real defect.
- Neutral, because nothing about cache *keys* changes, so existing valid fixtures keep replaying.

### Confirmation

`test/unit/judge.test.ts` covers both directions. An ensemble containing an errored run is not replayed, so the second judge re-asks the provider. An ensemble where every run produced a verdict still is replayed. The first of those failed before this change, with the second provider seeing zero requests, the exact signature of a replayed error.

## Pros and Cons of the Options

### Leave it

- Good, because it is the library's behavior and costs nothing to keep.
- Bad, because it already produced 65 poisoned fixtures on the very first real run, before anyone was looking for the problem.
- Bad, because the corruption is invisible in every view except the file contents.

### Fix upstream and wait

- Good, because every consumer benefits and there is one implementation.
- Bad, because it blocks this repo's docs corpus on another repo's release cycle.
- Neutral, because it remains worth doing, and this decision does not preclude it.

### Decline the write locally

- Good, because it is small, testable here, and needs no release anywhere else.
- Good, because "what is worth caching" is genuinely a consumer policy question.
- Bad, because it is a second place where cache behavior is decided. That is exactly the kind of split that let three copies of provider code drift apart. Mitigated by keeping the mechanism upstream and only the predicate here.

### Cache errors with an expiry

- Good, because a repeated deterministic error would not be re-attempted forever.
- Bad, because it introduces time as an input to cache behavior, so a run's result depends on when it happened. That is the property committed fixtures exist to eliminate.
