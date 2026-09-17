/**
 * Writers for the formats a termbase leaves the docs in: TBX, SKOS, CSV, JSON,
 * and a Vale style.
 */
import type { TermWriter } from "../../types.js";
import { csvWriter } from "./csv.js";
import { jsonWriter } from "./json.js";
import { skosWriter } from "./skos.js";
import { tbxWriter } from "./tbx.js";
import { valeWriter } from "./vale.js";

export const INTERCHANGE_WRITERS: readonly TermWriter[] = [tbxWriter, skosWriter, csvWriter, jsonWriter, valeWriter];
