/**
 * The `docmeta` bin: the metadata tool under the name it had before it became
 * `manni meta`. Same program, same options, same exit codes, so a script or
 * workflow written against `docmeta …` keeps working. Only the usage line and
 * the stderr prefix say `docmeta`.
 */
import { buildProgram } from "./meta/cli.js";
import { runIfMain } from "./shared/run.js";

runIfMain(import.meta.url, () => buildProgram().name("docmeta"));
