/**
 * Fetch a remote sidecar manifest (proposal 0038).
 *
 * A manifest named by URL is fetched at the start of every run and never
 * cached: it is data that changes with every page, and a stale copy validates
 * the corpus against the wrong values. The bounds are the schema fetch's —
 * the same timeout, the same body cap, one narrow retry — because they exist
 * for the same reason there (0008 § stress test 4), and a manifest is
 * smaller than most schemas.
 *
 * The credential, when there is one, comes from the environment and is sent
 * as a bearer token to the origin the config named and nowhere else. It
 * never appears in a message: every error here names the URL and the status,
 * and the URL was checked at config time to carry no userinfo.
 */
import { DocmetaError } from "../types.js";

/** Default network timeout, matching the schema fetch. */
export const SIDECAR_FETCH_TIMEOUT_MS = 10_000;

/** Body cap, matching the schema fetch. */
export const SIDECAR_FETCH_MAX_BYTES = 5 * 1024 * 1024;

/** Redirects followed before giving up. */
const MAX_REDIRECTS = 5;

/** Backoff before the single retry. */
const RETRY_DELAY_MS = 500;

export interface SidecarFetchOptions {
  /** Environment variable holding a bearer token. Absent means an anonymous request. */
  tokenEnv?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** `--offline` / `offline:`: refuse rather than fetch. */
  offline?: boolean;
  /** For tests: the environment to read `tokenEnv` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Whether a URL may name a sidecar manifest: `https://` anywhere, or `http://`
 * on a loopback host only, where plaintext leaks nothing. Userinfo is refused
 * because the URL is printed in every diagnostic and a secret in it would
 * print too. Returns the reason it may not, or `null`.
 */
export function sidecarUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "is not a valid URL";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return 'carries a credential in the URL; put the token in an environment variable and name it with "tokenEnv"';
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return null;
  if (parsed.protocol === "http:") {
    return "is plain http://; a bearer token over plaintext is a leak, and a public manifest is served over https too";
  }
  return `has the unsupported scheme "${parsed.protocol}"`;
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.startsWith("127.")
  );
}

/** Fetch one remote manifest. Resolves to its text; throws `DocmetaError`. */
export async function fetchSidecar(
  url: string,
  opts: SidecarFetchOptions = {},
): Promise<string> {
  if (opts.offline) {
    throw new DocmetaError(
      `Sidecar manifest ${url} is remote and the run is offline. Vendor it to a path, or drop --offline.`,
    );
  }
  const timeoutMs = opts.timeoutMs ?? SIDECAR_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? SIDECAR_FETCH_MAX_BYTES;
  const env = opts.env ?? process.env;
  let token: string | undefined;
  if (opts.tokenEnv !== undefined) {
    token = env[opts.tokenEnv];
    if (token === undefined || token === "") {
      throw new DocmetaError(
        `Sidecar manifest ${url}: the environment variable ${opts.tokenEnv} named by "tokenEnv" is not set.`,
      );
    }
  }

  let res = await requestWithRedirects(url, token, timeoutMs);
  // One retry, on the failures that can heal: a network error or a 5xx. A
  // 4xx will not, and retrying it only doubles the time to the same answer.
  if (res instanceof Error || res.status >= 500) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    res = await requestWithRedirects(url, token, timeoutMs);
  }
  if (res instanceof Error) {
    throw new DocmetaError(
      `Sidecar manifest ${url} could not be fetched: ${res.message}`,
    );
  }
  if (!res.ok) {
    const hint =
      res.status === 404 && token === undefined
        ? " (a private file answers 404 without a token; set \"tokenEnv\")"
        : res.status === 404
          ? " (a private file answers 404 without a valid token)"
          : "";
    throw new DocmetaError(
      `Sidecar manifest ${url} could not be fetched: HTTP ${res.status}${hint}.`,
    );
  }
  return readCapped(url, res, maxBytes);
}

/**
 * GET with manual redirect handling, so the bearer token follows only a
 * same-origin redirect. A cross-origin hop is followed without it, the way
 * browsers and curl behave; if the manifest lives where the token does not
 * reach, the 401 that results is reported rather than the token leaked.
 *
 * Resolves to the final `Response`, or to the `Error` a network failure or
 * timeout raised, so the caller can decide what to retry.
 */
async function requestWithRedirects(
  url: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<Response | Error> {
  const origin = new URL(url).origin;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const sameOrigin = new URL(current).origin === origin;
    const headers: Record<string, string> = { accept: "text/plain, application/x-yaml, */*" };
    if (token !== undefined && sameOrigin) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(current, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "TimeoutError";
      return isAbort
        ? new Error(`timed out after ${timeoutMs}ms`)
        : new Error(err instanceof Error ? err.message : String(err));
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location === null) return res;
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return new Error(`more than ${MAX_REDIRECTS} redirects`);
}

/** Read a body, aborting once it exceeds `maxBytes`; content-length is advisory. */
async function readCapped(
  url: string,
  res: Response,
  maxBytes: number,
): Promise<string> {
  const body = res.body;
  if (!body) return "";
  // `Response.body` is typed `ReadableStream<any>`; name the chunk type once
  // at the boundary, as the schema fetch does, so the cap is counted in
  // numbers rather than `any` arithmetic.
  const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value }: { done: boolean; value?: Uint8Array } =
      await reader.read();
    if (done || value === undefined) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DocmetaError(
        `Sidecar manifest ${url} is too large: the response exceeds the ${maxBytes}-byte limit.`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
