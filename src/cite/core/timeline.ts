/**
 * The pin timeline (proposal 0092): every citation's source end, classified
 * at each first-parent commit of `HEAD`, and the stale windows that makes.
 *
 * Each commit is read as it stood. Its own `manni.config.yaml` decides where
 * the entries live, and its tree supplies the pages, the manifests and the
 * sources. The working tree is never read. The tree is rebuilt by replaying
 * each commit's first-parent changes, and a blob is read only when something
 * that depends on it changed.
 *
 * The classification at a commit is `classifyCitation`'s, over an index of
 * that commit's tree and a git client whose `HEAD` is that commit. So the
 * move search, the cross-file follow (0055) and the derived baseline (0097)
 * are the ones `check` would have run there. A citation whose entry and
 * source blob are unchanged since a commit where it held, or moved within its
 * own file, keeps that verdict: neither depends on any other file.
 *
 * Config and manifests are meta's loaders, so they are written to a scratch
 * directory laid out like the repository and read from there. Only the config
 * and the manifests are written; a page's text is handed over directly.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { classifyRef, writeFileAtomic } from "../../meta/index.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { hasPagePlaceholder, pageManifestPath } from "../../shared/page-manifest.js";
import type { PageCitation, SourceIndex, SourceStatus } from "../types.js";
import { classifyCitation } from "./classify.js";
import { parseCiteConfig, readCiteConfigFile } from "./config.js";
import { blobReader, firstParentLog, gitClient, type BlobReader, type WalkCommit } from "./git.js";
import { readPage } from "./page.js";
import { parseSrc, sourceRange, spellSource } from "./range.js";
import { CITATIONS_KEY, loadCitationSidecars } from "./sidecar.js";
import { createSourceCache, resolveSourcePath } from "./sources.js";

/** The source-end rules a window opens on. */
export type WindowRule = "source-changed" | "source-missing" | "source-never-true";

/** Why a window closed. */
export type WindowCause = "re-pinned" | "source-restored" | "removed";

export interface TimelinePage {
  /** The page as the run reports it. */
  label: string;
  /** Its path at `HEAD`, posix, relative to the repository top. */
  path: string;
}

export interface TimelineInput {
  /** The repository top: where the walk's git runs. */
  top: string;
  /** Where `src:` paths resolve from: the run's root, inside `top`. */
  root: string;
  pages: readonly TimelinePage[];
  /** The run's config file, posix and relative to `top`. Absent with none. */
  config?: string;
  /** The run's base, posix and relative to `top`: a page's label at a commit is spelled from it. */
  base: string;
  /** The family encryption key. */
  key?: string;
  /** `--as`: the page format. */
  format?: string;
  /** Read only commits within this many seconds of `HEAD`'s committer time. */
  within?: number;
}

export interface TimelineWindow {
  /** The page's label at `HEAD`. */
  page: string;
  /** The entry's id, or its pointer when it has none. */
  id: string;
  /** The entry's position in the page's list when the window opened. */
  index: number;
  /** The source as the entry spelled it when the window opened. */
  source: string;
  rule: WindowRule;
  /** Index of the opening commit. */
  opened: number;
  /** Already open at the first commit the walk read. */
  bounded: boolean;
  closed?: { at: number; by: WindowCause };
  /** The page's paths while the window was open, oldest first. */
  paths: string[];
}

export interface Timeline {
  /** `HEAD`'s first-parent history, oldest first. */
  commits: WalkCommit[];
  /** Index of the first commit read. `commits.length` when none was. */
  start: number;
  windows: TimelineWindow[];
  /** Citations the walk read, by page and id. */
  citations: number;
  /** Encrypted citations skipped for want of a key. */
  encrypted: number;
  /** Set when an older commit's config did not load: the walk read nothing before `start`. */
  unread: boolean;
}

/** A blob and its mode, at one path of the tree. */
interface Leaf {
  blob: string;
  mode?: string;
}

/** What one citation's source end was at the last commit that read it. */
interface PinState {
  /** The entry's file, lines and integrity. */
  pin: string;
  /** The source's blob at that commit. */
  blob: string | undefined;
  status: SourceStatus;
  /** The verdict depends on nothing but the entry and that blob. */
  stable: boolean;
}

interface OpenWindow extends TimelineWindow {
  pinAtOpen: string;
}

