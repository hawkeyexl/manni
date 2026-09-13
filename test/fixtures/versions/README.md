# Versions fixture

The Action: `uses: hawkeyexl/manni@v0`.
An immutable Action: `uses: hawkeyexl/manni@v1.0.0`.
Pin a major: `npx -y @hawkeyexl/manni@0 meta validate`.
Pin a release: `npm install @hawkeyexl/manni@1.2.3`.
Newest: `npx -y @hawkeyexl/manni@latest meta validate`, or `npx -y @hawkeyexl/manni meta validate`.

```yaml
repos:
  - repo: https://github.com/hawkeyexl/manni
    rev: v0.1.0 # the hook definition
    hooks:
      - id: manni-meta
  - repo: https://github.com/example/other-hooks
    rev: v1.0.0
    hooks:
      - id: other
```
