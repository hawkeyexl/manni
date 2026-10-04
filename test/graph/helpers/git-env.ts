/**
 * Test-fixture environment hygiene.
 *
 * git exports GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends to every
 * subprocess it runs, including hooks. Running the suite from the husky
 * pre-push hook therefore leaked those variables into fixtures that shell out
 * to `git`, so `git init`/`git add` in a temp directory operated on the dockg
 * repository instead ("fatal: this operation must be run in a work tree").
 *
 * Not collected as a suite: vitest's `include` is `test/**\/*.test.ts`.
 */

/** Ambient environment minus every `GIT_*` variable, plus `overrides`. */
export function hermeticEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  // Applied after the strip, so deliberate GIT_AUTHOR_DATE /
  // GIT_COMMITTER_DATE overrides still take effect.
  return { ...env, ...overrides };
}
