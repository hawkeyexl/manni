---
title: Retries
description: How the client retries failed requests.
language: en
concepts: [Retry, Time-out]
keywords: [idempotency key]
graph:
  label: Retry
  alt-labels: [Retries]
  broader: [Errors]
  related-concepts: [Backoff]
---

The client retries a request that timed out.
Send the same idempotency key with each retry.
