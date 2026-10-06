---
name: setup
description: Set up manni in a repository. Use when there is no manni.config.yaml, when the user asks to add manni, or when manni check reports that nothing is set up.
allowed-tools: Bash(npm *), Bash(npx manni *), Bash(npx --no @hawkeyexl/manni *)
---

# Set up manni

Do these steps in order. Ask before you choose anything that changes how the docs are judged.

1. Install the package: `npm install --save-dev @hawkeyexl/manni`.
2. Find the docs. Look for Markdown and MDX folders, such as `docs/`. Ask the user to confirm the paths.
3. Write `manni.config.yaml` at the repository root with a top-level `collections:` entry for those docs.

```yaml
collections:
  - name: site
    paths:
      - "docs/**/*.{md,mdx}"
    exclude:
      - "docs/drafts/**"
```

`name` is required and unique. The name `docs` is refused, so pick another. `exclude` is optional.

4. Ask which domains to set up. A domain is in play only when its section exists. Offer these:

| Domain | What it checks | How to set it up |
|---|---|---|
| meta | Frontmatter against JSON Schema | Add a `meta:` section with `schemas:`. Run `manni meta schemas` to list the built-in ones. |
| lint | Page structure against templates | Add a `lint:` section. See `manni lint templates`. |
| docevals | Evals declared in page frontmatter | Add a `docevals:` section. |
| graph | The knowledge graph and its SHACL shapes | Run `manni graph init`. It appends a `graph:` section. |

Run `manni docevals init` only when no config file exists. It refuses an existing one. With a config in place, write the `docevals:` section by hand.
Citations and terms need no section. They are in play when the pages carry them.

5. Run `npx --no @hawkeyexl/manni status` and show the user the table.
6. Run `npx --no @hawkeyexl/manni check`. Report the result and use the `fix` skill for any error.

Do not add a section for a domain the user declined. A section that exists turns that domain's checks on.
