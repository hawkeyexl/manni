/**
 * `manni kg init` — scaffold a starter `kg:` section in manni.config.yaml.
 *
 * The family file is shared with the other tools, so a file that already
 * exists is not overwritten: the section is appended to it, leaving the
 * siblings' keys and comments exactly as they were. A file that already has a
 * `kg:` key is refused.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DockgError } from "../types.js";
import { CONFIG_SECTION, DEFAULT_CONFIG_FILENAME } from "../core/config.js";

const HEADER = `# manni.config.yaml — shared configuration for the manni family of tools.
# Each tool reads its own top-level key; manni kg reads "kg:".
`;

const STARTER = `version: 1

# Base IRI for every minted node. Set this to a namespace you control;
# without it, IRIs fall back to the urn:dockg: placeholder.
# baseIri: https://example.com/kg/

inputs:
  - "docs/**/*.md"
exclude:
  - "**/node_modules/**"

# Output of \`manni kg build\`.
out: kg/graph.ttl

# Map published-site routes back to source files so route-style links
# (/docs/actions/find) become graph edges. A route may also carry the BCP-47
# \`language\` labelling every document under its root; a page's own \`lang\`
# frontmatter wins. Uncomment and adjust:
# routes:
#   - basePath: /docs
#     root: docs
#     extensions: [.md, .mdx]
#     indexFiles: [index, README]
#   - basePath: /docs/de
#     root: docs/de
#     language: de

# What to derive triples from. Remove entries to opt out.
build:
  derive: [frontmatter, sections, links, tags, images, code, provenance]

# PROV-O settings.
# git: derive per-file provenance from git history (creation/modification
#   dates as fallbacks, author agents, rename -> prov:wasRevisionOf) and
#   stamp the build activity with the HEAD committer date. Deterministic
#   per commit; wall-clock time never enters the graph.
#   "auto" (default) derives it wherever git can run and warns where it
#   cannot; true requires git, so an unavailable one fails the build; false
#   skips git entirely.
# qualified: emit prov:qualifiedAttribution/qualifiedAssociation nodes
#   with roles alongside the direct properties.
provenance:
  git: auto
  qualified: true

# Schemas \`manni kg validate\` checks via manni meta. Default: the \`kg\`
# vocabulary bundled with manni
# (schemas/kg/manni-kg-1.0.0-proposal.1.json). Override with file paths,
# URLs, or manni meta built-in ids:
# validate:
#   schemas: ["./my-schema.json"]

# SHACL shapes \`manni kg check\` validates the built graph against. Default:
# the shapes contract bundled with manni (shapes/kg/dockg-1.0.0.ttl).
# check:
#   shapes: ["./my-shapes.ttl"]

# Metadata coverage gate for \`manni kg stats --check\`. A number applies to
# every measured field; a map gates named fields only. Unset gates nothing.
# stats:
#   coverageThreshold:
#     title: 100
#     description: 50

# LLM settings for \`manni kg fill\` (SKOS frontmatter proposals).
fill:
  provider: anthropic          # anthropic | openai | claude-cli | llama-cpp | mock
  # model: claude-sonnet-4-5   # provider default when omitted
  # apiKeyEnv: ANTHROPIC_API_KEY
  temperature: 0
  maxCostUsd: 5
  cacheDir: .manni/kg/cache
  # fill proposes every field; confidence (0..1 per field) gates what is
  # written. Fields scored below minConfidence are reported, not written.
  minConfidence: 0.7
  # fields: defaults to every fillable field — uncomment to restrict.
  # Record kg.provenance (model + fields + confidence) on filled docs.
  writeProvenance: true
  # Reject proposals that would violate the SHACL shapes contract
  # (broader/narrower cycles, conflicting labels).
  validateGraph: true
  # Also propose per-section metadata. Off by default: it costs more output per
  # call, and section metadata is explicit-only, so review it as carefully.
  sections: false

# Local embeddings for semantic search (\`manni kg embed\`). Needs the optional
# peer: npm install @huggingface/transformers
# embed:
#   model: onnx-community/granite-embedding-small-english-r2-ONNX
#   dtype: q8            # q8 keeps embedding reproducible across platforms
#   out: kg              # directory for the per-language vector sidecars
#   cacheDir: .manni/kg/embed-cache

# Optional enrichment for \`manni kg export --format iirds\` (the iiRDS package).
# Absent, a minimal valid package is still produced.
# export:
#   iirds:
#     title: My Docs        # package title (default: "dockg export")
#     creator: Acme Corp     # Creator iirds:Party + vcard:Organization
#     version: "1.3"         # iiRDS version literal: "1.2" | "1.3"
`;

/** The starter as a `kg:` section: every line nested one level. */
function starterSection(): string {
  const body = STARTER.split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`))
    .join("\n");
  return `${CONFIG_SECTION}:\n${body}`;
}

export function runInit(cwd = process.cwd()): string {
  const path = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (!existsSync(path)) {
    writeFileSync(path, `${HEADER}${starterSection()}`, "utf8");
    return path;
  }

  // A family file is already here. Parse it to make sure a `kg:` key can be
  // appended: the document must be a mapping (or empty) without one.
  const text = readFileSync(path, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new DockgError(
      `Invalid YAML in ${DEFAULT_CONFIG_FILENAME}: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  if (doc != null && (typeof doc !== "object" || Array.isArray(doc))) {
    throw new DockgError(
      `${DEFAULT_CONFIG_FILENAME}: top level must be a mapping — not adding a \`${CONFIG_SECTION}:\` section to it.`,
    );
  }
  if (doc != null && Object.hasOwn(doc, CONFIG_SECTION)) {
    throw new DockgError(
      `${DEFAULT_CONFIG_FILENAME} already has a \`${CONFIG_SECTION}:\` section — not overwriting.`,
    );
  }
  // Append as text rather than re-serialising the document, so the siblings'
  // keys and comments come out byte-for-byte as they went in.
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  const blank = text === "" ? "" : "\n";
  writeFileSync(path, `${text}${separator}${blank}${starterSection()}`, "utf8");
  return path;
}
