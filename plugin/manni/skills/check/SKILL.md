---
name: check
description: Run manni check over the repository and walk the findings. Use when asked to check, verify or validate the docs, or when a hook reports manni errors.
allowed-tools: Bash(npx manni *), Bash(npx --no @hawkeyexl/manni *)
---

# Check the docs with manni

`manni check` runs every check the repository set up, and nothing else.

1. Run `npx --no @hawkeyexl/manni status`. It lists each domain as in play, not set up or not checked.
2. Run `npx --no @hawkeyexl/manni check`. Add paths to check only those files, as in `manni check docs/limits.md`.
3. Read the report. Each section names the check that found the problem, such as `meta validate` or `cite check`.
4. Only errors fail the run. Warnings and notices are information.
5. For each error, follow the `fix` skill. Do not guess a repair from the message alone.
6. Run `manni check` again until it exits 0.

A skipped check means its domain is not set up. That is not a failure.
If the report says no config was found, use the `setup` skill.
Exit code 2 means a check could not run. Read its message and fix the cause before you trust the result.
