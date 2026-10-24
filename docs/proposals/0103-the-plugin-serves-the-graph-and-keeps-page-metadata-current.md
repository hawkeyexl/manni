# 0103: The plugin serves the graph and keeps page metadata current

- **Status:** Implemented (#235); superseded in part by [0110](0110-author-facing-content-in-the-graph.md)
- **Serves:**
  - Maya · M24, "Let an agent keep the docs green while it writes them". The
    agent sees every field a page stores, wherever it is stored.
  - Devin · D19, "Serve the docs to an agent with their proof". The plugin
    starts the server, and the graph follows the agent's edits.
- **Depends on:** Three earlier proposals.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) is the plugin
    and its launcher.
  - [0090](0090-served-passages-carry-their-proof.md) is `manni graph serve`,
    `manni graph publish` and the chunk artifact.
  - [0037](0037-sidecar-metadata.md) and the manifests that followed it are
    where a page keeps fields outside itself.
- **Supersedes in part:** [0078](0078-family-check-status-and-claude-code-plugin.md)
  and [0090](0090-served-passages-carry-their-proof.md).
  [What this supersedes](#what-this-supersedes) names the two passages.
- **Touches:** `src/meta/commands/get.ts`, `src/meta/cli.ts`,
  `src/graph/commands/serve.ts`, `src/graph/core/analyze-cache.ts`,
  `plugin/manni/`, `package.json`, and the plugin, serve and reference pages.

## Problem

An agent that reads a page sees its frontmatter and nothing else. In this
repository a page keeps `eval-suite` and `source-of-truth` in
`{page}.meta.yaml`, and its citations in `{page}.citations.yaml`. The a11y CI
page carries 52 citations that a Read never shows.

So the agent learns a field exists when an edit trips `manni check`. By then it
has written a duplicate key into the frontmatter. Or it has rewritten a passage
without knowing which source lines pin it. A field that changes mid-session
leaves it working from what it saw first.

The graph has the same gap one level up. Serving it to an agent takes three
steps by hand. Someone runs `manni graph publish`, installs the MCP SDK, and
registers `manni graph serve` in an `.mcp.json`. The artifact is then a
snapshot. The agent's own edits never reach `lookup` until someone publishes
again and restarts the server.

0090 declined to register the server in the plugin. Its reason was that most
repositories the plugin runs in have no built graph. That is true, and it is
also the problem. A graph that has to be built by hand is a graph nobody
builds.

## Worked example

Maya opens Claude Code in this repository. The plugin is on through
`.claude/settings.json`, and `docs/public/graph/` holds no `chunks.json`.

Claude Code asks her once to approve the plugin's server, as it does for a
project `.mcp.json`. The server connects at once. Its log reads as follows.

```text
manni: publishing the graph before serving it: docs/public/graph/chunks.json does not exist.
manni: published the graph in 11.3s.
manni: serving lookup, retrieve, traverse and impact over stdio from docs/public/graph/chunks.json.
```

She asks which page explains the plugin's hooks. The agent calls `lookup`,
which answers with the plugin page's passages and their pins.

The agent reads that page. Beside the file it receives the page's metadata.

```text
Metadata for docs/src/content/docs/family/claude-code.mdx, from the page and its sidecars:
{"title":"Keep an agent's docs green", … ,"eval-suite":"family","source-of-truth":[…], …}
```

It fixes a typo in the body and reads the page again. Nothing is added, since
no field changed. Maya then changes `review-interval` in the sidecar. On the
agent's next read it receives the new values, marked as replacing the old.

```text
Metadata for docs/src/content/docs/family/claude-code.mdx changed since it was last given here. This replaces it:
{"title":"Keep an agent's docs green", … ,"review-interval":"P90D", …}
```

The agent calls `lookup` again. The server sees the checkout changed,
publishes again, and answers from the new graph.

Later she opens a repository with `collections:` and no `graph:` section. The
server publishes into the plugin's data directory and serves the same four
tools. `git status` there shows nothing new.

## Decision

### 1. The plugin registers one MCP server, gated on collections

`plugin/manni/.mcp.json` registers `graph`. Claude Code starts it with every
session, as `plugin:manni:graph`. Its command is
`plugin/manni/hooks/graph-server.mjs`, which reads the project's config.

- With `collections:` and `graph:`, it runs `manni graph serve --publish`.
- With `collections:` and no `graph:`, it runs the same with `-i` set to
  `${CLAUDE_PLUGIN_DATA}/graph/<project hash>/`. The hash is the first 16 hex
  digits of the SHA-256 of the project directory. Without that variable, it
  uses the OS temporary directory instead.
- Without `collections:`, it answers the protocol itself with no tools.

Graph reads its pages from `collections:`, so that is the gate. A server only
adds tools. It never fails a check or blocks an edit, so the rule to gate only
what is set up does not forbid it. That rule is about blocking. A repository
without a `graph:` section still gets nothing written into its tree. Its
artifact goes outside it.

The zero-tool answer carries no `instructions`. Those would reach the model's
context in every session of every repository without collections.

### 2. `serve --publish` connects first

An MCP client gives a server 30 seconds to answer `initialize`. A publish of
this repository's 259 pages takes 11.3 seconds with a warm cache, and 13.0
cold. The time grows with the page count, so a thousand pages would miss the
deadline.

So `--publish` answers the handshake first and publishes behind it. The tool
list needs no artifact, since the four schemas are fixed. A call made during a
publish waits for it. The publish starts with the session, so the agent's
first call usually finds it done.

### 3. When to publish

At start, `--publish` publishes in four cases, and each prints its reason.

- The artifact cannot be served.
- It records no commit.
- Its commit is not `HEAD`.
- The working tree has changes.

Before each call, it compares a fingerprint of the checkout with the one taken
when the last publish began. The fingerprint is `HEAD` plus the path, size and
modification time of each file `git status` lists. A difference republishes
and then answers. An edit made during a publish is caught by the next call,
because the fingerprint predates it.

Outside git there is no fingerprint. The server publishes at start and serves
that artifact for the session.

With `--publish`, `-i` names the directory publish writes and serve reads.
`-g` is refused, because publish writes the graph into that same directory.

### 4. The analyze cache ignores itself

Every build writes `.manni/graph/analyze-cache/`, one file per page. In a
repository that never set up graph, that is the only file a publish writes
inside the tree. So the cache writes a `.gitignore` of `*` when it creates its
directory, and leaves an existing one alone.

The ignore stays inside the cache. A `.gitignore` for all of `.manni/` would
hide `.manni/docevals/reviews.yaml` and the golden sets, and a project may
commit those.

### 5. The SDK becomes an optional dependency

`@modelcontextprotocol/sdk` was an optional peer, which npm never installs. A
project's own copy of manni therefore could not serve. It moves to
`optionalDependencies`, so every install carries it. An install with
`--omit=optional` still leaves it out, and serve still says how to add it.

### 6. `meta get` prints every field, and names each file's collections

`--all-fields` prints every field a file stores, in the page and its
sidecars, plus each field a derive source supplies. With `--no-derived` it
prints the stored fields alone. Every positional is then a path.

Every JSON entry gains `collections`, the configured collections the file
belongs to. It is empty for a path outside them and for standard input.

The Read hook needs both. It needs every stored field of a member page, and
those are the two facts it lacks. They are also what a person asks for at
the command line, so they belong to `get` rather than to the plugin.

### 7. The Read hook is a plugin script over `meta get`

A PostToolUse hook on `Read` runs `plugin/manni/hooks/page-metadata.mjs`. The
family's hook handling is untouched.

- A file meta cannot read never starts manni.
- Otherwise the script runs `manni meta get --all-fields --no-derived -f json`
  on the file.
- It replies only for a collection member that stores a field.
- It hashes the values and compares the hash with the one this context last
  received. A first read replies, and so does a changed one. An unchanged one
  replies nothing.

Each agent keeps its own hashes, since a subagent has its own context. A
compaction drops what the model was told, so the hook forgets the session's
hashes when Claude Code reports one. Context once given cannot be withdrawn,
so a changed reply says that it replaces the earlier one.

The values are the stored ones, ciphertext included. Inline statements are
left out, because they sit in the body the Read just showed.

### 8. A served answer fits an agent's context

The first live session showed the cost. One `lookup` on this repository
answered 165,024 characters, about 47,000 tokens. Claude Code saves a tool
result over 25,000 tokens to a file, so the agent had to read its own answer
back.

Passage text was only about 22,000 of those characters. The rest was four
things.

- The walk's diagnostics.
- A proof record on each passage the budget had already emptied.
- A metadata record for every page the walks touched.
- The edges.

So `graph serve` now compacts every answer it sends, for all four tools.

- `trace` keeps `entry`, `withheld` and `filtered`. The walk's hops,
  exclusions and resolutions are left out.
- A passage with no text carries no `provenance`. The proof travels with the
  text it vouches for.
- `pages` names only the pages of passages that carry text.

Then it caps the answer at `graph.serve.maxChars`, 40,000 characters by
default.

```yaml
graph:
  serve:
    maxChars: 40000
```

Past the cap, the answer gives things up in a fixed order, and stops as soon as
it fits.

1. Impact passages become references, deepest first.
2. Traversal passages do the same.
3. Impact edges go, from the end.
4. Traversal edges go, from the end.
5. Matches become references, lowest rank first.

A reference keeps its node, title, page and lines, with `truncated: true`, and
its section says it was cut. The matches come last because they answer the
question. On this repository the edges alone outweigh the matches, so cutting
edges after every passage would have emptied the first match first.

The CLI and the runtime keep the full result. `graph lookup -f json` is still
the way to see every hop, and a script's `LookupResult` loses nothing. The key
has no flag, because `--max-chars` already names the passage-text budget on
`retrieve` and `traverse`.

## Known limits

- Any change `git status` lists republishes, code included. A graph call right
  after a code edit waits for a publish.
- Every Read of a document costs one `meta get`, about 0.4 seconds here.
- Two sessions in one repository can publish into one directory at once.
- Context over Claude Code's limit of 10,000 characters goes to a file. The
  model gets the path and a preview. The page's own fields come first, so the
  preview shows them.

## Stress test

### 1. A repository with no manni at all

There is no config, so the server answers with no tools and the Read hook
replies nothing. No manni process starts for the server, and none for a Read.

### 2. manni's own checkout before a build

The launcher runs nothing in an unbuilt checkout. The server then answers with
no tools rather than failing to connect.

### 3. A page read in two parts

A Read with an offset still counts. The first part brings the metadata, and
the second brings nothing new.

### 4. A sidecar created after the first read

The hook runs `get` on every Read, so a new sidecar's fields arrive on the next
one. A check of file times alone would have missed it.

## Rejected

- **Publish in the script before serving.** A large corpus misses the start
  deadline, and the server never connects.
- **Publish to the default `graph/` without a `graph:` section.** It leaves
  untracked files, and it can collide with a directory the project owns.
- **A file watcher in the server.** A check at call time does the same with
  fewer parts.
- **Skip `get` when file times are unchanged.** It needs a map from field to
  file, and it misses a new sidecar.
- **Derived values in the Read context.** They spawn git, and some reach the
  network, on every read.
- **The Read hook over `meta query`.** It returns the same merge, and leaves
  the gap in `get` that a person also meets.

## Open questions

- Should the server republish in the background, so that a call never waits?
- Should the fingerprint narrow to collection files and the sources they cite?
- Should the context say which file each field lives in?

## What this supersedes

- In 0078, "The plugin has no subagents, no MCP server and no `userConfig`."
  The plugin now has one MCP server.
- In 0090's rejected alternatives, "Register the server in the plugin." The
  plugin registers it, gated on collections, and publishes what is missing.
- In 0090's section 9, "Nothing is dropped" and "The budget trims text only",
  for answers sent over MCP. Decision 8 compacts and caps them. The CLI and
  the runtime still return the whole result.

## Verification

- `manni meta get --all-fields` on the plugin page prints its fields and its
  sidecar's. Its JSON names `site` under `collections`.
- `graph-server.mjs` over this repository with no artifact publishes, serves
  four tools, and answers `lookup`. A touched page republishes on the next
  call.
- Over a copy of a fixture with collections and no `graph:`, it serves four
  tools and leaves `git status` empty.
- `page-metadata.mjs` on the plugin page replies once, replies again after a
  sidecar edit, and stays silent for a source file.
