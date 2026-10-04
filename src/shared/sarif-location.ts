/**
 * SARIF artifact locations, shared by every tool that writes SARIF over paths
 * it did not choose.
 *
 * Moved here from lint's reporter when tracevals needed the same mapping: a
 * tracevals finding points at the skill or instruction file that declared the
 * eval, which is often outside the checkout (`~/.claude/skills/...`), so the
 * absolute-path branch below is its ordinary case rather than an edge one.
 */

/** The base every relative artifact URI resolves against. */
export const URI_BASE_ID = "SRCROOT";

export interface ArtifactLocation {
  uri: string;
  uriBaseId?: string;
}

/** Matches a Windows drive prefix on an already-forward-slashed path. */
const DRIVE = /^[A-Za-z]:\//;

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Path handling here is string-level rather than `node:path`, deliberately.
 *
 * `node:path` is platform-bound: on Linux, `isAbsolute("C:\\repo\\a.md")` is
 * false and `relative()` treats the whole thing as one filename. That would
 * make this reporter's most important behaviour differ between the two CI
 * runners, and differ in the direction that fails silently - a Windows path
 * emitted verbatim as a URI resolves to no file in the repository. Doing the
 * work on strings makes the mapping identical everywhere.
 */
function isAbsolutePath(posix: string): boolean {
  return posix.startsWith("/") || DRIVE.test(posix);
}

/**
 * A path Windows resolves, and therefore compares without regard to case:
 * either a drive path or a UNC share. `//` is how `fileUri` recognises a share
 * too, so both places agree on what one looks like.
 */
function isWindowsPath(posix: string): boolean {
  return DRIVE.test(posix) || posix.startsWith("//");
}

/** `/repo/` + `/repo/docs/a.md` -> `docs/a.md`; null when not underneath. */
export function underRoot(posix: string, root: string): string | null {
  if (posix.startsWith(root)) return posix.slice(root.length);
  // Windows paths are case-insensitive: `C:/Repo` and `c:/repo` are one
  // directory, and so are `//server/Share` and `//SERVER/share` - a checkout on
  // a network share must relativize as readily as one on a drive, or its
  // findings upload as absolute URIs and attach to nothing. Retry this way only
  // when both sides are Windows-shaped - anywhere else, two paths differing in
  // case are two different files.
  if (isWindowsPath(posix) && isWindowsPath(root)) {
    // The comparison case-folds but the slice does not, which reads like a bug
    // and is not: case folding leaves length unchanged, so `root.length` still
    // indexes the same boundary, and slicing the original is what keeps the
    // reported path in the casing the author actually used.
    if (posix.toLowerCase().startsWith(root.toLowerCase())) {
      return posix.slice(root.length);
    }
  }
  return null;
}

/**
 * Percent-encode what a URI cannot carry raw. `encodeURI` leaves `/` and `:`
 * alone, which is what a path needs, but it also leaves `#` and `?` alone, and
 * either of those would be read as a fragment or a query rather than as part
 * of the name.
 *
 * This also covers labels that are not paths at all: the stdin document is
 * `<stdin>`, and `<`/`>` are not legal in a URI. It will not resolve to a file
 * anywhere, but an invalid URI can sink an entire upload, whereas a valid one
 * that resolves to nothing only sinks its own annotation.
 */
function encodePath(p: string): string {
  return encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/** An absolute forward-slashed path as a `file:` URI. */
export function fileUri(posix: string): string {
  const encoded = encodePath(posix);
  if (posix.startsWith("//")) return `file:${encoded}`; // UNC: file://host/share
  if (posix.startsWith("/")) return `file://${encoded}`; // POSIX: file:///etc
  return `file:///${encoded}`; // Drive: file:///C:/repo
}

/** A relative path that climbs out of the directory it is relative to. */
function escapesRoot(posix: string): boolean {
  return posix === ".." || posix.startsWith("../");
}

/**
 * `C:/repo/` + `../sibling/a.md` -> `C:/sibling/a.md`.
 *
 * String-level, like everything else here, and one step per `..` rather than a
 * single strip: `../a.md` and `../../a.md` name two different files, and a
 * reporter that collapsed them would point an alert at the wrong one. The first
 * segment is never popped - it is the drive, the empty segment before a posix
 * root, or the first half of a UNC share - so a path cannot climb past the
 * filesystem root.
 */
function resolveFromRoot(root: string, rel: string): string {
  const parts = root.replace(/\/+$/, "").split("/");
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join("/");
  return joined === "" ? "/" : joined;
}

/**
 * Forward-slashed with exactly one trailing slash, so a prefix match on it can
 * only ever land on a segment boundary.
 */
export function normalizeRoot(root: string): string {
  const posix = toPosix(root);
  return posix.endsWith("/") ? posix : `${posix}/`;
}

/**
 * The artifact URI, which is the single most breakable thing in this file.
 *
 * SARIF URIs are URI references, not native paths. Relative plus `uriBaseId`
 * is what GitHub resolves against the checkout, so that is the default; a
 * backslashed path, or a bare absolute one, uploads fine and matches no file.
 *
 * A target outside the run root arrives as a **relative** path too - a `../`
 * chain, which is how `resolveTargets` reports it - and that is the one shape
 * a `uriBaseId` cannot carry. `SRCROOT` is the checkout, and code scanning
 * will not resolve above it: `../sibling/docs/a.md` uploads and annotates
 * nothing, which is this format's whole failure mode. So it is resolved
 * against the root and emitted the way the genuinely-absolute case below is,
 * with no base to resolve against.
 */
export function artifactLocation(file: string, root: string): ArtifactLocation {
  const posix = toPosix(file);
  if (!isAbsolutePath(posix)) {
    if (escapesRoot(posix)) return { uri: fileUri(resolveFromRoot(root, posix)) };
    return { uri: encodePath(posix), uriBaseId: URI_BASE_ID };
  }
  const rel = underRoot(posix, root);
  if (rel !== null) return { uri: encodePath(rel), uriBaseId: URI_BASE_ID };
  // Genuinely outside the run root. No relative URI reaches it, so say so with
  // an absolute `file:` URI rather than inventing a `../` chain that resolves
  // to nothing on the machine reading the report.
  return { uri: fileUri(posix) };
}
