# Page metadata standard

Every page under `docs/` starts with YAML frontmatter. Besides `title`,
`description` and `type`, each page carries these fields.

| Field | Required | Value |
|---|---|---|
| `contact` | yes | The email address of the person who answers questions about the page. |
| `status` | yes | One of `draft`, `review` or `published`. |
| `reviewed` | no | When the page was last reviewed, as a date and time in UTC, such as `2026-03-02T09:00:00Z`. |
