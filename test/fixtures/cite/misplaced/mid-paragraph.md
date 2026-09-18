---
title: Crawl
citations:
  - id: fresh-context
    claim:
      integrity: sha256-fc44fc98010dc78d25a4994cd7291f08ac7719f0ee7bf629b37c0a074797dcfc
    source:
      file: src/limits.ts
      lines: 3
      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
---
# Crawl

Pages are checked one at a time, in the order the crawl found them.
A page that fails to load is reported, and the crawl moves on.
<!-- cite fresh-context -->
Each URL is loaded in a fresh browser context, so no state carries over
from one page to the next.
