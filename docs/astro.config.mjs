import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

/** Every element named `tagName` under `node`, depth first. */
function elements(node, tagName, found = []) {
  if (node.type === "element" && node.tagName === tagName) found.push(node);
  for (const child of node.children ?? []) elements(child, tagName, found);
  return found;
}

/**
 * Expressive Code plugin: put every rendered code block in the tab order.
 *
 * A long line makes the `<pre>` scroll sideways, and a scrolling region with
 * nothing focusable inside it cannot be reached from the keyboard. axe's
 * `scrollable-region-focusable` rule flags exactly that, and `manni a11y
 * check` (the Docs workflow's `a11y` job, dogfooding on this site) failed
 * on it for every page with a wide block. `tabindex="0"` is the fix, and it
 * is the attribute GitHub's own code blocks carry.
 */
const focusableCodeBlocks = {
  name: "Focusable code blocks",
  hooks: {
    postprocessRenderedBlock: ({ renderData }) => {
      for (const pre of elements(renderData.blockAst, "pre")) {
        pre.properties.tabIndex = 0;
      }
    },
  },
};

/**
 * Rehype plugin: put every content table in the tab order, for the same axe
 * rule as the code blocks above. Starlight's markdown styles give a table
 * `display: block; overflow: auto`, so a table wider than the content column
 * is itself the scroll box, with no wrapper to carry the attribute. Only
 * `tabindex` is added: a `role` or `aria-label` would replace the table's own
 * semantics for screen readers.
 */
function rehypeFocusableTables() {
  return (tree) => {
    for (const table of elements(tree, "table")) {
      table.properties.tabIndex = 0;
    }
  };
}

/**
 * The sidebar badge a beta domain's group carries. It rides the group, so it
 * renders on every page in that section rather than being repeated in every
 * page's frontmatter.
 *
 * `default` rather than `caution`, which is orange. content-strategy/design.md
 * reserves red, green, yellow and cyan, because manni's own output already
 * gives those colours a meaning, and a page here shows that output in a code
 * block a few lines from the sidebar. `default` follows --sl-color-accent.
 */
const BETA = { text: "Beta", variant: "default" };

/**
 * The badge an in-development domain's group carries: one whose tool is still
 * on its `tool/<name>` branch and not in the published package. `tip` is
 * purple: off the colours BETA's comment reserves, and distinct from BETA.
 */
const IN_DEV = { text: "In Dev", variant: "tip" };