/** The commits a rename moved each page at, walking back from `HEAD`. */
function trackRenames(
  commits: readonly WalkCommit[],
  pages: readonly TimelinePage[],
  start: number,
): { paths: Map<string, string>; renames: Map<number, { label: string; to: string }[]> } {
  const paths = new Map(pages.map((page) => [page.label, page.path]));
  const renames = new Map<number, { label: string; to: string }[]>();
  for (let i = commits.length - 1; i > start; i--) {
    const from = new Map<string, string>();
    for (const change of commits[i]?.changes ?? []) {
      if (change.from !== undefined) from.set(change.path, change.from);
    }
    if (from.size === 0) continue;
    for (const [label, path] of paths) {
      const old = from.get(path);
      if (old === undefined) continue;
      const at = renames.get(i) ?? [];
      at.push({ label, to: path });
      renames.set(i, at);
      paths.set(label, old);
    }
  }
  return { paths, renames };
}

const toPosix = (path: string): string => path.split(sep).join("/");

/** Whether a tree entry is a file the source index would admit: not a symlink, not a submodule. */
const isFile = (leaf: Leaf): boolean => leaf.mode !== "120000" && leaf.mode !== "160000";

/** The rule a status opens a window on, or undefined when the pin is supported. */
function ruleOf(status: SourceStatus): WindowRule | undefined {
  if (status === "changed" || status === "missing" || status === "never-true") return `source-${status}`;
  return undefined;
}

export async function buildTimeline(input: TimelineInput): Promise<Timeline> {
  const commits = await firstParentLog(input.top);
  const head = commits[commits.length - 1];
  const since = input.within === undefined || head === undefined ? undefined : head.time - input.within;
  const bound = since === undefined ? 0 : commits.findIndex((commit) => commit.time >= since);
  let start = bound === -1 ? commits.length : bound;
  const { paths, renames } = trackRenames(commits, input.pages, start);
  const blobs = blobReader(input.top);
  const snap = await mkdtemp(join(tmpdir(), "manni-cite-history-"));
  try {
    const walk = new Walk(input, blobs, snap, paths);
    const tree = new Map<string, Leaf>();
    let unread = false;
    for (const [i, commit] of commits.entries()) {
      for (const change of commit.changes) {
        if (change.blob === undefined) tree.delete(change.path);
        else tree.set(change.path, { blob: change.blob, ...(change.mode === undefined ? {} : { mode: change.mode }) });
      }
      if (i < start) continue;
      for (const { label, to } of renames.get(i) ?? []) paths.set(label, to);
      if (!(await walk.read(i, commit, tree, i === start))) {
        // This commit's config or manifests do not load: nothing before the next one
        // counts, and a window open there is bounded.
        walk.reset();
        start = i + 1;
        unread = true;
      }
    }
    return {
      commits,
      start,
      windows: walk.windows(),
      citations: walk.seen.size,
      encrypted: walk.encrypted.size,
      unread,
    };
  } finally {
    blobs.close();
    await rm(snap, { recursive: true, force: true });
  }
}

/** A page's entries as last read, and what they were read from. */
interface PageEntries {
  key: string;
  entries: PageCitation[];
}

/** The walk's state across commits. */
class Walk {
  readonly seen = new Set<string>();
  readonly encrypted = new Set<string>();
  private readonly open = new Map<string, OpenWindow>();
  private closed: TimelineWindow[] = [];
  private readonly states = new Map<string, PinState>();
  private readonly pages = new Map<string, PageEntries>();
  /** What each scratch path holds now, by repository path. */
  private readonly written = new Map<string, string>();
  private configBlob: string | undefined | null = null;
  private config: ConfigFile | null = null;
  private readonly prefix: string;

  constructor(
    private readonly input: TimelineInput,
    private readonly blobs: BlobReader,
    private readonly snap: string,
    private readonly paths: Map<string, string>,
  ) {
    const rel = toPosix(relative(input.top, input.root));
    this.prefix = rel === "" ? "" : `${rel}/`;
  }

  /** Forget everything read so far: the history before this point is unread. */
  reset(): void {
    this.open.clear();
    this.closed = [];
    this.states.clear();
    this.pages.clear();
    this.seen.clear();
    this.encrypted.clear();
    this.configBlob = null;
  }

  windows(): TimelineWindow[] {
    const strip = ({ pinAtOpen: _, ...window }: OpenWindow): TimelineWindow => window;
    return [...this.closed, ...[...this.open.values()].map(strip)];
  }

