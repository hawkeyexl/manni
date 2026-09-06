/** `manni docevals init` — scaffold a starter manni.config.yaml. */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DocevalsError } from "../types.js";
import { DEFAULT_CONFIG_FILENAME } from "../core/config.js";

const STARTER_CONFIG = `# manni.config.yaml — shared configuration for the manni family of tools.
# Each tool reads its own top-level key; manni docevals reads "docevals:".
# Docs: https://github.com/hawkeyexl/manni docevals
docevals:
  version: 1

  files:
    include:
      - "docs/**/*.{md,mdx}"
    exclude:
      - "**/node_modules/**"

  defaults:
    # Suite applied to pages without an eval-suite frontmatter key. Naming the
    # suite defined at the bottom of this file is what makes a fresh corpus
    # check anything at all: with "null", a page carrying no eval frontmatter
    # resolves zero evals, and a run over zero evals is a usage error rather
    # than a green build (ADR 01041).
    suite: default
    fail-fast: false
    concurrency: 4

  provider:
    default: anthropic
    anthropic:
      model: claude-sonnet-4-5 # pin your judge model; never "latest"
      api-key-env: ANTHROPIC_API_KEY
    # openai:
    #   base-url: http://localhost:11434/v1   # any OpenAI-compatible server
    #   model: llama3.1:8b
    # claude-cli:
    #   model: claude-sonnet-4-5             # uses local CLI auth, no API key

  judge:
    ensemble-runs: 3 # 3 isolated runs per eval; agreement is signal
    # NOTE: defaults.suite attaches an ai eval to every discovered page, so a
    # keyed run on a large corpus issues ensemble-runs x pages requests. Set
    # max-turns once you know what a full pass costs you — deliberately, and
    # high enough to cover the corpus. A budget set *below* what a full pass
    # needs stops early, reports the remaining pages as skipped, and still exits
    # 0 (ADR 01019): partial coverage that reads as success. Start with
    # --deterministic-only, which needs no provider at all.
    temperature: 0
    zones:
      auto-pass: 0.8 # unanimous pass + mean confidence >= 0.8
      auto-fail: 0.8
    false-positive-alert: 0.15
    cache-dir: .manni/docevals/cache

  execution:
    # Default deny. Grant only what this corpus needs, and only if you trust
    # whoever can edit its pages:
    #   frontmatter-commands  - command evals declared in page frontmatter
    #   page-embedded-steps   - tool:doc-detective running steps in page bodies
    allow: []

  scripts:
    dir: "{docDir}/manni-docevals" # generated check scripts live beside the docs
    config-dir: manni-docevals-scripts

  evals:
    no-future-promises:
      type: regression
      assertion: The page makes no claims about unreleased or future functionality.
      grader: ai
      evidence: All prose sections
      examples:
        pass: Describes only shipped behavior.
        fail: Says "coming soon" or references an unreleased version.
    fresh-enough:
      assertion: Page was reviewed within the last year.
      grader: tool:freshness
      options:
        field: last-reviewed
        max-age-days: 365
      severity: warning

  suites:
    default:
      target-pass-rate: 1.0 # regression suites target ~100%
      evals: [no-future-promises, fresh-enough]
`;

export function runInit(cwd = process.cwd()): string {
  const path = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (existsSync(path)) {
    throw new DocevalsError(`${DEFAULT_CONFIG_FILENAME} already exists`);
  }
  writeFileSync(path, STARTER_CONFIG);
  return path;
}
