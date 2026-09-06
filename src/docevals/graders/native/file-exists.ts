/**
 * Native check that a page's companion artifacts are present.
 *
 * Documentation routinely promises files that live beside it — a sample
 * project, an OpenAPI document, a downloadable config. Nothing in the grader
 * set could say "this page's example directory still exists", and the failure
 * it guards against is the quiet kind: the prose keeps describing a file that
 * a refactor moved, and every other check still passes.
 *
 * `exists: false` is the mirror, for a file a page should no longer ship.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import type { Finding } from "../../types.js";
import type { Grader } from "./../types.js";
import {
  firstError,
  knownKeys,
  optionalBoolean,
  requiredString,
  type OptionCheck,
  type Options,
} from "../options.js";

interface FileExistsOptions {
  path?: string;
  exists?: boolean;
}

export const fileExistsGrader: Grader = {
  kind: "tool:file-exists",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["path", "exists"]),
      requiredString(options, "path"),
      optionalBoolean(options, "exists"),
      // Same reasoning as a companion `target`: a page is content, and content
      // naming an arbitrary path on the machine running the eval is the hazard
      // the execution grant exists for.
      typeof options.path === "string" && isAbsolute(options.path)
        ? "options.path must be relative to the page's directory"
        : undefined,
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const opts = ev.options as FileExistsOptions;
      const pattern = opts.path ?? "";
      const wantExists = opts.exists ?? true;
      const pageDir = dirname(resolve(ctx.root, plan.page.file));

      if (relative(pageDir, resolve(pageDir, pattern)).startsWith("..")) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "file-exists/escapes",
          message: `options.path "${pattern}" resolves outside the page's directory`,
          severity: ev.severity,
          line: 1,
        });
        continue;
      }

      // A glob so a page can assert "some example still ships" without naming
      // one; a literal path is just a glob that matches at most itself, and
      // `existsSync` covers the case where the literal names a directory,
      // which fast-glob's default onlyFiles would miss.
      const matches = fg.sync(pattern, { cwd: pageDir, dot: false, onlyFiles: false });
      const found = matches.length > 0 || existsSync(join(pageDir, pattern));

      if (found !== wantExists) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: wantExists ? "file-exists/missing" : "file-exists/present",
          message: wantExists
            ? `No file matching "${pattern}" beside this page`
            : `File matching "${pattern}" still exists beside this page, expected absent`,
          severity: ev.severity,
          line: 1,
        });
      }
    }
    return findings;
  },
};
