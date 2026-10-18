---
title: Payments
description: Taking a payment safely.
language: en
concepts: [Retries]
keywords: [Idempotency key]
graph:
  label: Backoff
  definition: Waiting longer between each retry.
---

A payment request carries an idempotency key, so a retry never charges twice.
