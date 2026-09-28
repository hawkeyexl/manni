/**
 * `meta.register` (proposal 0070): local JSON Schema files a config names by
 * path, loaded once when the config loads and referred to everywhere after
 * by their own `$id`, as a built-in is referred to by its id.
 *
 * Every refusal here is a config error. The messages carry no `<source>: `
 * prefix; `loadConfig` adds it, and the `meta.` section with it.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { DocmetaError } from "../types.js";
import { stripBom } from "./json-text.js";
import {
  isBuiltinId,
  isPublishedBuiltinUrl,
  type RegisteredSchema,
} from "./schema-registry.js";

/**
 * Vendors a registered id may not use: `manni` is the house vocabularies'
 * vendor, and the other four are finding identities that share the built-in
 * id namespace (see `assertPublishableBuiltinId`).
 */
export const RESERVED_VENDORS: readonly string[] = [
  "manni",
  "check",
  "external",
  "encrypted",
  "derived",
];

/** `vendor:name:version`, each segment the built-in id grammar allows. */
const REGISTERED_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i;

/** Is `id` one of the two shapes a registered schema's `$id` may take? */
function isRegistrableId(id: string): boolean {
  if (/^https:\/\//i.test(id)) {
    try {
      new URL(id);
      return true;
    } catch {
      return false;
    }
  }
  return REGISTERED_ID.test(id) && !id.toLowerCase().endsWith(".json");
}

/** Every `*.json` file under `dir`, recursively, in a stable order. */
async function jsonFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsonFilesUnder(path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(path);
  }
  return out;
}

/** A path relative to the config's directory, with forward slashes. */
function shown(configDir: string, path: string): string {
  return relative(configDir, path).split(sep).join("/");
}

/**
 * Load every schema `register` names, relative to `configDir`.
 *
 * A directory registers each `*.json` beneath it. A file named twice, once
 * directly and once through its directory, registers once; two different
 * files claiming one `$id` are refused.
 */
export async function loadRegisteredSchemas(
  register: readonly string[],
  configDir: string,
): Promise<Map<string, RegisteredSchema>> {
  const files: string[] = [];
  for (const [i, entry] of register.entries()) {
    const path = resolve(configDir, entry);
    let isDir: boolean;
    try {
      isDir = (await stat(path)).isDirectory();
    } catch {
      throw new DocmetaError(`register[${i}] names ${entry}, which does not exist.`);
    }
    if (!isDir) {
      files.push(path);
      continue;
    }
    const found = await jsonFilesUnder(path);
    if (found.length === 0) {
      throw new DocmetaError(`register[${i}] names a directory with no .json files.`);
    }
    files.push(...found);
  }

  const registered = new Map<string, RegisteredSchema>();
  const seen = new Set<string>();
  for (const path of files) {
    if (seen.has(path)) continue;
    seen.add(path);
    const file = shown(configDir, path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(await readFile(path, "utf8")));
    } catch {
      throw new DocmetaError(`register: ${file} is not valid JSON.`);
    }
    const schema =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    const id = schema?.["$id"];
    if (schema === undefined || typeof id !== "string" || id.trim() === "") {
      throw new DocmetaError(
        `register: ${file} has no $id. A registered schema is named by its $id.`,
      );
    }
    if (!isRegistrableId(id)) {
      throw new DocmetaError(
        `register: ${file}'s $id "${id}" is neither vendor:name:version nor an https URL.`,
      );
    }
    if (isBuiltinId(id) || isPublishedBuiltinUrl(id)) {
      throw new DocmetaError(`register: ${file} registers "${id}", which is a built-in id.`);
    }
    const vendor = /^https:/i.test(id) ? undefined : id.split(":")[0]?.toLowerCase();
    if (vendor !== undefined && RESERVED_VENDORS.includes(vendor)) {
      throw new DocmetaError(
        `register: ${file} registers "${id}" under the reserved "${vendor}" vendor.`,
      );
    }
    const earlier = registered.get(id);
    if (earlier !== undefined) {
      throw new DocmetaError(
        `register: ${earlier.file} and ${file} both register "${id}".`,
      );
    }
    registered.set(id, { id, file, path, schema });
  }
  return registered;
}
