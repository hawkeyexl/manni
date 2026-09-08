/**
 * Drift-check for the CLI reference docs, one page per domain.
 *
 * Introspects the real commander program (`buildProgram()` from the built
 * umbrella) and, for each domain mounted on it, asserts that the domain's
 * reference page documents exactly the same commands, arguments, options, and
 * value-defaults as its `src/<domain>/cli.ts`:
 *
 *   meta → docs/src/content/docs/meta/reference/cli.mdx
 *   a11y → docs/src/content/docs/a11y/reference/cli.mdx
 *
 * Descriptions stay hand-authored; this only guards the machine-checkable
 * surface so a page cannot silently drift from the code. The umbrella's own
 * options (`--version`, `--help`) are checked against every page's
 * "Global options" table, since each page documents them.
 *
 * Usage:
 *   node scripts/check-cli-reference.mjs [domain...]
 * With no arguments every domain in the map is checked; with arguments each
 * is a domain name (`meta`, `a11y`).
 * Requires `npm run build` first (imports dist/cli.js).
 * Exit 0 = every page in sync, 1 = drift found on any page, 2 = setup error
 * (unknown domain, domain not mounted on the built program, page missing).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Domain (the command mounted on the umbrella) → the page that documents it. */
const PAGES = new Map([
  ["meta", "docs/src/content/docs/meta/reference/cli.mdx"],
  ["a11y", "docs/src/content/docs/a11y/reference/cli.mdx"],
  ["cite", "docs/src/content/docs/cite/reference/cli.mdx"],
]);

const requested = process.argv.slice(2);
const domains = requested.length > 0 ? requested : [...PAGES.keys()];

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

// The umbrella's options. Every domain page documents these under
// "Global options", so they are compared against each page.
const codeGlobalOptions = new Set([
  ...optionLongs(program),
  "version", // registered via .version()
  "help", // commander auto-adds -h, --help
]);

// Setup errors are collected and reported together, before any comparison,
// so one run names everything that is wired wrong.
const setupProblems = [];
const targets = []; // { domain, docPath, codeCommands }

/**
 * Walk one domain's command tree, not just its first level.
 *
 * Iterating a command's direct children alone left every *sub*command silently
 * unverified — `manni meta schemas vendor` could gain, lose, or rename a flag
 * and this check would report the page as in sync. Commands are keyed by their
 * qualified name ("meta schemas vendor"), which is also how the page heads
 * their section.
 */
function collectCommand(cmd, name, into) {
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
  for (const child of cmd.commands) {
    collectCommand(child, `${name} ${child.name()}`, into);
  }
}

for (const domain of domains) {
  const page = PAGES.get(domain);
  if (!page) {
    setupProblems.push(
      `unknown domain \`${domain}\`; known: ${[...PAGES.keys()].join(", ")}`,
    );
    continue;
  }
  const mounted = program.commands.find((c) => c.name() === domain);
  if (!mounted) {
    setupProblems.push(
      `domain \`${domain}\` is not mounted on the built program (expected src/cli.ts to addCommand it from src/${domain}/cli.ts)`,
    );
  }
  const docPath = path.join(ROOT, page);
  if (!existsSync(docPath)) {
    setupProblems.push(
      `page for domain \`${domain}\` is missing on disk: ${page}`,
    );
  }
  if (!mounted || !existsSync(docPath)) continue;
  const codeCommands = new Map(); // qualified name -> { options:Set, args:[{name,required,variadic}], defaults:Map }
  collectCommand(mounted, domain, codeCommands);
  targets.push({ domain, docPath, codeCommands });
}

