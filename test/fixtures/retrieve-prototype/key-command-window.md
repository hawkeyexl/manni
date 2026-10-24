import { Aside, CardGrid, LinkCard } from '@astrojs/starlight/components';

<Aside type="note" title="Beta">
`manni key` is in beta. Its commands, config keys and output can change in
any release, without notice.
</Aside>

{/* cite ciphertext-shape */}
Some values have to be on every page and must never be readable there. manni
encrypts them with one key, the family encryption key. `manni meta` encrypts a
frontmatter value whose schema marks it `x-manni-encrypt`, and `manni cite`
encrypts the path of a private source. Both write the same ciphertext: `~`
followed by at least 82 base64url characters. It decrypts under the current key
and under no other. Anyone with the key can check which value a page holds,
and anyone without it learns nothing from the page.

`manni key` makes that key and replaces it. It manages a resource the family shares.

## What it is for

A metadata standard can require a private owner field. Mark the schema property
so that the reader checks the decrypted value whenever the current key is available.
The public documentation contains a ciphertext instead of the private value.
The check records which values it could verify and reports anything left unverified.

## Two commands

| Command | Does |
| --- | --- |
| `manni key set [value]` | Writes `encryptionKey:` to `manni.config.yaml`, and creates the file when there is none. Without a value it generates 64 random hex characters. |
| `manni key rotate [paths...]` | Re-encrypts every encrypted value under a new key, in pages and in citation manifests alike, then writes the new key. Nothing is written unless every value re-encrypts. |
