# Synthetic DITA for the `dita-ot` structure tool

Four maps that differ by one defect each, so a finding can be attributed to the
thing that caused it. Every reference resolves except the named one, which is
what separates these from the vendored subset in `examples/dita-ot/`: that tree
is real but partial, so its dangling references say nothing about the tool.

| Map | Defect | What DITA-OT says |
|---|---|---|
| `clean.ditamap` | none | nothing |
| `broken-conref.ditamap` | `broken-conref.dita` conrefs an id `warnings.dita` has not got | `DOTX010E`, ERROR |
| `undefined-key.ditamap` | `undefined-key.dita` keyrefs `revoking`, which no `keydef` defines | `DOTJ047I`, INFO, so a `notice` |
| `dead-xref.ditamap` | `dead-xref.dita` xrefs a file that is not there | `DOTX008E` with no location, then `DOTX031E`, both ERROR |

`keys.ditamap`, `warnings.dita` and `rotate-a-key.dita` are the shared, correct
material the defective copies are derived from.

## `logs/`, the parser's input

Captured `--logger=json` output, in the array form `--logger=json --logfile=<file>`
produces. The field names come from `org.dita.dost.invoker.JsonLogger` at tag
4.4.1, read from source rather than guessed:

| Field | Type | Note |
|---|---|---|
| `timestamp` | string | ISO-8601 offset date-time, on every object |
| `level` | string | `FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG` or `TRACE` — DITA-OT's own `MessageBean.Type`, not Ant's priorities |
| `msg` | string | the message text, after the id and location prefix are stripped off it |
| `code` | string, optional | the message id, e.g. `DOTX010E` |
| `location` | string, optional | a file URI |
| `line` | number, optional | the line |
| `row` | number, optional | **the column.** The name is a quirk of the logger: its regex takes group 2 as the line and group 3 as the column, and writes the column out as `row`. |
| `target`, `task`, `duration`, `stacktrace` | optional | build bookkeeping |

`code` is what separates a diagnostic from build chatter, because DITA-OT writes
hundreds of `INFO` lines that are progress rather than findings. An object with
no `code` is not a finding, whatever its level — which is why `clean.log.json`
must yield nothing at all.

| Log | Entries | Coded | Covers |
|---|---|---|---|
| `clean.log.json` | 128 | 0 | chatter only. No `code` anywhere, so no findings at all. |
| `broken-conref.log.json` | 134 | 1 | one coded error with a full location, the ordinary case: `DOTX010E`, ERROR, line 10, `row` 59. |
| `undefined-key.log.json` | 136 | 1 | a finding DITA-OT reports at **INFO**: `DOTJ047I`, line 10, `row` 50. It folds to `notice`, so it annotates a run without failing it, and the default verbosity drops it entirely. |
| `dead-xref.log.json` | 137 | 2 | `DOTX008E` with **no** `location`, `line` or `row` - it names its file in the message text alone - followed by `DOTX031E` at line 10, `row` 56. Both ERROR. |

The entry counts are the point of `--verbose`: a run of a four-file map is
roughly 130 log objects, of which one or two are findings. That is what makes
the `code` filter load-bearing rather than tidy.

A level no capture happens to contain (`FATAL`, `WARN`, `DEBUG`, `TRACE`) is
covered by a literal in the test that needs it. Do not add a hand-written log
here: a file in this directory is a capture, and one that is not would be
indistinguishable from one that is.

## What these are and are not tested by

These logs are **verbatim captures of a real run**: DITA-OT 4.4.1 on Windows,
on a JDK 17, over the maps above. Only absolute paths were rewritten, to
`/repo`, `/tmp`, `/opt/dita-ot` and `/home`. The message ids, levels, lines and
columns in the tables above are what the tool emitted.

The unit tests still **start no DITA-OT**. They inject a stub spawn and feed the
parser these captures, so the suite needs no JVM.

One test does start the real thing:
`test/lint/integration/dita-ot-smoke.test.ts`. It is skipped unless `DITA_HOME`
names an installation, and it exists to pin the *invocation* rather than the
parsing. A capture can only prove the parser reads what DITA-OT once wrote; it
cannot notice that we are running the wrong command. That is not hypothetical.
This tool's first implementation used `dita validate`, every stubbed test
passed, and the command reported none of the errors the tool exists to find.

```bash
DITA_HOME=/opt/dita-ot npx vitest run test/lint/integration/dita-ot-smoke.test.ts
```

Two things that run confirmed, and both had been assumed wrong. `row` really is
the column: the `broken-conref.dita:10:59` finding is logged as `line: 10`,
`row: 59`. And DITA-OT **exits 0 while reporting ERROR findings**, so the log is
the verdict and the exit code is not.