  /** Read one commit. False when its config or citation manifests do not load. */
  async read(i: number, commit: WalkCommit, tree: ReadonlyMap<string, Leaf>, first: boolean): Promise<boolean> {
    const configBlob = this.input.config === undefined ? undefined : tree.get(this.input.config)?.blob;
    if (configBlob !== this.configBlob) {
      if (!(await this.loadConfig(configBlob))) return false;
      this.configBlob = configBlob;
      this.pages.clear();
    }
    if (!(await this.readPages(tree))) return false;
    await this.classify(i, commit, tree, first);
    return true;
  }

  private async loadConfig(blob: string | undefined): Promise<boolean> {
    const at = this.input.config;
    if (blob === undefined || at === undefined) {
      this.config = null;
      return true;
    }
    await this.sync(at, blob);
    const abs = join(this.snap, at);
    try {
      const file = await readCiteConfigFile(abs, dirname(abs));
      if (file !== null) parseCiteConfig(file.value, file.source);
      this.config = file;
      return true;
    } catch {
      return false;
    }
  }

  /** Write a repository path's blob to the scratch directory, or remove it. */
  private async sync(path: string, blob: string | undefined): Promise<void> {
    if (this.written.get(path) === blob) return;
    const abs = join(this.snap, path);
    if (blob === undefined) {
      await rm(abs, { force: true });
      this.written.delete(path);
      return;
    }
    // Through meta's write, so a parse cached for the path's old bytes is dropped.
    await writeFileAtomic(abs, await this.blobs.read(blob), { createParents: true });
    this.written.set(path, blob);
  }

  /** The repository paths of the manifests that may keep a page's citations at this commit. */
  private manifestsFor(pagePath: string): string[] {
    const config = this.config;
    if (config === null) return [];
    const out: string[] = [];
    for (const collection of config.collections) {
      for (const manifest of collection.externalMetadata) {
        if (manifest.keys !== undefined && !manifest.keys.includes(CITATIONS_KEY)) continue;
        if (classifyRef(manifest.file).kind === "url") continue;
        const abs = hasPagePlaceholder(manifest.file)
          ? pageManifestPath(manifest.file, config.dir, join(this.snap, pagePath))
          : { abs: isAbsolute(manifest.file) ? manifest.file : resolve(config.dir, manifest.file) };
        if (!("abs" in abs)) continue;
        const rel = toPosix(relative(this.snap, abs.abs));
        if (rel.startsWith("../") || isAbsolute(rel)) continue;
        out.push(rel);
      }
    }
    return out;
  }

  /** Re-read the entries of every page whose text, manifests or config changed. False when the manifests do not load. */
  private async readPages(tree: ReadonlyMap<string, Leaf>): Promise<boolean> {
    const dirty: { label: string; path: string; blob: string; key: string; manifests: string[] }[] = [];
    for (const page of this.input.pages) {
      const path = this.paths.get(page.label) ?? page.path;
      const blob = tree.get(path)?.blob;
      const manifests = blob === undefined ? [] : this.manifestsFor(path);
      const key = [String(this.configBlob), path, String(blob), ...manifests.map((m) => `${m}:${String(tree.get(m)?.blob)}`)].join("\0");
      if (this.pages.get(page.label)?.key === key) continue;
      if (blob === undefined) this.pages.set(page.label, { key, entries: [] });
      else dirty.push({ label: page.label, path, blob, key, manifests });
    }
    if (dirty.length === 0) return true;

    const config = this.config;
    const base = join(this.snap, this.input.base);
    let sidecars: Awaited<ReturnType<typeof loadCitationSidecars>> = null;
    if (config !== null && config.collections.length > 0) {
      for (const manifest of new Set(dirty.flatMap((page) => page.manifests))) {
        await this.sync(manifest, tree.get(manifest)?.blob);
      }
      try {
        sidecars = await loadCitationSidecars({
          collections: config.collections,
          configDir: config.dir,
          base,
          configSource: config.source,
          ...(this.input.key === undefined ? {} : { key: this.input.key }),
          pages: dirty.map((page) => join(this.snap, page.path)),
        });
      } catch {
        return false;
      }
    }
    for (const page of dirty) {
      const label = toPosix(relative(base, join(this.snap, page.path)));
      const before = this.pages.get(page.label)?.entries ?? [];
      try {
        const content = await this.blobs.read(page.blob);
        const setup = await sidecars?.forPage(label, content, this.input.format);
        const owner = setup?.owner;
        const read = readPage(label, content, {
          ...(this.input.format === undefined ? {} : { format: this.input.format }),
          ...(owner === undefined ? {} : { owned: { file: owner.file, collection: owner.collection } }),
          ...(owner === undefined || setup?.citations === undefined ? {} : { citations: setup.citations }),
        });
        this.pages.set(page.label, { key: page.key, entries: read.citations });
      } catch {
        // A page this version cannot read at this commit keeps what it last
        // said, so a broken commit is no event.
        this.pages.set(page.label, { key: page.key, entries: before });
      }
    }
    return true;
  }

