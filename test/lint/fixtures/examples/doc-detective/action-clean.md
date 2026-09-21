---
type: action
---

# runShell

Executes a shell command as a test step.

## Examples

### Run a script

```json
{ "runShell": "npm test" }
```

### Run with a working directory

```json
{ "runShell": { "command": "npm test", "path": "./packages/app" } }
```
