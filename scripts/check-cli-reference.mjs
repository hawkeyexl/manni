/**
 * Drift-check for the CLI reference docs.
 *
 * Introspects the real commander program (`buildProgram()` from the built CLI)
 * and asserts that each tool's reference page documents exactly the same
 * commands, arguments, options, and value-defaults. Descriptions stay
 * hand-authored; this only guards the machine-checkable surface so a page
 * cannot silently drift from the code.
 *
 * One page per tool: the umbrella mounts each tool as a top-level command,
 * and `docs/src/content/docs/<tool>/reference/cli.mdx` documents that tool's
 * subtree, headed by the qualified names (`` ## `docevals run` ``). The
 * umbrella's own global options (help, version) are documented once, on the
 * metadata tool's page.
 *
 * A tool whose page does not exist yet is reported and skipped rather than
 * failed: tools land on their own branches and stay draft until their docs
 * do, and this check is what says the page is owed. Once the page exists it
 * is enforced like any other.
 *
 * Usage:
 *   node scripts/check-cli-reference.mjs [path/to/meta/cli.mdx]
 * Requires `npm run build` first (imports dist/cli.js).
 * Exit 0 = in sync, 1 = drift found, 2 = setup error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs/src/content/docs");

/** The reference page for a tool mounted as `<name>` on the umbrella. */
function pageFor(name) {
  if (name === "meta" && process.argv[2]) return path.resolve(process.argv[2]);
  return path.join(DOCS, name, "reference/cli.mdx");
}

let buildProgram;
try {
  ({ buildProgram } = await import(
    pathToFileURL(path.join(ROOT, "dist/cli.js")).href
  ));
} catch (err) {
  console.error(
    `docs:check-cli: could not import dist/cli.js — run \`npm run build\` first.\n${err.message}`,
  );
  process.exit(2);
}

// Help and version are commander built-ins documented once under Global options.
const GLOBAL_ONLY = new Set(["help", "version"]);
const stripDashes = (long) => long.replace(/^--/, "");

// ---------------------------------------------------------------------------
// 1. Canonical surface from the commander program.
// ---------------------------------------------------------------------------
const program = buildProgram();

function optionLongs(cmd) {
  return cmd.options
    .filter((o) => o.long)
    .map((o) => stripDashes(o.long));
}

const codeGlobalOptions = new Set([
  ...optionLongs(program),
  "version", // registered via .version()
  "help", // commander auto-adds -h, --help
]);

/**
 * Walk one tool's command tree, not just its first level.
 *
 * Iterating `commands` alone would leave every *sub*command silently
 * unverified — `manni meta schemas vendor` could gain, lose, or rename a flag
 * and this check would report the page as in sync. Commands are keyed by their
 * qualified name ("meta schemas vendor"), which is also how the page heads
 * their section.
 */
function collectCommands(parent, prefix, into) {
  for (const cmd of parent.commands) {
    const name = prefix ? `${prefix} ${cmd.name()}` : cmd.name();
    const options = new Set(
      optionLongs(cmd).filter((l) => !GLOBAL_ONLY.has(l)),
    );
    const args = cmd.registeredArguments.map((a) => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic,
    }));
    // Only primitive, non-empty defaults are machine-comparable to the docs.
    const defaults = new Map();
    for (const o of cmd.options) {
      if (!o.long) continue;
      const d = o.defaultValue;
      if (typeof d === "string" || typeof d === "number") {
        defaults.set(stripDashes(o.long), String(d));
      }
    }
    into.set(name, { options, args, defaults });
    collectCommands(cmd, name, into);
  }
}

// ---------------------------------------------------------------------------
// 2. What a docs page documents (parsed from markdown tables).
// ---------------------------------------------------------------------------
function cellList(line) {
  // Split on unescaped pipes only — table cells may contain `\|` (e.g. a
  // `<pretty\|json>` value column), which must not be treated as a separator.
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}
const isSeparatorRow = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const longsIn = (text) =>
  [...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => stripDashes(m[0]));
