# 0038: a URL form of `sidecars[].file`

- **Status:** Proposed
- **Serves:** Devin · D1, D2 · Maya · M1
- **Depends on:** Four earlier proposals.
  - [0037](0037-sidecar-metadata.md) defines the manifest, its rules, and the read-only first increment this extends.
  - [0008](0008-remote-schema-durability.md) settled how a remote input behaves under `--offline`, timeouts, and retry.
  - [0014](0014-empty-input-is-not-success.md) makes a fetch that fails an error, never a green run over nothing.
  - [0015](0015-schema-trust-boundary.md) places a config-named URL on the operator's side of the trust line.
- **Relates to:** [0017](0017-fill-egress-and-bounds.md), the one place manni already sends bytes off the machine, and says what.
- **Touches (planned):** `src/meta/core/{sidecars,config}.ts`, a new `src/meta/core/sidecar-fetch.ts`, `reference/configuration.mdx`, `set-up/private-metadata-sidecar.mdx`, `test/sidecars.test.ts`, `test/helpers/schema-server.ts`

## Problem

0037 puts the private manifest on disk next to the private config. That is
the right layout, and it is not the only one people run. A docs team may
keep the manifest in a repository the CI job does not check out. A platform
team may serve one manifest to several docsets from a single place. Today
each of those needs a shell step before every run:

```bash
gh api -H "Accept: application/vnd.github.raw" \
  "repos/OWNER/REPO/contents/docs-meta.yaml?ref=main" > docs-meta.yaml
```

That works. It is also the shape 0008 § 1 called out for schemas. A
machine-local copy nobody else can see, made by a command the config does
not record. The config says `file: ./docs-meta.yaml` and is lying about where
the data comes from. A reader of the config cannot tell the manifest is
remote. A reader of the workflow cannot tell which config key the download
feeds. When the step is missing, the run reports a missing file, which is
true and unhelpful.

## Design

`sidecars[].file` accepts an `https://` URL. The manifest is fetched at the
start of every run, parsed exactly as a local manifest is, and merged by
the same rules. Nothing downstream of the loader changes.

```yaml
meta:
  sidecars:
    - file: https://raw.githubusercontent.com/org/private-docs/main/docs-meta.yaml
      keys: [source, jira]
      tokenEnv: PRIVATE_DOCS_TOKEN
```

### The rules

1. **A remote manifest is fetched every run.** There is no cache and no
   TTL. The schema cache exists for durability, because a schema is a
   contract that changes rarely. A manifest is data that changes with every
   page, and a stale copy validates the corpus against the wrong values.
   0008 § stress test 3 already said a TTL is not a correctness mechanism.
   Here it would be an incorrectness mechanism.
2. **A fetch that fails is exit 2, naming the URL and the status.** 0014
   applies: the manifest is a config-supplied input, and one that cannot be
   read is the run's problem. A 401 or 403 says the token is wrong. A 404
   says the URL is. A network error says so. None of them are silence.
3. **`--offline` refuses a remote manifest, exit 2.** The operator asked for
   no network and a required input is only reachable over it. There is no
   cached copy to fall back to, by rule 1, and inventing one would be a lie
   about freshness.
4. **The credential lives in the environment, never in the config.**
   `tokenEnv` names an environment variable. Its value is sent as
   `Authorization: Bearer <value>` and nowhere else. The value never appears
   in a message, a notice, a report, or a cache key. A URL carrying userinfo
   (`https://user:secret@host/…`) is a config error at parse time, because
   the URL is printed in diagnostics and the secret would print with it.
5. **A redirect keeps the token only on the same origin.** A cross-origin
   redirect is followed without the header, the way browsers and `curl`
   behave. A manifest that lands somewhere the token does not reach then
   fails as a 401, which rule 2 reports.
6. **The URL is operator config, so it is trusted as such.** 0015 § 5: the
   person who can edit the config is not an attack surface. There is no host
   allowlist for a manifest URL, and `schemaTrust` does not apply to it.
   `$schema` inside the fetched manifest is still refused, exactly as 0037
   rule 1 refuses it in a local one.
7. **Attribution reports the URL as the file.** A finding on a fetched value
   carries the URL and the manifest line in `FieldError.file`. Pretty,
   GitHub and JUnit print it. SARIF drops that finding with the existing
   outside-the-repository notice, since a URL is not a repository-relative
   location. The finding is still filed under the document and still counts.
8. **Same bounds as the schema fetch.** The same timeout, the same body
   cap, and the same single narrow retry 0008 § stress test 4 added. A
   manifest is smaller than most schemas, and the bounds exist for the same
   reason.

### Interface

| Key | Type | Required | Meaning |
|---|---|---|---|
| `sidecars[].file` | `string` | yes | A path relative to the config, as today, or an `https://` URL. `http://` is refused: a bearer token over plaintext is a leak. |
| `sidecars[].tokenEnv` | `string` | no | Name of an environment variable whose value is sent as a bearer token. Allowed only when `file` is a URL; on a path it is a config error, because it would do nothing. |

