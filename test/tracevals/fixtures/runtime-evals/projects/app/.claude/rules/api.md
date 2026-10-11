---
paths:
  - "src/api/**"
---
# API handlers

- Return every error from a handler through `httpError(status, message)`, and never throw a bare `Error`.
- Never log a request body, since a body can hold personal data.
