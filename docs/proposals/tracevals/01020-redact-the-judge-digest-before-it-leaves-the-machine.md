---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Redact the judge digest before it leaves the machine

## Context and Problem Statement

`src/judge/render.ts` builds the only trace-derived text that ever leaves this machine, and it
truncates but never redacts. Full user prompts, assistant messages, and tool-call inputs go verbatim
to whatever provider is configured. For the default `claude-cli` and for `anthropic` and
`openai` alike, that is a third-party API.

A session transcript is a good place for a secret to be sitting. It might be a `Bash` input carrying
an `Authorization` header, an `.env` file pasted into a prompt, or a key echoed into a message. For a
platform team, "we cannot send session traces to an external API" is a blocking objection. The
config offers nothing to answer it with.

## Decision Drivers

- The objection is real and currently unanswerable. Something has to change, even if only the
  documentation.
- Whatever is built must not overclaim. Pattern matching cannot catch an arbitrary secret, and
  saying otherwise is worse than saying nothing.
- The rendered digest is a **judge cache-key component** (`sha256(renderedTrace)` in
  `src/judge/cache.ts`), so anything that rewrites it has to be reasoned about, not just added.
- Truncation and redaction interact, and whichever runs second can undo the other's guarantee.
- A user must be able to answer "what did you send?" from the docs, redaction on or off.

## Considered Options

- A `judge.redact` pattern list applied in `renderTrace`, with built-in defaults
- Document precisely what leaves the machine, and make `--deterministic-only` the answer
- An entropy/heuristic secret scanner rather than a pattern list
- Redact everything not on an allowlist (send only tool names and verdict-relevant metadata)

## Decision Outcome

The chosen option is **a `judge.redact` pattern list applied inside `renderTrace`, with built-in
defaults, plus the documentation the minimum-viable option would have produced, written anyway.** The
documentation is not the alternative to the feature; it is part of it. `--deterministic-only`
remains the only guarantee, and is stated as such.

**Built-ins are a floor, not a default the config replaces.** `judge.redact` entries are applied
*after* the built-in shapes and never instead of them. A project adding one pattern of its own must
not silently lose the whole floor. That is the same reasoning that makes `--require` additive
([ADR 01017](01017-load-grader-plugins-named-in-the-config.md)). The built-in set covers vendor key
prefixes (`sk-…`, `AKIA…`, `gh[pousr]_…`, `xox…`, `AIza…`, JWTs), `Bearer`/`Basic`/`Token` auth
values, and private-key blocks. It also covers secret-named assignments in both shell
(`FOO_TOKEN=…`) and JSON (`"apiKey": "…"`) form. The JSON form matters most, because a tool input
renders as JSON.

**Everything is replaced, never deleted.** A match becomes a labelled placeholder, so the judge can
still see that a credential was used, which is often the adherence question. The labels are
`[redacted:api-key]`, `[redacted:auth-token]`, `[redacted:secret-value]`, and `[redacted]` for a
configured pattern. `Bearer [redacted:auth-token]` keeps the scheme; `AWS_SECRET_ACCESS_KEY=` keeps
the variable name.

**Redaction runs before truncation.** Each block is scrubbed and then clipped, so a per-block cap
can never land mid-secret and ship the surviving prefix. The assembled timeline is scrubbed once
more before the head/tail cut, which costs nothing, because the placeholders are inert and
redaction is idempotent. That second pass covers the parts assembled outside `clip`, such as tool
names and branch labels. It also covers anything a later change adds to that loop without
remembering to scrub it.

**A pattern that will not compile is rejected at config load**, by `parseConfig()`, not at the
moment a digest is about to be sent. A silently dropped pattern is a silent leak.

### What actually leaves the machine

Stated once here, and mirrored in `docs/src/content/docs/judge/index.mdx`. With
`--deterministic-only`, **nothing**: no provider is constructed. Otherwise, per judged eval, one
request containing:

