// Limits of the fetcher.
// Two comment lines sit above the ladder SOURCE, so every line moved by two.
export const MAX_FILES = 10_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const RETRIES = 3;

export function limits() {
  return { MAX_FILES, FETCH_TIMEOUT_MS, RETRIES };
}
