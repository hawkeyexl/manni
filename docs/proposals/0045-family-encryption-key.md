# 0045: a family encryption key: `encryptionKey:`, `manni key`, and `x-manni-encrypt`

- **Status:** Implemented (#17)
- **Serves:** Three journeys.
  - Sara · S1, "Define our metadata standard as a schema". Her standard can
    require a field whose value never appears in plain text.
  - Devin · D5, "Gate citations in CI without blocking on prose". The private
    job reads one family secret, not a salt that belongs to cite.
  - Maya · M5, "Pin a claim and catch it going stale". A private source is
    encrypted, so a public page can cite it.
- **Depends on:** Four earlier proposals.
  - [0033](0033-manni-monorepo.md) put every tool's config in one file and
    every tool under one umbrella. The key is one more family entry in that
    file, and `key` one more domain under that umbrella.
  - [0034](0034-command-grammar.md) says the domain is the tool. `key` is not
    a tool, so this proposal extends the definition. 0034 stays as written.
  - [0041](0041-collections.md) added the first top-level key that is nobody's,
    `collections:`, and the discovery rule for it. `encryptionKey:` is the
    second, and the rule gains it.
  - [0044](0044-citations-and-drift.md) hid a private source path behind a
    salted hash under `cite:`. This proposal replaces the hash with encryption
    and the salt with the family key.
- **Relates to:** Four proposals this one touches without depending on them.
  - [0015](0015-schema-trust-boundary.md) bounds what a document-supplied
    schema may do. A mark rides schema resolution, so a page that names its
    own schema can name one without the mark. 0015's constraint is the guard,
    unchanged.
  - [0017](0017-fill-egress-and-bounds.md) bounds what `fill` sends. A marked
    field is sent neither as plaintext nor as ciphertext.
  - [0037](0037-sidecar-metadata.md) keeps a private value in a private
    manifest. That is the alternative this proposal answers, for values the
    page should still carry.
  - [0039](0039-sidecar-join.md) joins a manifest to pages by a frontmatter
    field. A marked join field is decrypted before matching.
- **Touches (planned):** `src/shared/{config-file,encryption-key,encryption,prompt,write-file}.ts`,
  `src/key/**` (new), `src/meta/core/**` (the validator and config),
  `src/meta/commands/{validate,fill,query}.ts`, `src/meta/reporters/**`,
  `src/cite/**`, `src/cli.ts`, `src/index.ts`,
  `scripts/check-cli-reference.mjs`,
  `docs/proposals/0044/schemas/citations/1.0.0-proposal.{2,3}.json` (new),
  `docs/src/content/docs/key/**` (new),
  `docs/src/content/docs/meta/reference/{configuration,schema-resolution,output-and-exit-codes,query,api}.mdx`,
  `docs/src/content/docs/meta/schemas/index.mdx`,
  `docs/src/content/docs/cite/**`, `CLAUDE.md`, `test/**`
- **Verdict:** One encryption key for the whole family: a top-level
  `encryptionKey:`, or `MANNI_ENCRYPTION_KEY`. Values are encrypted, never
  hashed, so every encrypted value in the family decrypts under the current
  key. Meta honours the key through a schema keyword, `x-manni-encrypt`. Cite
  encrypts private source paths with it. A new domain, `manni key`, sets the
  key and rotates it, re-encrypting every value in one atomic run.

## Problem

Two tools needed the same secret, and the one that had it could not share it.

**A required field that must not be public.** Sara's standard requires fields
such as `owner`, `internal-ticket` or `service` on every page. When the docs
are public and the organisation is not, she has two options, and both are bad.
She can publish the values, which leaks them. Or she can move them to an
external-metadata manifest (0037, 0041) in a private repository.

The manifest takes the value off the page entirely. 0037's own problem
statement put the contract on a value with the page, checked by the same
`validate` run. A manifest keeps the contract and loses the page's half of it.
The public checkout has no manifest, so its `validate` run cannot tell a page
that has an owner from one that does not. The public page carries no proof of
which value it holds, and nothing on it can be checked. No keyword says "this
field is required, and its value must never appear in plain text".

**A secret owned by one tool.** 0044 hid a private source path behind a salted
hash. The salt sat under `cite:`, or in `MANNI_CITE_SALT`:

```yaml
collections:
  - name: site
    paths: ["docs/src/content/docs/**/*.{md,mdx}"]
cite:
  salt: 3f9c2a1e7b0d4c5a        # cite only; env MANNI_CITE_SALT wins
```

No other tool could read it without reading a sibling's section, and 0033
gives each tool its own. The hash could not do meta's job either. A token was
`"~" + sha256(salt + "\n" + path)`, cut to 16 hex characters. Cite recovered a
path by hashing every tracked file and comparing. That works because the
tracked files are a finite list of candidates.

A metadata value has no such list. `internal-ticket: PROJ-4127`, hashed, is
gone for good. It cannot be validated against its `pattern`, and it cannot be
re-keyed under a new salt, because nothing can recompute it. Rotation was a
cite command too, `manni cite salt rotate`, though the secret was about to
protect more than citations. A salt rotated by cite would strand every meta
value under the old one.

## Decision

### The family key

```yaml
# Top level, beside collections:. Read by every tool. Env MANNI_ENCRYPTION_KEY wins.
encryptionKey: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
collections:
  - name: site
    paths: ["docs/src/content/docs/**/*.{md,mdx}"]
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `encryptionKey` | string of at least 32 hex or base64url characters | none | no | The family key every encrypted value is encrypted with. `manni key set` generates 64 random hex characters (256 bits). `MANNI_ENCRYPTION_KEY` in the environment wins over it. |

Every tool reads the key from the top of the file, the way it reads
`collections:`. No tool section carries it, and no tool keeps a secret of its
own. The configured value is key material. It is expanded, not stretched, so a
hand-picked value is only as strong as it is random. `manni key set` generates
256 bits, and the docs say to use it.

Three refusals, each exit 2, and none echoes the value:

```
manni.config.yaml: "salt" is no longer a cite key. Values are encrypted with a family key: a top-level encryptionKey:, or MANNI_ENCRYPTION_KEY. Run `manni key set`.
manni.config.yaml: "encryptionKey" must be at least 32 hex or base64url characters. Run `manni key set` to generate one.
MANNI_ENCRYPTION_KEY must be at least 32 hex or base64url characters.
```

`cite.salt` and `MANNI_CITE_SALT` are gone. Cite was never released, so there
is no alias. The refusal says where the setting went, as 0041's refusals do for
a moved key.

### Discovery

0041 made a family file a tool's config when it carries the tool's section or
`collections:`. The rule becomes "the tool's section, `collections:`, or
`encryptionKey:`". A file carrying only the key hands the tool an empty
section, and it stops the walk.

The key prompt below is the reason. It creates a `manni.config.yaml` holding
only `encryptionKey:` when no config exists. Under 0041's rule the next run
would walk past that file, and the key the user just accepted would never be
read. An explicit `-c` file whose top level carries `encryptionKey:` is read as
a family file, not as one tool's whole section. Legacy per-tool files
(`docmeta.config.yaml`) carry no key, as they carry no collections.

### The `x-manni-encrypt` keyword

```json
{
  "properties": {
    "owner": { "type": "string", "enum": ["platform", "billing"], "x-manni-encrypt": true },
    "internal-ticket": { "type": "string", "pattern": "^PROJ-[0-9]+$", "x-manni-encrypt": true }
  },
  "required": ["owner"]
}
```

A page then carries an encrypted value, `~` and at least 82 base64url
characters:

```yaml
owner: ~AQx7Vb2…(82 characters)
```

- **The mark.** `x-manni-encrypt: true` marks a property whose value the page
  must hold encrypted. `false` or absent is an ordinary property. Any other
  value is a schema error at compile time, exit 2:
  `<schema>: "x-manni-encrypt" must be true or false.`
- **Where a mark counts.** Wherever the validator evaluates it: through `$ref`,
  `allOf` and remote refs, and inside `anyOf`, `oneOf` and `if` branches.
  Writers encrypt top-level properties only. A nested mark is validated and
  never written.
- **Whole values.** The mark applies to the whole value, so an array or an
  object is encrypted as one ciphertext. The plaintext is JSON before
  encryption. An encrypted `number`, `boolean` or `array` decrypts to its real
  type and is validated as that.
- **Not on a citation.** `source.file` is an encrypted value, and the
  citations vocabulary still never marks it. Encryption there is cite's
  decision, taken per source and per repository, so a mark would make every
  plain source fail `meta validate`. The `fileRef` description says so.

### What `meta validate` does with a marked property

| Situation | Outcome | Exit |
|---|---|---|
| The page holds a plain value, whatever the key state | finding `encrypted:plain/encrypted`: `/owner holds a plain value; its schema marks it x-manni-encrypt.` | 1 |
| A plain value an external-metadata manifest supplied | validated as plain text, never flagged: the manifest is private by construction | 0 or 1 |
| Encrypted, key available, decrypts | the plaintext is validated against the property's full schema (`type`, `enum`, `pattern`, `format`…); no finding prints the value | 0 or 1 |
| Encrypted, key available, does not decrypt | finding `encrypted:unreadable/encrypted`: `/owner does not decrypt under the current key: encrypted under another key, or edited by hand.` | 1 |
| Encrypted, no key | findings at or under that pointer are dropped; one stderr warning per run: ``manni: 3 encrypted values were not verified: no encryption key is available. Set MANNI_ENCRYPTION_KEY, or run `manni key set`.`` | unaffected |

The no-key row has two costs. A condition elsewhere in the schema, such as
`if: {properties: {owner: {const: …}}}`, still sees the ciphertext. And a
baseline written with no key loses the dropped findings. They return as new
on the next run that has the key (stress test 13).

The two new rule ids fingerprint on schema, pointer and keyword, never on a
value. Re-encrypting a value under a new key therefore changes no fingerprint.
The output reference documents them beside `external:owned/external`.

### Writers and readers

- **`meta fill`** writes a marked property encrypted. It needs the key before
  its first model request, so a refused prompt never wastes a paid run. The
  model is sent neither the plaintext nor the ciphertext of a marked field
  (stress test 9). Reports, diffs and JSON print `(encrypted)` in place of the
  value.
- **`meta query` `UPDATE` and `INSERT`** resolve each written file's schema set
  exactly as `validate` does: config `schemas:`, overrides, `$schema`, `-s`.
  That is how they know which columns are marked, and they write those
  encrypted. Query never resolved schemas on its write path before, so this is
  new work there. Reports print `(encrypted)`.
- **`meta get` and `meta query` `SELECT`** return what the page holds, which is
  the ciphertext. A `WHERE owner = 'platform'` therefore matches nothing on
  encrypted pages, and the query reference says so. A `--reveal` for meta is a
  follow-up.
- **External metadata joins (0039).** A marked `join:` field is decrypted
  before matching when the key is available. With no key the run refuses,
  exit 2 (stress test 10).
- **`cite add`** encrypts every `source.file` it writes whenever a key is
  available. `--obfuscate` becomes `--encrypt`, which asks for the encrypted
  form and prompts for a key when none is available.
- **`cite check`** decrypts an encrypted `source.file` and checks the path
  against the tracked files. With an encrypted citation and no key it stays
  fail-closed. The citation is
  `missing (no encryption key is available to decrypt it)`, an error, unless
  `--no-check-sources` skips it. `--reveal` prints the decrypted path, as it
  printed the resolved one before.
- **`manni key rotate`** re-encrypts `source.file` and re-keys the pin over it,
  wherever the entry lives. That is the page's frontmatter, and the citation
  manifests a collection declares (0037, 0041). A manifest is spliced in place,
  one page's `citations` value at a time, so a rotation leaves every other byte
  of it alone.

### When a write needs a key and none is available

The prompt applies to the commands that create an encrypted value:
`meta fill`, `meta query` writes, and `cite add`. `validate`, `check`, `update`
and `key rotate` never prompt. `validate` and `check` only read, and `update`
moves line numbers, which sit outside the ciphertext. `key rotate` needs the
current key, and a fresh one would decrypt nothing.

On a terminal, meaning stdin and stderr are both TTYs:

```console
$ manni meta fill docs/auth.md
manni: /owner must be encrypted, and no encryption key is available.
manni: manni.config.yaml is not ignored by git: once committed, anyone who can read the repository can decrypt every encrypted value. Prefer MANNI_ENCRYPTION_KEY for a shared repository.
Generate a key and write it to manni.config.yaml? [y/N] y
Encryption key written to manni.config.yaml.
… fill continues …
```

- The git line appears when git does not ignore the file. With no git it does
  not appear.
- With no config file, the question names the file it would create:
  `manni.config.yaml` at the git root, else the working directory. The
  confirmation then reads `Created manni.config.yaml with an encryption key.`
- `N`, an empty answer, or end of input stops the command, exit 2:
  ``/owner must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.``
- Off a terminal the same line prints with no question, exit 2.
- Cite's subject is the source:
  `src/limits.ts:2 must be encrypted, and no encryption key is available.`

### The `key` domain

0034 says the domain is the tool. `key` is not a tool: it validates no
document and reads no page for its own sake. It manages a family resource, the
encryption key, and re-encrypts what every tool has encrypted. So this proposal
extends the definition: a domain is a tool, or a family resource with verbs.
0034 stays as written, and CLAUDE.md's grammar paragraph gains the sentence.

The rest of 0034 holds. `key` has two verbs and no default subcommand, and it
has no config section of its own. The umbrella describes it as
`Set and rotate the family key that encrypted values are encrypted with.`
`manni cite salt set|rotate` is removed. It was never released, so the umbrella
carries no hint for it.

#### `manni key set [value]`

| Argument | Required | Description |
|---|---|---|
| `[value]` | no | The key to write, at least 32 hex or base64url characters. Without it, `set` generates 64 random hex characters. |

| Option | Argument | Default | Description |
|---|---|---|---|
| `-c, --config` | `<path>` | the nearest `manni.config.yaml`, whatever it carries | The config file to write. Created at the git root (else the working directory) when none is found. |
| `--dry-run` | | off | Say what would be written; write nothing. |

Exit `0` written, `2` refused. It never prints the key.

#### `manni key rotate [paths...]`

Re-encrypts every encrypted value in the given pages, else the selected
collections, under a new key. It covers those collections' local
external-metadata manifests too. How it finds the values, and when it writes,
are the next two sections.

| Argument | Required | Description |
|---|---|---|
| `[paths...]` | no | Files, directories or globs. Without them, every collection. |

| Option | Argument | Default | Description |
|---|---|---|---|
| `--to` | `<value>` | 64 random hex | The new key. Required for a narrowed run and when the current key comes from `MANNI_ENCRYPTION_KEY`. |
| `--collection` | `<name>` | | Configured collection to run over; repeatable. |
| `--ext` | `<list>` | supported extensions | Comma-separated extensions for directory walks. |
| `--exclude` | `<glob>` | | Glob to exclude; repeatable. |
| `--as` | `<format>` | | Force an input format for every input. |
| `-c, --config` | `<path>` | discovered | Path to a manni config file. |
| `--allow-empty` | | off | Treat zero matched files as success. |
| `--no-gitignore` | | on | Include files `.gitignore` covers. |
| `--root` | `<dir>` | git root | Where cited sources resolve from, to re-key citation pins. |
| `--dry-run` | | off | Print what would change; write nothing. |
| `-f, --format` | `<format>` | `pretty` | `pretty \| json` |

There is no `--no-config`. The current key comes from the config or the
environment, and the new one is written to the config. Exit `0` means every
value was re-encrypted. Exit `1` means something could not be, and nothing was
written. Exit `2` is operational.

#### The ladder

```console
$ manni key set
Encryption key written to manni.config.yaml.
# exit 0

$ manni key set --dry-run
Would write encryptionKey to manni.config.yaml.
# exit 0

$ manni key set -c ops/manni.config.yaml 0123456789abcdef0123456789abcdef
manni: ops/manni.config.yaml is not ignored by git: once committed, anyone who can read the repository can decrypt every encrypted value. Prefer MANNI_ENCRYPTION_KEY for a shared repository.
Encryption key written to ops/manni.config.yaml.
# exit 0

$ manni key rotate
docs/auth.md: /owner  ~AQx7…  -> ~AQp2…
docs/limits.md: fetch-timeout  ~AQm4…:2 -> ~AQr9…:2
2 values re-encrypted in 2 files, 0 skipped
Encryption key written to manni.config.yaml.
# exit 0

$ manni key rotate --collection site --to "$NEW_KEY"
docs/auth.md: /owner  ~AQx7…  -> ~AQp2…
1 value re-encrypted in 1 file, 0 skipped
Key not written: this run covered part of the family. Finish with a whole run under the same key: `manni key rotate --to <the same value>`.
# exit 0

$ MANNI_ENCRYPTION_KEY=… manni key rotate --to "$NEW_KEY"
docs/auth.md: /owner  ~AQx7…  -> ~AQp2…
1 value re-encrypted in 1 file, 0 skipped
Key not written: it comes from MANNI_ENCRYPTION_KEY. Update the secret to the value you passed.
# exit 0

$ manni key rotate --to 0123456789abcdef0123456789abcdef --collection site --ext md,mdx --exclude "docs/drafts/**" --as markdown -c manni.config.yaml --allow-empty --no-gitignore --root . --dry-run -f json
{"pages":[{"file":"docs/auth.md","rewritten":[{"kind":"metadata","pointer":"/owner","from":"~AQx7…","to":"~AQp2…"}],"skipped":[],"written":false}],"reencrypted":1,"skipped":0,"keyWritten":false}
# exit 0
```

Usage errors and refusals:

```console
$ manni key
Usage: manni key [options] [command]
# exit 2

$ manni key set
manni: An encryption key is already configured in manni.config.yaml. Run `manni key rotate` to replace it and re-encrypt every value.
# exit 2

$ manni key set tooshort
manni: The key must be at least 32 hex or base64url characters. Run `manni key set` with no value to generate one.
# exit 2

$ MANNI_ENCRYPTION_KEY=… manni key set
manni: MANNI_ENCRYPTION_KEY is set, so a key written to config would never be read. Unset it, or keep the key in the secret.
# exit 2

$ manni key rotate
manni: No encryption key is available, so nothing can be re-encrypted. Run `manni key set` first.
# exit 2

$ MANNI_ENCRYPTION_KEY=… manni key rotate
manni: The key comes from MANNI_ENCRYPTION_KEY; pass --to <value>, re-encrypt with it, then update the secret. Nothing is written to config.
# exit 2

$ manni key rotate docs/
manni: A run over part of the family needs --to, and never writes the key.
# exit 2

$ manni key rotate
docs/auth.md: /owner  skipped: does not decrypt under the current key
0 values re-encrypted in 0 files, 1 skipped
Key not written: 1 value could not be re-encrypted. Fix it and rotate again.
# exit 1

$ manni key rotate -f sarif
manni: Unknown --format "sarif". Use pretty or json.
# exit 2
```

### Rotation finds values by their ciphertext

`rotate` finds values by their ciphertext, not through schema marks. Every
string in a page's metadata that has the ciphertext shape and decrypts under
the current key is re-encrypted. So is every encrypted `source.file`, and the
`hmac-sha256-` pin over it is re-keyed from the cited lines. It reaches them
wherever the entry lives, in the page's frontmatter and in a citation manifest
alike. That is why `rotate` takes `--root`,
and uses git as `cite check` does, whenever it is available. The authentication
tag proves a value is ours, so no schema has to be resolved. A mark from a `-s` schema or an unreachable remote cannot hide
a value from rotation (stress test 5).

A value need not sit in a page. An external-metadata manifest (0037) holds the
private half of a document. That is where a marked value most often lives. So
a rotation also re-encrypts the local manifests of the collections it covers
(stress test 17). The rule inside a manifest is the rule inside a page, with
two exclusions. A URL manifest (0038) is read-only and is never loaded, so a
rotation reaches no network. The `citations` key is cite's, which re-keys a
source with its pin. Rotation leaves it alone in a manifest, exactly as it
does on a page.

A value that already decrypts under the new key counts as done, so an
interrupted rotation can be run again (stress test 6). Every page and manifest
is re-encrypted in memory first. Nothing is written, and no key, unless every
value could be re-encrypted. A string with the ciphertext shape that decrypts
under neither key is skipped and reported, and one skip means nothing is
written. A whole run then writes the key first. The config gets the new key,
with the old one beside it as `encryptionKeyPrevious:`. The pages and manifests
follow, and last the config loses the old key (stress test 6).

When a citation baseline exists, rotation ends with a line saying it needs
re-recording (stress test 13).

### A narrowed run never writes the key

A narrowed run, with positional paths or `--collection`, can cover only part of
the family. It requires `--to` and never writes the key. The operator runs it
area by area with one `--to`, then writes the key with a whole run (stress
test 7). It covers the manifests of the collections it selected. `--collection`
names them, and positional paths select the collections those files belong to,
so a page and its private half move together.

### The ciphertext

- **Format.** `~`, then unpadded base64url of a version byte (`0x01`), a
  12-byte nonce, the AES-256-GCM ciphertext and its 16-byte tag.
- **Padding.** The plaintext is the value's JSON, padded to a multiple of 32
  bytes in the ISO/IEC 7816-4 style. That is `0x80`, then `0x00` bytes, with
  at least one pad byte. A ciphertext's length reveals a size class, not the
  value. The shortest ciphertext is 61 bytes, so 82 characters after the `~`.
- **Subkeys.** Three 32-byte subkeys come from the configured key with
  HKDF-SHA256 and an empty salt. They are labelled `manni/v1/encrypt`,
  `manni/v1/nonce` and `manni/v1/pin`.
- **Deterministic, so joins work.** The nonce is the first 12 bytes of an HMAC
  under the nonce subkey, over the context, a zero byte and the padded
  plaintext. The context is `meta` or `cite-src`. It is also bound in the
  associated data, which is `0x01` followed by the context.
- **Canonical.** Decryption checks that the nonce equals that HMAC, so every
  valid ciphertext is canonical, and one edited by hand never decrypts.
- **The property name is not bound.** A value moved between fields stays
  readable, and joins across fields work.
- **The keyed pin.** A citation pin over an encrypted source is `hmac-sha256-`
  and the hex HMAC-SHA256 of the cited text under the pin subkey. It can be
  compared, and it cannot be reversed. The prefix says which it is, so a reader
  who hashes the line by hand learns why the two do not match. A plain source
  keeps `sha256-`, and either pairing the other way is an invalid entry.
- **Why SIV-style on GCM.** A deterministic scheme wants a SIV mode, and Node
  has none: `aes-256-gcm-siv` and `aes-*-siv` are unknown ciphers in Node 24.
  Deriving the nonce from the plaintext, and checking it on decryption, gives
  the same property on AES-256-GCM. It needs `node:crypto` only, and no
  dependency.
- **One format for the family.** Meta values and cite paths encrypt the same
  way, under different contexts, so rotation has one rule. A citation's
  `source.file` is a whole value in that format, not a path glued to a line
  number. `source.lines` stays readable beside it.
- **One context stays apart.** `cite-src` is separate from `meta` on purpose,
  and it is internal: no user types it and no output shows it. It is what
  stops a meta tool from re-encrypting a source without also re-keying the pin
  over it. A rotation that did would leave every encrypted citation broken.

**What equality leaks.** Equal plaintexts give equal ciphertexts, which is what
a join needs. On a small enum, one publicly known page reveals every page with
the same ciphertext. Stress test 12 records why that is accepted.

### Output never says more than the page did

This is 0044's output rule, extended to meta. Findings, reports, diffs and JSON
carry the ciphertext or `(encrypted)`, and no finding prints a decrypted value.
The only plaintext output is `cite check --reveal`, on a terminal the operator
controls. A meta `--reveal` is a follow-up. `manni key set` never prints the
key.

### Programmatic API

| Change | Export |
|---|---|
| added | `key` namespace: `runKeySet`, `runKeyRotate`, `encryptValue`, `decryptValue`, `isEncryptedValue`, `resolveEncryptionKey`, `KeySource`, and the option and result types |
| removed | `cite.runSaltSet`, `cite.runSaltRotate`, `cite.obfuscatePath`, `cite.SALT_ENV`, `cite.SaltSource` |

## Stress test

What was tried against this design, and what each attempt changed.

### 1. A hash could not re-key free text

The smallest change was to keep 0044's hashes and lift the salt to the family.
Paths survive that, because cite recovers a path by hashing every tracked file
and comparing. A metadata value has no such list of candidates. A hashed
`internal-ticket` could not be checked against its `pattern` or re-keyed under
a new key. Rotation would have had to leave it under the old secret, or destroy
it.

**Changed as a result:** values are encrypted, not hashed. The rule is that
every encrypted value in the family decrypts under the current key. That rule
lets `validate` check a value's real type, `enum` and `pattern`. It also lets
`rotate` re-encrypt free text. Cite's paths follow the same rule, and are still
checked against the tracked files once decrypted.

### 2. "Salt" and "obfuscate" named the wrong mechanism

A salt is public input to a hash, and obfuscation promises nothing. The secret
was a key, and once values were encrypted the operation was encryption. Docs
that said "salt" invited an operator to treat the value as low-stakes. Anyone
holding it can read every private value in the family.

**Changed as a result:** the words are key and encrypt, everywhere a user sees
them. `cite.salt` became the top-level `encryptionKey:`, and `MANNI_CITE_SALT`
became `MANNI_ENCRYPTION_KEY`. `manni cite salt set|rotate` became
`manni key set|rotate`, and `--obfuscate` became `--encrypt`. The citations
vocabulary's descriptions stop saying "obfuscated" and "salt".

### 3. A file holding only the key was invisible to discovery

The key prompt writes `encryptionKey:` to a new `manni.config.yaml` when none
exists. Under 0041's rule that file carries neither a tool section nor
`collections:`, so the next run walks past it. The user answers yes, the key is
written, and the next `validate` reports that no key is available.

**Changed as a result:** `encryptionKey:` is a family key for discovery too. A
family file carrying it is every tool's config, with an empty section. An
explicit `-c` file with a top-level `encryptionKey:` is read as a family file.
Not breaking records the change of behaviour.

### 4. Ciphertext length revealed short enum values

Without padding, a ciphertext is as long as its plaintext plus a constant. With
`enum: [platform, billing]`, the two values differ by one character, and so
would their ciphertexts. A reader could sort every `platform` page from every
`billing` page by length alone. That is stress test 12's leak without even one
known page.

**Changed as a result:** the plaintext is padded to a multiple of 32 bytes
before encryption. A length then reveals a size class, not a value. The
verification asserts that the ciphertexts of `platform` and `billing` have
equal length. The cost is that the shortest ciphertext is 82 characters.

### 5. Rotation through schema marks missed values

The first `rotate` found values the way `validate` does. It resolved each
page's schema set, then re-encrypted the marked properties. Two kinds of value
escaped. A property marked only by a schema passed with `-s` is marked on that
run and no other. A mark inside a remote schema vanishes whenever the remote is
unreachable. Either way `rotate` writes a new key with values still under the
old one, and those values never decrypt again.

**Changed as a result:** rotation finds values by their ciphertext. Every
string with the ciphertext shape that decrypts under the current key is
re-encrypted, whatever the schemas say. The authentication tag proves the value
is ours. No schema is resolved, so no mark can hide a value. A shaped string
that decrypts under neither key is skipped and reported, and a skip blocks
every write.

### 6. An interrupted rotation had to be resumable

Rotation writes many files, then the key. A run killed part of the way leaves
some pages under the new key and the config naming the old one. Run again, those
pages no longer decrypt under the current key. They would be skipped as
unreadable, and the rotation could never finish.

**Changed as a result:** a value that already decrypts under the new key counts
as done, and the key is written first. The same rule makes narrowed runs
composable (stress test 7). Pages are re-encrypted in memory before anything is
written, so a value that cannot be re-encrypted stops the run before its first
write. A whole run whose key comes from the config then writes in three steps:

1. The config, with `encryptionKey:` the new key and `encryptionKeyPrevious:`
   the old one, in one atomic write.
2. The pages.
3. The config again, without `encryptionKeyPrevious:`.

A run killed at any point leaves every value readable under one of the two keys
the config names. A key the run generated for itself reaches the config before
any page is encrypted under it, so it is never lost with the process. The next
`manni key rotate` finds `encryptionKeyPrevious:` and finishes the rotation. It
re-encrypts from the previous key to the current one, and counts the values
already under the current key as done. Then it removes the previous key. It says
`Finished the interrupted rotation in manni.config.yaml.` before its counts.
While the previous key is present, `key set`, a narrowed run and any `--to`
other than the current key are refused, exit 2:

```
A rotation is unfinished in manni.config.yaml. Run `manni key rotate` with no --to to finish it.
```

A key from `MANNI_ENCRYPTION_KEY` never touches the config (stress test 14), so
it needs none of this. Its pages are finished the first way: a second run with
the same `--to`. `encryptionKeyPrevious:` is shape-checked like
`encryptionKey:`, never echoed, and read only by `manni key rotate`.

### 7. A narrowed run could write a key parts of the family were not re-encrypted under

`manni key rotate docs/` re-encrypts the pages under `docs/`. If it then wrote
the key, every encrypted value outside `docs/` would stop decrypting, silently,
until something read it. `--collection site` has the same hole for every other
collection.

**Changed as a result:** a narrowed run, with positional paths or
`--collection`, requires `--to` and never writes the key. Its last line says
how to finish:

```
Key not written: this run covered part of the family. Finish with a whole run under the same key: `manni key rotate --to <the same value>`.
```

The operator runs it area by area with one `--to`. The last step is a whole
run with the same `--to`. The values already rotated count as done (stress
test 6). The key is written in stress test 6's order: the new key beside the
old one, the pages, then the old key removed. The residue is a page no
collection declares. A whole run covers the declared collections, so it does
not reach that page, and a narrowed run over it with the same `--to` does.

### 8. The same plaintext under two contexts would reuse a GCM nonce

A nonce derived from the plaintext alone gives `platform` one nonce, wherever
it is encrypted. The context separates meta values from cite paths in the
associated data. Take the same text as a meta value and as a cite path. Both
would be sealed under one key and one nonce, with two different tags. GCM with a
repeated nonce leaks its authentication subkey, and forgery follows.

**Changed as a result:** the context is bound twice. It is hashed into the
nonce, ahead of a zero byte and the padded plaintext, so two contexts never
share a nonce. It is also the associated data, so a ciphertext moved from one
context to the other fails its tag. The property name is bound in neither, on
purpose, so a value moved between fields stays readable.

### 9. `fill` must not send a marked field to a model, and must have the key first

0017 bounds what `fill` sends to a model. A marked field's plaintext is the
thing the mark exists to keep private. Its ciphertext tells the model nothing
and still costs tokens. And a `fill` run that found the key missing only when
it came to write would already have paid for every model call.

**Changed as a result:** the model is sent neither the plaintext nor the
ciphertext of a marked field. `fill` resolves the key, prompting if it must,
before its first model request, so a refused prompt costs nothing. Reports,
diffs and JSON print `(encrypted)` in place of the value.

### 10. A join on an encrypted field

0039 joins a manifest to pages by a frontmatter field. When that field is
marked, the pages hold ciphertexts and the private manifest holds plaintexts.
Matched as text, no entry would find its page. The run would report a page of
unmatched entries and hide the cause.

**Changed as a result:** a marked `join:` field is decrypted before matching
when the key is available. With no key the run refuses with exit 2, and the
message names the cause:

```
externalMetadata join field "owner" is encrypted on these pages, and no encryption key is available to match them.
```

A plain value that a manifest supplies is validated as plain text and never
flagged, because the manifest is private by construction.

### 11. A committed key in a public repository

The prompt writes the key into `manni.config.yaml`, and that file is usually
committed. In a public repository a committed key decrypts every encrypted
value for anyone who reads it. A refusal to write would block the private
repositories where a committed key is exactly right. The tool cannot tell a
public repository from a private one. It can tell whether git ignores the file.

**Changed as a result:** a warning, not a refusal. When git does not ignore the
file the key would land in, the prompt and `key set` print this line to stderr:

```
<file> is not ignored by git: once committed, anyone who can read the repository can decrypt every encrypted value. Prefer MANNI_ENCRYPTION_KEY for a shared repository.
```

With no git it prints nothing. The docs recommend the environment variable for
a shared repository. 0044's public-docs layout keeps the key in a CI secret.

### 12. Equal plaintexts give equal ciphertexts

Deterministic encryption gives one plaintext one ciphertext under one key. On a
two-value enum, a reader who learns one page's owner learns the owner of every
page with the same ciphertext. A random nonce would close that. It would also
break every join on a marked field. And an `UPDATE` that sets an unchanged value
would rewrite the line.

**Changed as a result:** nothing in the construction. The leak is recorded here
as accepted, because joins need equality. Which fields to mark stays Sara's
decision, and a field with few, guessable values is the one to think twice
about. Padding (stress test 4) keeps length from adding to the leak.

### 13. A baseline written with no key, and cite baselines after rotation

A meta baseline written with no key has no findings for encrypted values,
because the no-key row drops them. The next run with the key finds them, and
they arrive as new, so a green ratchet goes red. On the cite side, 0044 stress
test 19 fingerprints an id-less citation by its `integrity`. Over an encrypted
source that is the keyed pin, which rotation changes. So every baselined finding
on such a citation returns as new after a rotation.

**Changed as a result:** both are recorded as costs rather than designed away.
The two meta rule ids fingerprint on schema, pointer and keyword, never on a
value, so rotation changes no meta fingerprint. The no-key warning counts the
values it did not verify, which is the signal that the run is no baseline. When
a citation baseline exists, `rotate` ends with this line:

```
The citation baseline fingerprints id-less encrypted citations by their pin; re-record it with `manni cite check --write-baseline`.
```

A citation with an `id` keeps its fingerprint across rotations.

### 14. A key written to config while `MANNI_ENCRYPTION_KEY` is set

The environment wins over the config. A `key set` that wrote the config while
the variable was set would report success, and the key it wrote would never be
read. Rotation has the same trap. A new key written to config leaves the
environment supplying the old one, so every value just re-encrypted stops
decrypting.

**Changed as a result:** `key set` refuses while the variable is set:

```
MANNI_ENCRYPTION_KEY is set, so a key written to config would never be read. Unset it, or keep the key in the secret.
```

`key rotate` with a key from the environment requires `--to`, re-encrypts under
it, and never writes the config. It ends with this line:

```
Key not written: it comes from MANNI_ENCRYPTION_KEY. Update the secret to the value you passed.
```

That keeps 0044 stress test 22's rule: the source of the key decides where the
new one goes, and there is no flag.

### 15. `key` did not fit 0034's definition of a domain

0034 says the domain is the tool. The verbs began under cite, as
`manni cite salt`, which leaves meta's values rotating through a citation
command. Moving them under meta has the mirror problem. A top-level verb such
as `manni rotate-key` has no domain at all, which 0034 forbids outright.

**Changed as a result:** `key` is a domain, and the definition is extended: a
domain is a tool, or a family resource with verbs. 0034 is not edited. This
record is where the extension lives, and CLAUDE.md's grammar paragraph cites
it. The rest of 0034 holds for `key`: spelled verbs, no default subcommand, one
separator per list.

### 16. A new family file would hide a legacy per-tool file

With no family file, `manni key set` creates `manni.config.yaml` at the git
root. A repository that still keeps the metadata tool's options in
`docmeta.config.yaml` there would lose them. Discovery reads the family file
first in a directory, and a family file carrying `encryptionKey:` is every
tool's config (stress test 3). `manni meta` would then read the new file's
empty section and stop reading the legacy one. The key write would succeed and
silently turn off every option the repository had.

**Changed as a result:** `key set` refuses to create `manni.config.yaml`
beside `docmeta.config.yaml` or `docmeta.config.yml`, exit 2:

```
docmeta.config.yaml is a single-tool config; a manni.config.yaml beside it would hide it. Move its keys under meta: in manni.config.yaml first.
```

A family file that already sits beside a legacy one is edited as usual,
because it already wins there. `-c` at a single-tool file is refused, as the
key prompt refuses one. A top-level key would turn that tool's whole document
into a family file.

### 17. An encrypted value in a manifest survived the rotation

Rotation walked page files and nothing else. An external-metadata manifest
(0037) is not a page: it registers no extractor and appears in no `docs` row.
So a marked value a manifest supplied stayed under the old key while every
page moved, and `meta validate` then reported `encrypted:unreadable` on every
page that manifest fed. The next rotation could not repair it either. The
value decrypted under neither key by then, so the run skipped it and refused
to write anything at all.

This is the likeliest place for the failure, not an unlikely one. A manifest
is private by construction, which is the whole reason a value would be
encrypted rather than published.

**Changed as a result:** a rotation loads the local manifests of the
collections it covers. It re-encrypts their values with the pages, planning
everything in memory before the first write. Three things bound it.

- A URL manifest is read-only, so it is never loaded and a rotation reaches
  no network. Rotate the file at its source, then update the key.
- The `citations` key is skipped, in a manifest as on a page. Cite re-keys a
  citation's source with its pin under its own context, and re-encrypting the
  source alone would break every encrypted citation.
- One value is spliced at a time, by the same writer cite's sidecar citations
  use. It replaces that value's range and keeps every other byte, then reads
  the result back before returning it. A manifest is hand-written, and
  re-emitting one would cost its comments and its key order.

## Verification

```bash
npx tsc --noEmit && npm run lint && npm run build && npx vitest run    # strict types, type-aware lint, the build, the suite
npm run docs:check-cli && npm run docs:check-api && npm run docs:check-tables   # key/reference/cli.mdx, the key API rows, the tables
node dist/cli.js meta validate && node dist/cli.js cite check           # the repo's own config; exit 0
node docs/proposals/0044/ladders/citations-examples.cjs                 # the citations draft, with the encrypted src grammar
node docs/proposals/0044/ladders/drift-examples.cjs                     # golden hashes and verdicts
vale --no-exit --output=line --minAlertLevel=error docs/src/content/docs/key docs/src/content/docs/cite docs/src/content/docs/meta docs/proposals/0044-citations-and-drift.md docs/proposals/0045-family-encryption-key.md
cd docs && npm run build && cd .. && npm run docs:check-links           # every internal link and anchor resolves
```

End to end, in a temp repository, with a schema that marks `owner` and
`internal-ticket`:

1. A page with a plain owner: `validate` exits 1 with `encrypted:plain`.
2. `meta fill` encrypts it after `y` at the prompt. The unit tests answer
   through the injected prompt, and the built-bin tests cover the refusal off a
   terminal.
3. `validate` exits 0, and exits 1 for an owner not in the enum.
4. `key rotate` re-encrypts the owner, a cited source and a manifest value
   together.
5. `validate` still exits 0 under the new key.
6. `validate` with no key prints the not-verified warning.
7. The ciphertexts of `platform` and `billing` have equal length.

## Not breaking

- **cite and `manni key` are unreleased.** `cite.salt`, `MANNI_CITE_SALT`,
  `manni cite salt set|rotate`, `--obfuscate` and the `~<16 hex>` form never
  reached npm. They go without aliases. `cite.salt` is refused with a message
  naming `manni key set`, as 0041 refuses a moved key. The citations drafts
  `1.0.0-proposal.1` and `1.0.0-proposal.2` are kept beside the shipped
  `1.0.0-proposal.3`, which is where the `hmac-sha256-` prefix and the whole
  encrypted `source.file` live.
- **meta gains an opt-in keyword and a top-level key.** A schema without
  `x-manni-encrypt` validates exactly as before. A config without
  `encryptionKey:` reads exactly as before. No existing page holds a
  ciphertext, so nothing changes until a schema marks a property.
- **`meta query` resolves schemas on its write path.** It never did before.
  This is new work on that path rather than a changed result, and the plan
  recorded it as a risk.
- **Discovery stops at a key-only file.** A family file carrying
  `encryptionKey:` and no section for the running tool now ends the walk,
  where it used to continue upward. A repository with a key-only file above a
  per-tool file sees the outer one win. No shipped layout has one, since the
  key is new. The release note names it as a behaviour change.

## Consequences

- A `--reveal` for meta is a follow-up. Until it lands, reading a decrypted
  meta value takes the key and `decryptValue` from the programmatic API.
- A `WHERE` on an encrypted column matches nothing, because `SELECT` sees the
  ciphertext. The query reference says so.
- The `key` domain ships its docs section: an overview and `reference/cli.mdx`,
  verified by `docs:check-cli`. The configuration reference gains
  `## Encryption key` beside `## Collections`. Schema resolution documents
  `x-manni-encrypt`, and the schemas page carries a how-to for Sara. The output
  reference gains the two rule ids. The cite pages move from obfuscation to
  encryption and link to the family key.
- 0044 was unmerged and written in this PR, so its salt and obfuscation
  sections were edited to match what ships. Its stress tests 16 and 22 stay as
  written, and its stress test 23 records the change. The later redesign of
  the entry did the same: the sections match what ships, and 0044's stress
  test 25 records it. No reader relied on the unmerged text, so neither is the
  amendment CLAUDE.md forbids.
- CLAUDE.md's grammar paragraph gains the family-resource domain, and its
  key-layers list gains `src/key/` and `src/cite/`.
- The `feat` ships a demo video. A page with a plain `owner` fails, `meta fill`
  encrypts it after the key prompt, `validate` passes, and `key rotate`
  re-encrypts it. The accent follows `docs/content-strategy/design.md`: not
  red, green, yellow or cyan.
