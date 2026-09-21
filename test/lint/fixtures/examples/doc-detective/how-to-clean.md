---
type: how-to
---

# Test a REST API response

## Prerequisites

A running API and a Doc Detective config.

## Step 1: Write the test spec

Create a `.spec.json` file describing the request.

```json
{ "steps": [{ "httpRequest": { "url": "https://example.com" } }] }
```

## Step 2: Run the tests

Run `doc-detective test` from the project root.

```json
{ "config": "./doc-detective.config.json" }
```

## Verify it works

The command exits `0` and reports every step as passing.

## Troubleshooting

If a request times out, check that the target host is reachable from CI.

## Next steps

Add assertions to check the response body.
