/**
 * URL helpers for the crawl.
 *
 * Three questions, asked of every candidate before it enters the frontier:
 * what is its canonical spelling (so `/a#top` and `/a` are one page), is it
 * on a host the run is allowed to visit, and is it a page at all rather than
 * a stylesheet or a PDF. The WHATWG parser does most of the first one.
 */
import { A11yError } from "../types.js";

/**
 * Canonical spelling for dedupe: parse with `new URL`, drop the fragment,
 * lowercase the hostname, drop a default port, keep path/query/trailing slash
 * exactly as given. Throws `A11yError` for an unparseable string.
 */
export function normalizeUrl(url: string): string {
  const parsed = parse(url);
  if (parsed === null) throw new A11yError(`Not a valid URL: "${url}".`);
  parsed.hash = "";
  return parsed.href;
}

/** `http:` or `https:` and parseable. */
export function isHttpUrl(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && isHttpProtocol(parsed);
}

/**
 * Same site = same hostname (case-insensitive) and same non-default port.
 * `http://` and `https://` of one host are the same site; `www.example.com`
 * and `example.com` are not.
 */
export function sameHost(a: string, b: string): boolean {
  const left = parse(a);
  const right = parse(b);
  if (left === null || right === null) return false;
  // The parser has already dropped `:80` on http and `:443` on https, so an
  // empty port on both sides means "the scheme's default" and the two schemes
  // of one host compare equal, as the doc comment promises. Only an explicit
  // non-default port survives to differ.
  return (
    left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
    left.port === right.port
  );
}

/**
 * A link worth loading as a page: http(s), not `mailto:`/`tel:`/`javascript:`/
 * `data:`, and the last path segment does not end in one of ASSET_EXTENSIONS.
 */
export function isPageLink(url: string): boolean {
  const parsed = parse(url);
  if (parsed === null || !isHttpProtocol(parsed)) return false;
  const last = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  if (dot === -1) return true;
  return !ASSET_EXTENSIONS.has(last.slice(dot).toLowerCase());
}

export const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pdf",
  ".zip",
  ".gz",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".json",
  ".xml",
  ".txt",
  ".mp3",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}
