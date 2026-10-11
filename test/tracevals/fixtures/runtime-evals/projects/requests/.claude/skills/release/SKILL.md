---
name: release
description: Cuts a release of the notes app.
---
# Cut a release

1. Run `npm test`, and stop if any test fails.
2. Move the entries under `## Unreleased` in `CHANGELOG.md` to a heading for the new version.
3. Run `npm version <patch|minor|major>`, which commits and tags the release.
4. Ask the user before running `git push --follow-tags`.