if (setupProblems.length > 0) {
  console.error("docs:check-cli: setup error:");
  for (const p of setupProblems) console.error(`  - ${p}`);
  process.exit(2);
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
  const md = readFileSync(docPath, "utf8");
  const lines = md.split(/\r?\n/);

  const docGlobalOptions = new Set();
  const docCommands = new Map(); // name -> { options:Set, args:Map, defaults:Map }

  let section = null; // 'global' | { command } | null
  let header = null; // current table header cells, lowercased

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h2) {
      const title = h2[1];
      // A space is allowed so a subcommand's section — `` ## `schemas vendor` ``
      // — is recognized as one. The old pattern rejected it, so the heading was
      // read as narrative and the whole section skipped, which is precisely how a
      // subcommand went unverified in both directions at once. Digits are
      // allowed after the first letter for the same reason: `a11y` is a
      // domain, and a pattern that stops at letters reads `` ## `a11y check` ``
      // as narrative and reports the page as missing both of its commands.
      const cmd = title.match(/^`([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)`$/);
      if (cmd) {
        section = { command: cmd[1] };
        docCommands.set(cmd[1], {
          options: new Set(),
          args: new Map(), // name -> { required, variadic }
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
// 3. Compare one domain's code surface with its page.
// ---------------------------------------------------------------------------
function compare(codeCommands, { docGlobalOptions, docCommands }) {
  const problems = [];
  const diff = (label, codeSet, docSet) => {
    for (const x of codeSet)
      if (!docSet.has(x)) problems.push(`${label}: \`${x}\` in code but not documented`);
    for (const x of docSet)
      if (!codeSet.has(x)) problems.push(`${label}: \`${x}\` documented but not in code`);
  };

  // Commands.
  diff(
    "commands",
    new Set(codeCommands.keys()),
    new Set(docCommands.keys()),
  );

  // Global options.
  diff("global options", codeGlobalOptions, docGlobalOptions);

  // Per-command options, args, and value-defaults.
  for (const [name, code] of codeCommands) {
    const doc = docCommands.get(name);
    if (!doc) continue; // already reported as a missing command
    diff(`${name} options`, code.options, doc.options);
    // Argument parity: names, plus required (`<arg>` vs `[arg]`) and variadic.
    const codeArgs = new Map(code.args.map((a) => [a.name, a]));
    diff(`${name} arguments`, new Set(codeArgs.keys()), new Set(doc.args.keys()));
    for (const [argName, codeArg] of codeArgs) {
      const docArg = doc.args.get(argName);
      if (!docArg) continue; // missing arg already reported by diff()
      if (codeArg.required !== docArg.required) {
        problems.push(
          `${name} arguments: \`${argName}\` is ${codeArg.required ? "required (<arg>)" : "optional ([arg])"} in code but documented as ${docArg.required ? "required (<arg>)" : "optional ([arg])"}`,
        );
      }
      if (codeArg.variadic !== docArg.variadic) {
        problems.push(
          `${name} arguments: \`${argName}\` variadic mismatch (code: ${codeArg.variadic}, docs: ${docArg.variadic})`,
        );
      }
    }
    for (const [opt, codeDefault] of code.defaults) {
      if (!doc.options.has(opt)) continue;
      const docDefault = doc.defaults.get(opt);
      if (docDefault == null) {
        problems.push(
          `${name} options: \`${opt}\` default is \`${codeDefault}\` in code but no default documented`,
        );
      } else if (docDefault !== codeDefault.toLowerCase()) {
        problems.push(
          `${name} options: \`${opt}\` default mismatch (docs: \`${docDefault}\`, code: \`${codeDefault}\`)`,
        );
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 4. Report, per page.
// ---------------------------------------------------------------------------
let drifted = 0;
for (const { domain, docPath, codeCommands } of targets) {
  const rel = path.relative(ROOT, docPath).replace(/\\/g, "/");
  const source = `src/${domain}/cli.ts`;
  const problems = compare(codeCommands, parsePage(docPath));
  if (problems.length === 0) {
    console.log(`docs:check-cli: ${rel} is in sync with ${source} ✓`);
    continue;
  }
  drifted += 1;
  console.error(`docs:check-cli: ${rel} is out of sync with ${source}:`);
  for (const p of problems.sort()) console.error(`  - ${p}`);
}

if (drifted > 0) {
  console.error(
    `\nUpdate the page (flags/args/defaults are the source of truth) and re-run \`npm run docs:check-cli\`.`,
  );
  process.exit(1);
}