// Parse an argument cell like `<fields>` or `[paths...]` into its name and its
// required/variadic shape, so the check enforces those (not just the name).
const parseArgToken = (text) => {
  const token = text.replace(/`/g, "").trim();
  const m = token.match(/([a-zA-Z][\w-]*)/);
  if (!m) return null;
  return {
    name: m[1],
    required: /^</.test(token), // `<arg>` required, `[arg]` optional
    variadic: token.includes("..."),
  };
};

function parsePage(docPath) {
  const lines = readFileSync(docPath, "utf8").split(/\r?\n/);
  const docGlobalOptions = new Set();
  const docCommands = new Map(); // name -> { options:Set, args:Map, defaults:Map }
  let section = null; // 'global' | { command } | null
  let header = null; // current table header cells, lowercased

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h2) {
      const title = h2[1];
      // A space is allowed so a subcommand's section — `` ## `meta schemas vendor` ``
      // — is recognized as one.
      const cmd = title.match(/^`([a-z][a-z-]*(?: [a-z][a-z-]*)*)`$/);
      if (cmd) {
        section = { command: cmd[1] };
        docCommands.set(cmd[1], {
          options: new Set(),
          args: new Map(),
          defaults: new Map(),
        });
      } else if (/^global options$/i.test(title)) {
        section = "global";
      } else {
        section = null; // narrative section — ignore for parity
      }
      header = null;
      continue;
    }
    if (!section) continue;
    if (!/^\s*\|.*\|\s*$/.test(line)) {
      if (line.trim() === "") header = null;
      continue;
    }
    const cells = cellList(line);
    if (isSeparatorRow(cells)) continue;
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes("option") || lower.includes("argument")) {
      header = lower;
      continue;
    }
    if (!header) continue;

    const optCol = header.indexOf("option");
    const argCol = header.indexOf("argument");
    const defCol = header.indexOf("default");

    if (section === "global") {
      if (optCol >= 0 && cells[optCol]) {
        for (const l of longsIn(cells[optCol])) docGlobalOptions.add(l);
      }
      continue;
    }

    const bucket = docCommands.get(section.command);
    if (!bucket) continue;
    // An "Options" table has Option + (Argument value column) + Default columns.
    // An "Arguments" table has a single Argument column and no Default column.
    const isOptionsTable = optCol >= 0;
    if (isOptionsTable) {
      const longs = longsIn(cells[optCol] ?? "");
      for (const l of longs) bucket.options.add(l);
      if (defCol >= 0 && longs.length === 1) {
        const raw = (cells[defCol] ?? "").replace(/`/g, "").trim();
        if (raw && !/^[—-]$/.test(raw)) {
          bucket.defaults.set(longs[0], raw.toLowerCase());
        }
      }
    } else if (argCol >= 0) {
      const arg = parseArgToken(cells[argCol] ?? "");
      if (arg) bucket.args.set(arg.name, { required: arg.required, variadic: arg.variadic });
    }
  }
  return { docGlobalOptions, docCommands };
}

// ---------------------------------------------------------------------------
// 3. Compare, one tool at a time.
// ---------------------------------------------------------------------------
const problems = [];
const owed = [];
const checked = [];
const diff = (label, codeSet, docSet) => {
  for (const x of codeSet)
    if (!docSet.has(x)) problems.push(`${label}: \`${x}\` in code but not documented`);
  for (const x of docSet)
    if (!codeSet.has(x)) problems.push(`${label}: \`${x}\` documented but not in code`);
};

for (const tool of program.commands) {
  const name = tool.name();
  const docPath = pageFor(name);
  const rel = path.relative(ROOT, docPath).replace(/\\/g, "/");
  if (!existsSync(docPath)) {
    owed.push(`${name}: no reference page at ${rel} yet (owed before the tool leaves draft)`);
    continue;
  }
  checked.push(rel);

  // The tool itself is a command on the page too (`` ## `meta` ``), so its
  // own options — `--no-color`, say — are verified like any subcommand's.
  const codeCommands = new Map();
  collectCommands({ commands: [tool] }, "", codeCommands);
  const { docGlobalOptions, docCommands } = parsePage(docPath);

  // Global options live on the metadata tool's page, once.
  if (name === "meta") diff("global options", codeGlobalOptions, docGlobalOptions);

  diff(`${name} commands`, new Set(codeCommands.keys()), new Set(docCommands.keys()));

  for (const [cmdName, code] of codeCommands) {
    const doc = docCommands.get(cmdName);
    if (!doc) continue; // already reported as a missing command
    diff(`${cmdName} options`, code.options, doc.options);
    const codeArgs = new Map(code.args.map((a) => [a.name, a]));
    diff(`${cmdName} arguments`, new Set(codeArgs.keys()), new Set(doc.args.keys()));
    for (const [argName, codeArg] of codeArgs) {
      const docArg = doc.args.get(argName);
      if (!docArg) continue;
      if (codeArg.required !== docArg.required) {
        problems.push(
          `${cmdName} arguments: \`${argName}\` is ${codeArg.required ? "required (<arg>)" : "optional ([arg])"} in code but documented as ${docArg.required ? "required (<arg>)" : "optional ([arg])"}`,
        );
      }
      if (codeArg.variadic !== docArg.variadic) {
        problems.push(
          `${cmdName} arguments: \`${argName}\` variadic mismatch (code: ${codeArg.variadic}, docs: ${docArg.variadic})`,
        );
      }
    }
    for (const [opt, codeDefault] of code.defaults) {
      if (!doc.options.has(opt)) continue;
      const docDefault = doc.defaults.get(opt);
      if (docDefault == null) {
        problems.push(
          `${cmdName} options: \`${opt}\` default is \`${codeDefault}\` in code but no default documented`,
        );
      } else if (docDefault !== codeDefault.toLowerCase()) {
        problems.push(
          `${cmdName} options: \`${opt}\` default mismatch (docs: \`${docDefault}\`, code: \`${codeDefault}\`)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------
for (const line of owed) console.log(`docs:check-cli: ${line}`);
if (problems.length === 0) {
  console.log(`docs:check-cli: ${checked.join(", ")} in sync with the CLI ✓`);
  process.exit(0);
}
console.error(`docs:check-cli: out of sync with the CLI:`);
for (const p of problems.sort()) console.error(`  - ${p}`);
console.error(
  `\nUpdate the page (flags/args/defaults are the source of truth) and re-run \`npm run docs:check-cli\`.`,
);
process.exit(1);
