/** Docs-only artifact: canonical merged metadata, with graph publication marks honoured. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runGet,
  resolveRunConfig,
  resolveSchemaSet,
  Validator,
  collectSchemaPins,
} from "../dist/index.js";

const cwd = process.cwd();
const collections = ["site", "strategy"];
const { config } = await resolveRunConfig({ cwd, inputs: [], collections });
const validator = new Validator({
  fileBase: cwd,
  pins: collectSchemaPins(config),
  registered: config?.registered,
});
const results = await runGet({
  cwd,
  inputs: [],
  fields: [],
  allFields: true,
  derived: false,
  collections,
});
const output = [];
for (const record of results) {
  if (record.error) throw new Error(`${record.file}: ${record.error}`);
  const refs = resolveSchemaSet({
    filePath: record.file,
    fileSchema: record.values.$schema,
    config,
    memberOf: record.collections,
  });
  const preferences = await validator.graphOutputPreferences(
    record.values,
    refs,
  );
  const values = Object.fromEntries(
    Object.entries(record.values).filter(
      ([key]) => preferences.get(key) !== false,
    ),
  );
  // GetFileResult[] is already the metadata reader's public JSON shape. Never
  // derive or decrypt here, and never add fields to the reader chunk manifest.
  output.push({
    file: record.file,
    present: record.present,
    collections: record.collections,
    values,
  });
}
const directory = join(cwd, "docs/public/explorer-data");
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "authoring.json"),
  `${JSON.stringify(output)}\n`,
  "utf8",
);
console.log(
  `Exported authoring metadata for ${output.length} pages to docs/public/explorer-data/authoring.json.`,
);