  /** The index and client a commit's classification reads through, built once per commit when first needed. */
  private atCommit(commit: WalkCommit, tree: ReadonlyMap<string, Leaf>): Parameters<typeof classifyCitation>[1] {
    const { prefix } = this;
    let files: string[] | undefined;
    const leaf = (path: string): Leaf | undefined => {
      const found = tree.get(prefix + path);
      return found !== undefined && isFile(found) ? found : undefined;
    };
    const index: SourceIndex = {
      files: () =>
        (files ??= [...tree.entries()]
          .filter(([path, found]) => path.startsWith(prefix) && isFile(found))
          .map(([path]) => path.slice(prefix.length))
          .sort()),
      has: (path) => leaf(path) !== undefined,
      read: async (path) => {
        const found = leaf(path);
        if (found === undefined) return undefined;
        try {
          return await this.blobs.read(found.blob);
        } catch {
          return undefined;
        }
      },
    };
    return {
      root: this.input.root,
      index,
      git: gitClient(this.input.root, commit.sha),
      cache: createSourceCache(),
      ...(this.input.key === undefined ? {} : { key: this.input.key }),
    };
  }

  private async classify(i: number, commit: WalkCommit, tree: ReadonlyMap<string, Leaf>, first: boolean): Promise<void> {
    let options: Parameters<typeof classifyCitation>[1] | undefined;
    const present = new Set<string>();
    for (const page of this.input.pages) {
      const path = this.paths.get(page.label) ?? page.path;
      for (const entry of this.pages.get(page.label)?.entries ?? []) {
        const { source } = entry.citation;
        const id = entry.citation.id ?? `/citations/${String(entry.origin.index)}`;
        const key = `${page.label}\0${id}`;
        if (present.has(key)) continue;
        const range = sourceRange(source);
        const resolved = resolveSourcePath(range, this.input.key);
        if ("reason" in resolved && resolved.reason === "no-key") {
          this.encrypted.add(key);
          continue;
        }
        present.add(key);
        this.seen.add(key);
        const pin = JSON.stringify([source.file, source.lines ?? null, source.integrity]);
        const blob = "path" in resolved ? tree.get(this.prefix + resolved.path)?.blob : undefined;
        const held = this.states.get(key);
        let status: SourceStatus;
        if (held !== undefined && held.stable && held.pin === pin && held.blob === blob) {
          status = held.status;
        } else {
          options ??= this.atCommit(commit, tree);
          const end = await classifyCitation(entry, options);
          status = end.status;
          // A move inside the pin's own file is found before any other file
          // is looked at, so it stands while the entry and the blob do.
          const own = (src: string): boolean => parseSrc(src).path === range.path;
          const stable =
            status === "current" ||
            (status === "moved" && own(end.newSrc ?? "")) ||
            (status === "moved-ambiguous" && (end.candidates ?? []).every(own));
          this.states.set(key, { pin, blob, status, stable });
        }

        const rule = ruleOf(status);
        const window = this.open.get(key);
        if (rule !== undefined && window === undefined) {
          this.open.set(key, {
            page: page.label,
            id,
            index: entry.origin.index,
            source: spellSource(source),
            rule,
            opened: i,
            bounded: first,
            paths: [path],
            pinAtOpen: pin,
          });
        } else if (rule !== undefined && window !== undefined) {
          if (window.paths[window.paths.length - 1] !== path) window.paths.push(path);
        } else if (window !== undefined) {
          this.close(key, window, i, pin === window.pinAtOpen ? "source-restored" : "re-pinned");
        }
      }
    }
    for (const [key, window] of this.open) {
      if (!present.has(key)) this.close(key, window, i, "removed");
    }
  }

  private close(key: string, window: OpenWindow, at: number, by: WindowCause): void {
    this.open.delete(key);
    const { pinAtOpen: _, ...done } = window;
    this.closed.push({ ...done, closed: { at, by } });
  }
}

/** A page path, posix, relative to the repository top: what the walk names a page by. */
export function repoPath(top: string, abs: string): string {
  return posix.normalize(toPosix(relative(top, abs)));
}
