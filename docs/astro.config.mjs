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
  redirects: {
    "/meta/set-up/sidecar-metadata": "/manni/meta/set-up/external-metadata",
  },
  integrations: [
    starlight({
      title: "manni",
      expressiveCode: {
        plugins: [focusableCodeBlocks],
      },
      // One top-level group per tool. `meta` is the metadata tool and `a11y`
      // the accessibility tool; the others arrive with their subcommands, each
      // as a sibling group over its own directory under src/content/docs/.
      //
      // Every group starts collapsed, so the landing page shows one line per
      // tool. Starlight still opens whichever groups contain the current page.
      sidebar: [
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
            // Published proposals under community review. Distinct from
            // docs/proposals/ (the internal, unpublished ADR log): a page
            // appears here only while it is actively soliciting outside
            // feedback, and links back to the full internal record.
            {
              label: "Proposals",
              collapsed: true,
              items: [{ autogenerate: { directory: "meta/proposals" } }],
            },
          ],
        },
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
        // track: the vocabulary a citation is written in is meta's, and lives
        // on meta's proposals hub until it registers.
        {
          label: "cite",
          collapsed: true,
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
        // `key` manages a family resource rather than documents: the one
        // encryption key every tool encrypts values with (proposal 0045). Two
        // verbs, so the same two-page shape as `a11y`.
        {
          label: "key",
          collapsed: true,
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
      ],
    }),
  ],
});
