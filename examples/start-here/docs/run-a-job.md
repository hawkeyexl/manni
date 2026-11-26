---
title: Run a job
description: Send your first job and read its result.
type: how-to
---

# Run a job

## Overview

Run a job to check that the widget CLI works before you script it.

## Send the job

1. Run the `hello` job.

   ```sh
   node src/widget.mjs run hello
   ```

2. Read the result. The job prints its name and its state.

   ```text
   Job hello: done
   ```

## See also

Read how timeouts work.
