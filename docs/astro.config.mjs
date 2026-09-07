import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://hawkeyexl.github.io",
  base: "/manni",
  integrations: [
    starlight({
      title: "manni",
      // One top-level group per tool. `meta` is the metadata tool; the others
      // arrive with their subcommands, each as a sibling group over its own
      // directory under src/content/docs/.
      sidebar: [
        {
          label: "meta",
          items: [
            { label: "Overview", link: "/meta/" },
            {
              label: "Get started",
              items: [{ autogenerate: { directory: "meta/get-started" } }],
            },
            {
              label: "Set up validation",
              items: [{ autogenerate: { directory: "meta/set-up" } }],
            },
            {
              label: "Run it in CI",
              items: [{ autogenerate: { directory: "meta/ci" } }],
            },
            {
              label: "Define & evolve schemas",
              items: [{ autogenerate: { directory: "meta/schemas" } }],
            },
            {
              label: "Fix a failing check",
              items: [{ autogenerate: { directory: "meta/fix" } }],
            },
            {
              label: "Reference",
              items: [{ autogenerate: { directory: "meta/reference" } }],
            },
            // Published proposals under community review. Distinct from
            // docs/proposals/ (the internal, unpublished ADR log): a page
            // appears here only while it is actively soliciting outside
            // feedback, and links back to the full internal record.
            {
              label: "Proposals",
              items: [{ autogenerate: { directory: "meta/proposals" } }],
            },
          ],
        },
        // `cite` is the citation tool. Same shape as `meta`, minus a schemas
        // track: the vocabulary a citation is written in is meta's, and lives
        // on meta's proposals hub until it registers.
        {
          label: "cite",
          items: [
            { label: "Overview", link: "/cite/" },
            {
              label: "Get started",
              items: [{ autogenerate: { directory: "cite/get-started" } }],
            },
            {
              label: "Set up",
              items: [{ autogenerate: { directory: "cite/set-up" } }],
            },
            {
              label: "Run it in CI",
              items: [{ autogenerate: { directory: "cite/ci" } }],
            },
            {
              label: "Fix a failing check",
              items: [{ autogenerate: { directory: "cite/fix" } }],
            },
            {
              label: "Reference",
              items: [{ autogenerate: { directory: "cite/reference" } }],
            },
          ],
        },
      ],
    }),
  ],
});