```ts
export interface SidecarConfig {
  file: string;
  keys: string[];
  /** Environment variable holding the bearer token for a URL `file`. */
  tokenEnv?: string;
}

/** Fetch one remote manifest. Resolves to its text; throws `DocmetaError`. */
export function fetchSidecar(
  url: string,
  opts: { tokenEnv?: string; timeoutMs?: number; offline?: boolean },
): Promise<string>;
```

`loadSidecars` decides by `classifyRef(file).kind === "url"` whether to read
or fetch, and hands either text to the same parser. `SidecarIndex`,
`mergeSidecars`, and `orphanEntries` are untouched.

### Which hosts this covers

Both hosting CLIs already fetch a private file with a stored login. Both
hosts also accept a bearer personal token on their raw-file routes, so one
`tokenEnv` covers each without a vendor branch:

| Host | URL shape | Token |
|---|---|---|
| GitHub | `https://raw.githubusercontent.com/OWNER/REPO/REF/PATH` | a fine-grained PAT with contents read, or `GITHUB_TOKEN` inside the same org |
| GitLab | `https://gitlab.com/api/v4/projects/ID/repository/files/PATH/raw?ref=REF` | a project or personal access token with `read_repository` |

The set-up page shows both, and says which token scope each needs.

### The ladder

```console
$ manni meta validate                      # PRIVATE_DOCS_TOKEN set
✓ public/docs/guides/auth.md
✗ public/docs/guides/billing.md
    /jira  must match pattern "^PLAT-\d+$"  (https://raw.githubusercontent.com/org/private-docs/main/docs-meta.yaml:6)  [./schemas/private.json]
                                                                                                       exit 1

$ PRIVATE_DOCS_TOKEN= manni meta validate
manni: Sidecar manifest https://raw.githubusercontent.com/org/private-docs/main/docs-meta.yaml could not be fetched: HTTP 404 (a private file answers 404 without a valid token).
                                                                                                       exit 2

$ manni meta validate --offline
manni: Sidecar manifest https://raw.githubusercontent.com/org/private-docs/main/docs-meta.yaml is remote and the run is offline. Vendor it to a path, or drop --offline.
                                                                                                       exit 2
```

## Options

- **A bearer token from a named environment variable.** Chosen. One
  mechanism, no vendor code, and the token never touches the config file.
  It is how every CI system already hands secrets to a step.
- **Delegate the fetch to `gh` or `glab`.** Rejected. It ties manni to two
  vendors' CLIs, their auth stores, and their argument grammars, and it
  spawns a process for something `fetch` does in one call. The CLIs remain
  the right tool for the hand-run workaround, which the docs keep.
- **A `headers:` map with environment substitution.** Deferred. Both hosts
  accept a bearer token, so no header beyond `Authorization` is needed today.
  It returns the day a host needs a custom header. It must not be built
  speculatively, because every header is another place a secret can land.
- **A `manni meta sidecars vendor` subcommand.** Deferred. The `gh` one-liner
  above is vendoring by hand. 0008's vendoring for schemas earned its place
  by pinning integrity, which a manifest does not want.
- **Reuse the schema cache with a short TTL.** Rejected, per rule 1.

## Stress test

1. **The public-CI leak.** A public repository's Actions logs are public.
   Fetching the manifest into a public run moves the private values from
   the source tree to the log. A pattern failure or a `get` prints them
   there. This proposal does not fix that, and no fetch mechanism can. The docs say so above the fold. Run from the private side. Use the URL
   form when the private *run* cannot check the manifest out, never to feed
   the public run.
2. **Freshness beats durability.** The first draft reused the schema cache
   as a fallback for a failed fetch. That produces a run that reports green
   against last week's manifest while the network is down. That is the
   false green 0014 exists to end. Rule 1 followed.
3. **A token in the URL.** `https://user:token@host/…` is the oldest way to
   smuggle a credential, and manni prints URLs in every diagnostic. Refused
   at parse time, with the message pointing at `tokenEnv`.
4. **A redirect to another origin.** A misconfigured raw URL that redirects
   to a CDN would otherwise send the bearer token there. Rule 5 drops the
   header on origin change, and the resulting 401 is reported rather than
   retried.
5. **SARIF.** A URL cannot be an `artifactLocation.uri` that code scanning
   resolves. The existing per-finding drop and its notice already handle a
   path outside the repository, and a URL takes the same branch. The
   document-side findings for the same run are unaffected.
6. **`http://`.** Refused outright rather than warned about. A warning that
   a token went over plaintext arrives after the token did.
7. **Rate limits.** A raw-file fetch counts against the host's rate limit.
   One run makes one request per remote manifest, and a run with three
   manifests makes three. That is well inside any limit, and a 429 is
   reported as a fetch failure with the status, exit 2, like any other.
8. **`--offline` and a mixed config.** A config with one local and one
   remote manifest refuses under `--offline` before reading either. A half-merged corpus is worse than an honest refusal. It is the same
   call 0008 § stress test 5 made for a mixed schema set.

## Not breaking

A path in `file:` behaves exactly as 0037 shipped it. `tokenEnv` is
optional and refused where it would do nothing. No public type changes
shape; `SidecarConfig` gains one optional field.