export default defineConfig({
  site: "https://hawkeyexl.github.io",
  base: "/manni",
  // Moved pages. The two halves are spelled differently on purpose: Astro
  // prepends `base` to the **key**, so the route is written base-relative, and
  // it emits the **value** verbatim into the meta-refresh and the canonical
  // link, so the destination has to carry `/manni` itself. Written without it,
  // the redirect builds and resolves and sends the reader to
  // hawkeyexl.github.io/meta/... — off the project base, a 404.
  //
  // Proposal 0041 renamed the sidecar vocabulary to external metadata. Release
  // notes and pull requests link to the old URL, so it must not 404.
  //
  // Proposal 0067 registered the manni vocabularies as built-ins. Their review
  // pages under meta/proposals/ became reference pages under
  // meta/reference/schemas/, one per built-in, and the old per-schema pages
  // moved beside them. `kg` points straight at `graph`, the name 0063 gave it,
  // so an old link takes one hop rather than two.
  redirects: {
    "/meta/set-up/sidecar-metadata": "/manni/meta/set-up/external-metadata",
    "/meta/proposals/frontmatter-vocabularies":
      "/manni/meta/reference/schemas/manni-vocabularies/",
    "/meta/proposals/core": "/manni/meta/reference/schemas/manni-core/",
    "/meta/proposals/stewardship":
      "/manni/meta/reference/schemas/manni-stewardship/",
    "/meta/proposals/audience": "/manni/meta/reference/schemas/manni-audience/",
    "/meta/proposals/lifecycle":
      "/manni/meta/reference/schemas/manni-lifecycle/",
    "/meta/proposals/structure":
      "/manni/meta/reference/schemas/manni-structure/",
    "/meta/proposals/terminology":
      "/manni/meta/reference/schemas/manni-terminology/",
    "/meta/proposals/ai-context":
      "/manni/meta/reference/schemas/manni-ai-context/",
    "/meta/proposals/evals": "/manni/meta/reference/schemas/manni-evals/",
    "/meta/proposals/artifact-evals":
      "/manni/meta/reference/schemas/manni-artifact-evals/",
    "/meta/proposals/graph": "/manni/meta/reference/schemas/manni-graph/",
    "/meta/proposals/kg": "/manni/meta/reference/schemas/manni-graph/",
    "/meta/proposals/citations":
      "/manni/meta/reference/schemas/manni-citations/",
    "/meta/reference/built-in-schemas": "/manni/meta/reference/schemas/",
    "/meta/reference/okf-schema": "/manni/meta/reference/schemas/google-okf/",
    "/meta/reference/dita-schema":
      "/manni/meta/reference/schemas/oasis-dita-metadata/",
    "/meta/reference/claude-subagent-schema":
      "/manni/meta/reference/schemas/anthropic-claude-subagent/",
  },
  // MDX inherits this list, so `.md` and `.mdx` pages both get it.
  markdown: {
    rehypePlugins: [rehypeFocusableTables],
  },
  integrations: [
    starlight({
      title: "manni",
      expressiveCode: {
        plugins: [focusableCodeBlocks],
      },
      // Names an autogenerated subgroup after its directory's index page, so
      // `meta/reference/glossary/` shows as `Glossary` inside Reference, where
      // the one-page glossary sat before each term got a page of its own.
      // `meta/reference/schemas/` is named the same way, by the built-in
      // schema registry at its index, with one page per built-in inside it.
      routeMiddleware: "./src/routeData.ts",
      // One top-level group per tool. `meta` is the metadata tool and `a11y`
      // the accessibility tool; the others arrive with their subcommands, each
      // as a sibling group over its own directory under src/content/docs/.
      // Groups are in alphabetical order by label.
      //
      // Every group starts collapsed, so the landing page shows one line per
      // tool. Starlight still opens whichever groups contain the current page.
      sidebar: [
        {
          label: "a11y",
          collapsed: true,
          items: [
            { label: "Overview", link: "/a11y/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "a11y/get-started" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "a11y/ci" } }],
            },
            {
              label: "Fix a failing check",
              collapsed: true,
              items: [{ autogenerate: { directory: "a11y/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "a11y/reference" } }],
            },
          ],
        },
        // `cite` is the citation tool. Same shape as `meta`, minus a schemas
        // track: the vocabulary a citation is written in is meta's built-in
        // `manni:citations:1.0.0`, documented under meta's reference.
        {
          label: "cite",
          collapsed: true,
          badge: BETA,
          items: [
            { label: "Overview", link: "/cite/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "cite/get-started" } }],
            },
            {
              label: "Set up",
              collapsed: true,
              items: [{ autogenerate: { directory: "cite/set-up" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "cite/ci" } }],
            },
            {
              label: "Fix a failing check",
              collapsed: true,
              items: [{ autogenerate: { directory: "cite/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "cite/reference" } }],
            },
          ],
        },
        // The evals tool. Section order and labels follow its content set in
        // docs/content-strategy/information-architecture.md (`docevals/`).
        {
          label: "docevals",
          collapsed: true,
          badge: BETA,
          items: [
            { label: "Overview", link: "/docevals/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/get-started" } }],
            },
            {
              label: "Write evals",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/evals" } }],
            },
            {
              label: "Adopt at scale",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/adopt" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/ci" } }],
            },
            {
              label: "Trust the judge",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/judge" } }],
            },
            {
              label: "Fix a failing eval",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "docevals/reference" } }],
            },
          ],
        },
        // Each IN_DEV group (graph, tracevals) is a tool still on its
        // `tool/<name>` branch, so main carries only an overview page. The
        // branch brings the rest of the section, and the badge, when it
        // merges.
        {
          label: "graph",
          collapsed: true,
          badge: IN_DEV,
          items: [{ label: "Overview", link: "/graph/" }],
        },
        // `key` manages a family resource rather than documents: the one
        // encryption key every tool encrypts values with (proposal 0045). Two
        // verbs, so the same two-page shape as `a11y`.
        {
          label: "key",
          collapsed: true,
          badge: BETA,
          items: [
            { label: "Overview", link: "/key/" },
            {
              label: "Set up",
              collapsed: true,
              items: [{ autogenerate: { directory: "key/set-up" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "key/ci" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "key/reference" } }],
            },
          ],
        },
        // `lint` is the structure tool. Four journey tracks and a reference
        // shelf. The set-up track is Sara's: writing the doctype template a
        // repository is then held to (S7), which the reference shelf backs.
        {
          label: "lint",
          collapsed: true,
          badge: BETA,
          items: [
            { label: "Overview", link: "/lint/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "lint/get-started" } }],
            },
            {
              label: "Set up",
              collapsed: true,
              items: [{ autogenerate: { directory: "lint/set-up" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "lint/ci" } }],
            },
            {
              label: "Fix a failing check",
              collapsed: true,
              items: [{ autogenerate: { directory: "lint/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "lint/reference" } }],
            },
          ],
        },
        {
          label: "meta",
          collapsed: true,
          items: [
            { label: "Overview", link: "/meta/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/get-started" } }],
            },
            {
              label: "Set up validation",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/set-up" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/ci" } }],
            },
            {
              label: "Define & evolve schemas",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/schemas" } }],
            },
            {
              label: "Fix a failing check",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/reference" } }],
            },
          ],
        },
        // `term` is the terminology tool (proposal 0052). Same shape as
        // `cite`. Its vocabulary is meta's built-in `manni:terminology:1.0.0`,
        // documented under meta's reference.
        {
          label: "term",
          collapsed: true,
          badge: BETA,
          items: [
            { label: "Overview", link: "/term/" },
            {
              label: "Get started",
              collapsed: true,
              items: [{ autogenerate: { directory: "term/get-started" } }],
            },
            {
              label: "Set up",
              collapsed: true,
              items: [{ autogenerate: { directory: "term/set-up" } }],
            },
            {
              label: "Run it in CI",
              collapsed: true,
              items: [{ autogenerate: { directory: "term/ci" } }],
            },
            {
              label: "Fix a failing check",
              collapsed: true,
              items: [{ autogenerate: { directory: "term/fix" } }],
            },
            {
              label: "Reference",
              collapsed: true,
              items: [{ autogenerate: { directory: "term/reference" } }],
            },
          ],
        },
        {
          label: "tracevals",
          collapsed: true,
          badge: IN_DEV,
          items: [{ label: "Overview", link: "/tracevals/" }],
        },
      ],
    }),
  ],
});
