export const RETRIES = 3;
export const BACKOFF_MS = 500;
export function retry(): number {
  return RETRIES;
}
