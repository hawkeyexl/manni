/**
 * The representative term set every interchange writer is tested against, read
 * from `test/fixtures/term/writers/terms.json`, and its golden outputs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Term, TermRecord } from "../../src/term/types.js";

export const WRITERS_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term", "writers");

interface FixtureEntry {
  id: string;
  language?: string;
  record: TermRecord;
}

export function fixtureTerms(): Term[] {
  const entries = JSON.parse(readFileSync(join(WRITERS_FIXTURES, "terms.json"), "utf8")) as FixtureEntry[];
  return entries.map((entry, i) => term(entry.id, entry.record, entry.language, i + 1));
}

/** A term with a stand-in location, for inline cases. */
export function term(id: string, record: TermRecord, language?: string, line = 1): Term {
  return {
    id,
    record,
    ...(language === undefined ? {} : { language }),
    location: { file: "terms.yaml", construct: "manifest", line, fieldLines: {} },
  };
}

export function golden(...segments: string[]): string {
  return readFileSync(join(WRITERS_FIXTURES, ...segments), "utf8");
}
