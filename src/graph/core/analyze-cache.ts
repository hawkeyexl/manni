/**
 * The cross-run cache for page parses.
 *
 * Parsing the body is most of what `graph build` spends on a page, and most
 * pages do not change between runs. `manni check` builds the graph on every
 * agent stop, so the parse is cached: one JSON file per page label under
 * `.manni/graph/analyze-cache/`, overwritten when the page changes. The
 * cache therefore holds about one entry per page ever built here.
 *
 * Only `parseBody`'s output is stored, which is a pure function of the bytes
 * and the format. Frontmatter, link resolution against the corpus, routes,
 * the meta view and git history all run on every build, so nothing a cache
 * entry holds depends on another page or on the clock.
 *
 * A cache is an optimization: an unreadable, unparseable or malformed entry
 * is a miss, and a write that fails is dropped. Neither can fail a run.
 * Node-only: the runtime and embed bundles never import it.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeTextAtomic } from "../../shared/write-file.js";
import pkg from "../../../package.json" with { type: "json" };
import { parseBody, type DocBody, type DocFormat } from "./analyze.js";

/**
 * Where the cache lives, relative to the working directory, beside the
 * `fill` proposal cache (`.manni/graph/cache`) and the `embed` vector cache.
 */
export const ANALYZE_CACHE_DIR = ".manni/graph/analyze-cache";

/**
 * The entry format. Bump it when `parseBody` changes what it returns, so a
 * development build does not read entries an older parse wrote under the
 * same package version.
 */
const ENTRY_VERSION = 1;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

function isSection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.slug === "string" &&
    typeof s.title === "string" &&
    typeof s.level === "number" &&
    typeof s.order === "number" &&
    (s.parentSlug === null || typeof s.parentSlug === "string")
  );
}

function isDocBody(value: unknown): value is DocBody {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    (b.firstH1 === undefined || typeof b.firstH1 === "string") &&
    Array.isArray(b.sections) &&
    b.sections.every(isSection) &&
    isStrings(b.linkTargets) &&
    isStrings(b.imageTargets) &&
    isStrings(b.codeLanguages)
  );
}

export class AnalyzeCache {
  /** Pages this run served from the cache. */
  hits = 0;
  /** Pages this run parsed. */
  misses = 0;
  private readonly writes: Promise<void>[] = [];

  constructor(
    private readonly dir: string,
    private readonly version: string = pkg.version,
  ) {}

  /** `parseBody`, served from the entry for `path` when its key matches. */
  readonly parse = (content: string, path: string, format: DocFormat): DocBody => {
    const key = sha256(JSON.stringify([ENTRY_VERSION, this.version, format, path, content]));
    // Named by a digest, so a label's `..` or `:` cannot choose where it lands.
    const file = join(this.dir, `${sha256(path)}.json`);
    const cached = readEntry(file, key);
    if (cached !== undefined) {
      this.hits++;
      return cached;
    }
    const body = parseBody(content, path, format);
    this.misses++;
    this.writes.push(this.write(file, JSON.stringify({ key, body })));
    return body;
  };

  /** Wait for this run's writes. Never rejects. */
  async flush(): Promise<void> {
    await Promise.all(this.writes);
  }

  private async write(file: string, text: string): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await writeTextAtomic(file, text);
    } catch {
      // Best-effort: the next run parses this page again.
    }
  }
}

function readEntry(file: string, key: string): DocBody | undefined {
  try {
    const entry = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof entry !== "object" || entry === null) return undefined;
    const { key: stored, body } = entry as Record<string, unknown>;
    return stored === key && isDocBody(body) ? body : undefined;
  } catch {
    return undefined;
  }
}
