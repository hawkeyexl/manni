---
title: Retry a failed upload
description: Send a failed upload again.
language: en
sample-questions:
  - How do I retry a failed upload?
  - question: How many times does an upload retry by default?
    answers:
      - lines: 9
        integrity: sha256-43f97ea38783c4c88d2a558e429656b86aa00e3f5fcf5e5b284293cc41430496
  - question: How long does the first retry wait?
    answers:
      - lines: 10
        integrity: sha256-df23fed923ffb2137c8f642256bca790a4e14df8cd9bf9a42765562b9db1f774
  - question: Where does a resumed upload continue from?
    answers:
      - lines: 13
        integrity: sha256-62a4a3372920b6a9e7a835197dcde9779d06e920f82e6500bca3d7ce0a306aee
  - question: Can I retry an upload from the upload list?
    answers:
      - lines: 4
        integrity: sha256-5de3fca8338e5d6dabe6c296a09493b6b5a5dc355f2622b910c2eaa438ee3268
    generated-by: anthropic/claude-sonnet-5-5
    confidence: 0.8
    reviewed: false
---

## Retry a failed upload

Open the upload list and choose retry.

## Retry limits

Each upload gets a budget.
The client tries three more times, waiting longer each time.
The first retry waits five seconds.

## Resume a paused upload

Choose resume to continue a paused upload where it stopped.
