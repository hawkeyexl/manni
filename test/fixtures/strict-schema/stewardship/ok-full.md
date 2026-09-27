---
authors:
  - Jane Doe
  - name: Sam Reviewer
    email: sam@example.com
    url: https://example.com/sam
    affiliation: Example Inc
owner: "@org/docs"
stakeholders: ["@maya", jane.doe@example.com]
reviewed-by: ["@sam"]
created: 2025-11-04
last-updated: 2026-08-20T10:15:00Z
last-reviewed: 2026-08-20T10:15:00.5+02:00
review-interval: P90D
verified-against:
  - operator 1.4.2
  - name: kubernetes
    version: "1.30"
source-of-truth:
  - charts/operator/values.yaml
  - path: charts/operator/values.yaml
    kind: helm-values
  - url: https://github.com/example/operator
---

Every stewardship field in the form the strict overlay accepts.
