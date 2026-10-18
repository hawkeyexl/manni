/**
 * Writers for the formats a termbase leaves the docs in: TBX v2 and v3, SKOS, CSV, JSON,
 * and a Vale style.
 */
import type { TermWriter } from "../../types.js";
import { csvWriter } from "./csv.js";
import { jsonWriter } from "./json.js";
import { skosWriter } from "./skos.js";
import { tbx3Writer, tbxWriter } from "./tbx.js";
import { valeWriter } from "./vale.js";

export const INTERCHANGE_WRITERS: readonly TermWriter[] = [tbxWriter, tbx3Writer, skosWriter, csvWriter, jsonWriter, valeWriter];