| Part | Redacted? |
|---|---|
| The eval's `assertion`, `evidence`, and `examples` | No, this is authored text from the artifact |
| The source artifact's body, capped at 8 000 chars | **No**, see below |
| Session header, with source, model, `cwd`, git branch, turn count, skill/agent names | Yes |
| User prompts and assistant text in the eval's window | Yes |
| Tool **names** and tool **call inputs** | Yes |
| Tool **results**, file contents, command stdout/stderr | Not sent at all, since `renderTrace` does not render them |

The **artifact body is deliberately not redacted**. It is the evaluating project's own instruction
file, deliberately authored and usually committed. Its exact text is also a cache-key component
(`sha256(planFingerprint)`), so redacting it would make two redaction configs share one cache slot
while producing different prompts. A secret in a `SKILL.md` is a problem to fix in the `SKILL.md`.

### Cache implications

The digest is hashed into the cache key, so the cache does the right thing without a new key
component:

- A redacted digest differs from the unredacted one, so it gets **its own cache slot**. A verdict
  formed on unredacted text can never be replayed for a redacted run, and vice versa.
- Changing `judge.redact` changes the digest and therefore the key, **automatically**, with no
  version to bump.
- A pattern that matches nothing leaves the digest byte-identical, so the **existing entry is still
  hit**. Adding a precautionary pattern costs nothing.
- `PROMPT_VERSION` is *not* bumped: the prompts in `src/judge/prompt.ts` are unchanged. Redaction
  changes the content, and the content is already keyed.

One consequence is worth stating. Turning redaction on invalidates the cached verdicts for every
trace that contained a match, because those verdicts were formed on different text. That is correct,
not a regression.

### Honest limits

- **Pattern matching is best-effort.** It recognizes shapes. A secret that looks like ordinary prose
  is not caught, and no pattern list will catch it. That covers an internal hostname, a customer
  name, and a password with no surrounding assignment.
- **`--deterministic-only` is the only guarantee.** It constructs no provider and sends nothing.
- Over-redaction has a cost too: `AWS_*` is redacted wholesale, so `AWS_REGION=us-east-1` goes as
  well, and an assertion about a region cannot then be judged. That is deliberate, because the
  alternative is enumerating which AWS variables are safe.
- Redaction is applied to the digest, not to the trace file, the report, or the history file. This
  tool never writes trace files at all; the report and history hold verdicts and eval names, not
  transcripts.
- The judge cache under `.moose-tracevals/cache` stores provider *responses*, keyed by a hash. The
  digest itself is not written there.

### Confirmation

- `test/unit/redact.test.ts` covers each built-in shape with an obviously fake credential. It also
  covers idempotence, non-interference with ordinary prose, additive config patterns, and rejection
  of an uncompilable one.
- `test/unit/render.test.ts` covers redaction across messages, assistant text, and tool inputs. It
  covers redaction-before-clipping with a cap deliberately set to land mid-key, and byte-identity
  for a trace with nothing to redact.
- `test/unit/judge.test.ts` pins both cache directions: a redacted digest takes a different key, and
  a pattern that matched nothing keeps the same one.
- `test/unit/config.test.ts` pins the empty default and the load-time rejection.

## Pros and Cons of the Options

### A `judge.redact` pattern list with built-in defaults

- Good, because it answers the objection with a behavior rather than a paragraph.
- Good, because the built-ins mean the common accident is covered with no configuration at all.
- Good, because the cache falls out correctly with no new key component.
- Bad, because it can be mistaken for a guarantee. Mitigated by saying, in the ADR, the schema
  description, and the docs, that it is not.

### Documentation only, with `--deterministic-only` as the answer

- Good, because it is honest and cannot overclaim.
- Good, because it is free.
- Bad, because "turn off the judge" is not a workable answer for anyone who wants judged evals. It
  removes the feature rather than making it usable.

### An entropy-based scanner

- Good, because it catches high-entropy secrets no pattern anticipated.
- Bad, because base64 blobs, hashes, and minified code are all high-entropy, so the false-positive
  rate would gut the transcript the judge reads.
- Bad, because it is a whole subsystem, and the pattern list can be extended toward it later.

### Allowlist everything

- Good, because it is the only option that approaches a guarantee.
- Bad, because what is left is not a transcript, and an adherence judge with no transcript has
  nothing to judge. `--deterministic-only` already occupies this end of the trade-off, exactly.
