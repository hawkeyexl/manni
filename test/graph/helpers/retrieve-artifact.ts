/**
 * The retrieval fixture (`test/graph/fixtures/retrieve/`), copied outside git
 * and published the way `graph publish` does: build, the search indexes, mock
 * vectors, the chunks and `graph.jsonld`, all in `.manni/graph/`.
 *
 * Not collected as a suite: vitest's `include` is `test/**\/*.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runEmbed } from "../../../src/graph/commands/embed.js";
import { runExport } from "../../../src/graph/commands/export.js";
import { makeTempRepo } from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "retrieve");

export const QUESTION = "How do I rotate the encryption key?";
export const DE_QUESTION = "Wie rotiere ich den Schlüssel?";
export const ROTATE = "urn:manni:graph:doc/docs/en/rotate.md";
export const CI = "urn:manni:graph:doc/docs/en/ci.md";
export const INDEX = ".manni/graph";

function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(FIXTURE, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(FIXTURE);
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
