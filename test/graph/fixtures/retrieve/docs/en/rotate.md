---
title: Rotate the encryption key
description: Replace the encryption key and re-encrypt every value under the new one.
audience: admin
tags: [security, keys]
---

# Rotate the encryption key

Rotation replaces the encryption key. Set it up first, as [Set up encryption](setup.md) shows.

## Rotate the key with the CLI

Run the rotate command with the new key. It re-encrypts every encrypted value and then stores the new key.

## What rotation re-encrypts

Rotation re-encrypts encrypted frontmatter values and encrypted citation paths.
