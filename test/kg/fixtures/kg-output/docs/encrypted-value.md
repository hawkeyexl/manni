---
title: Billing internals
description: How the metered plan is priced.
type: explanation
kg:
  label: ~AVIOmyh_reEkAwpNb-GlgHHrHY2Bzn9Rfq2aaalMZIqXsq4yvISgmlcv53cp400yua4bpPIzDZWT-trrdg
---

# Billing internals

`kg.label` is encrypted (proposal 0045). kg never decrypts, so the `~…` token
is what lands in the graph: it says a value exists and nothing about what it
is. A field that must not appear at all is marked `x-manni-kg-output: false`
instead.
