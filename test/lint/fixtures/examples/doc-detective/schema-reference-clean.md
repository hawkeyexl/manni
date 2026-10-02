---
type: schema-reference
---

# runShell

## Referenced In

- Test specs

## Fields

| Field | Type | Description | Default |
| --- | --- | --- | --- |
| `command` | string | Shell command to run | (required) |
| `path` | string | Working directory the command runs from | `.` |

## Examples

```json
{ "runShell": "npm test" }
```
