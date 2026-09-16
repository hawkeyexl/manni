/**
 * The determinism corpus, copied outside any git repository.
 *
 * Git is detected now rather than switched (proposal 0051 §6), so a build run
 * from inside this checkout stamps HEAD's committer date into the build
 * activity's `prov:endedAtTime` and every corpus document's commit dates and
 * author agents into the graph. That is exactly the hazard kg ADR 01010 met
 * and answered with `provenance.git: false` on this fixture: the golden is the
 * *derivation* regression gate, and a golden carrying HEAD's committer date
 * fails on every commit.
 *
 * The switch is gone, so the corpus stops being a repository instead. A copy
 * under the system temp directory has no `.git` above it, so `git log` fails,
 * the build degrades with its one warning, and the golden captures derivation
 * and nothing else. Git-derived output stays covered by the temp-repo tests in
 * `test/kg/integration/build.test.ts` and `git-history.test.ts`, which build
 * repositories of their own.
 *
 * Not collected as a suite: vitest's `include` is `test/**\/*.test.ts`.
 */
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** The committed fixture, for reading source bytes. */
export const CORPUS_SOURCE = join(here, "..", "fixtures", "corpus");

/**
 * A fresh copy of `test/kg/fixtures/corpus/` in a temp directory, config and
 * all. Byte-for-byte, so `windows-notes.md` keeps its CRLF.
 */
export function detachedCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-kg-corpus-"));
  cpSync(CORPUS_SOURCE, dir, { recursive: true });
  return dir;
}
