/** `manni docevals init` — scaffold a starter manni.config.yaml. */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DocevalsError } from "../types.js";
import { DEFAULT_CONFIG_FILENAME } from "../core/config.js";

const STARTER_CONFIG = `# manni.config.yaml — shared configuration for the manni family of tools.
# Each tool reads its own top-level key; manni docevals reads "docevals:".
# Docs: https://hawkeyexl.github.io/manni/docevals/

# The documents every manni tool reads, declared once. A bare
# \`manni docevals run\` evaluates every collection listed here; pass
# --collection <name> to pick one, or name paths on the command line instead.
# node_modules and .git are never read.
collections:
  - name: site
    paths:
      - "docs/**/*.{md,mdx}"

docevals:
  defaults:
    # Suite applied to pages without an eval-suite frontmatter key. Naming the
    # suite defined at the bottom of this file is what makes a fresh corpus
    # check anything at all: with "null", a page carrying no eval frontmatter
    # resolves zero evals, and a run over zero evals is a usage error rather
    # than a green build (ADR 01041).
    suite: default
    failFast: false
    concurrency: 4

  # auto detects what this machine can use: an Anthropic key, then an OpenAI
  # key, then the Claude CLI, then a local model. Name one to pin it.
  provider: auto # auto | anthropic | openai | claude-cli | llama-cpp
  # model: <id>  # needs a named provider; unset takes that provider's default
  # providers:   # connection settings only
  #   anthropic: { apiKeyEnv: ANTHROPIC_API_KEY }
  #   openai: { baseUrl: http://localhost:11434/v1, apiKeyEnv: OPENAI_API_KEY }
  #   claude-cli: { command: claude } # uses local CLI auth, no API key

  judge:
    ensembleRuns: 3 # 3 isolated runs per eval; agreement is signal
    # NOTE: defaults.suite attaches an ai eval to every discovered page, so a
    # keyed run on a large corpus issues ensembleRuns x pages requests. Set
    # maxTurns once you know what a full pass costs you — deliberately, and
    # high enough to cover the corpus. A budget set *below* what a full pass
    # needs stops early, reports the remaining pages as skipped, and still exits
    # 0 (ADR 01019): partial coverage that reads as success. Start with
    # --deterministic-only, which needs no provider at all.
    temperature: 0
    zones:
      autoPass: 0.8 # unanimous pass + mean confidence >= 0.8
      autoFail: 0.8
    falsePositiveAlert: 0.15
    cacheDir: .manni/docevals/cache

  execution:
    # Default deny. Grant only what this corpus needs, and only if you trust
    # whoever can edit its pages:
    #   frontmatter-commands  - command evals declared in page frontmatter
    #   page-embedded-steps   - tool:doc-detective running steps in page bodies
    allow: []

  scripts:
    dir: "{docDir}/manni-docevals" # generated check scripts live beside the docs
    configDir: manni-docevals-scripts

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
