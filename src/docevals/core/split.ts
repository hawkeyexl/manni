/**
 * Splitting long content for inference, instead of truncating it.
 *
 * Three code paths used to `slice(0, 6000)` and append "…(truncated)": `fill`,
 * `scriptgen`, and nothing at all in the judge, which sent whole pages. A page
 * over the cap was therefore filled and script-generated from its first half,
 * silently — the model never saw the rest and had no way to say so.
 *
 * Ported from docmeta's `fill`, which solved this first (`splitBody` /
 * `mergeProposals`). The contract, in full:
 *
 *   - chunks are greedy and cut at the last newline before the boundary, so a
 *     line is never split mid-sentence;
 *   - there is no overlap — a merge step, not redundancy, is what stops a
 *     boundary from losing something;
 *   - content that fits comes back as a single chunk, so the common path is
 *     byte-identical to not splitting at all;
 *   - a model complaining about context length halves the budget and retries
 *     once, because the right chunk size depends on the model, not on us.
 *
 * The chunk budget belongs in every cache key that covers chunked output.
 * docmeta documents why at its own call site: halve-and-retry makes two runs
 * at different budgets produce genuinely different results, and without the
 * budget in the key the second silently replays the first.
 */

/** Characters of content per inference call. Matches docmeta's default. */
export const DEFAULT_CHUNK_CHARS = 12000;

/**
 * Split `body` into chunks of at most `chunkChars`, cutting at line
 * boundaries. Returns `[body]` unchanged when it already fits.
 */
export function splitBody(body: string, chunkChars: number): string[] {
  if (body.length <= chunkChars) return [body];
  const chunks: string[] = [];
  let at = 0;
  while (at < body.length) {
    const end = Math.min(at + chunkChars, body.length);
    let cut = end;
    if (end < body.length) {
      const nl = body.lastIndexOf("\n", end - 1);
      if (nl > at) cut = nl + 1;
    }
    chunks.push(body.slice(at, cut));
    at = cut;
  }
  return chunks;
}

/**
 * Whether a provider error reads as "that was too much context".
 *
 * Deliberately a message match: providers do not agree on a code for this, and
 * the cost of a false positive is one retry at half the budget.
 */
export function looksLikeOverflow(message: string): boolean {
  return /context|too long|too large|token limit|maximum.*tokens|exceeds/i.test(
    message,
  );
}

/** How a part is announced to the model, when there is more than one. */
export function partLabel(index: number, total: number): string {
  return `part ${String(index + 1)} of ${String(total)}`;
}
