/**
 * The retrieval fixture (`test/graph/fixtures/retrieve/`), copied outside git
 * and published the way `graph publish` does: build, the search indexes, mock
 * vectors, the chunks and `graph.jsonld`, all in `.manni/graph/`.
 *
 * Not collected as a suite: vitest's `include` is `test/**\/*.test.ts`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runEmbed } from "../../../src/graph/commands/embed.js";
import { runExport } from "../../../src/graph/commands/export.js";
import {
  emitLocalizations,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  vectorIndexFilename,
} from "../../../src/graph/core/localizations.js";
import { encodeVectorIndex } from "../../../src/graph/core/vector-index.js";
import { makeTempRepo } from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "retrieve");
const LANGUAGES = join(import.meta.dirname, "..", "fixtures", "chunks-languages");

export const QUESTION = "How do I rotate the encryption key?";
export const DE_QUESTION = "Wie rotiere ich den Schlüssel?";
export const ROTATE = "urn:manni:graph:doc/docs/en/rotate.md";
export const CI = "urn:manni:graph:doc/docs/en/ci.md";
export const INDEX = ".manni/graph";

function fixtureFiles(root = FIXTURE): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(root, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return out;
}

/** A temp directory holding the fixture and its published artifact. */
export async function retrieveArtifact(): Promise<string> {
  const dir = makeTempRepo({ files: fixtureFiles(), init: false });
  await runBuild({ cwd: dir });
  await runExport({ cwd: dir, format: "search" });
  await runEmbed({ cwd: dir, model: "mock", noCache: true });
  await runExport({ cwd: dir, format: "chunks" });
  await runExport({ cwd: dir, format: "jsonld" });
  return dir;
}

/** The models the languages artifact embeds English and German with. French has none. */
export const LANGUAGE_MODELS: Record<string, { id: string; dimensions: number }> = {
  en: { id: "model-en", dimensions: 4 },
  de: { id: "model-de", dimensions: 6 },
};

/**
 * `test/graph/fixtures/chunks-languages/`, published with English and German
 * embedded by different models and French left without vectors.
 */
export async function languagesArtifact(): Promise<string> {
  const dir = makeTempRepo({ files: fixtureFiles(LANGUAGES), init: false });
  await runBuild({ cwd: dir });
  await runExport({ cwd: dir, format: "search" });
  const out = join(dir, INDEX);
  const manifestPath = join(out, LOCALIZATIONS_FILENAME);
  const doc = parseLocalizations(readFileSync(manifestPath, "utf8"));
  if (doc === undefined) throw new Error("no localizations manifest");
  for (const entry of doc.languages) {
    const model = LANGUAGE_MODELS[entry.language];
    if (model === undefined) continue;
    const index = JSON.parse(readFileSync(join(out, entry.search.path), "utf8")) as { entries: { id: string }[] };
    const path = vectorIndexFilename(entry.language);
    const vectors = index.entries.map((e) => ({ id: e.id, vector: new Float32Array(model.dimensions).fill(0.5) }));
    writeFileSync(
      join(out, path),
      encodeVectorIndex(vectors, { model: model.id, dtype: "fp32", source: entry.search.digest, language: entry.language }),
    );
    entry.vectors = { path, model: model.id, dtype: "fp32", dims: model.dimensions, count: vectors.length };
  }
  writeFileSync(manifestPath, emitLocalizations(doc));
  await runExport({ cwd: dir, format: "chunks" });
  await runExport({ cwd: dir, format: "jsonld" });
  return dir;
}
