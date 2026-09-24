export const MAX_FILES = 10_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const RETRIES = 3;

export function limits() {
  // Why: the three limits travel together, so callers read one object.
  // Changing one without the others is the bug this shape prevents.
  return { MAX_FILES, FETCH_TIMEOUT_MS, RETRIES };
}
