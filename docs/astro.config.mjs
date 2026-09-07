import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://hawkeyexl.github.io",
  base: "/manni",
  integrations: [
    starlight({
      title: "manni",
      // One top-level group per tool. `meta` is the metadata tool and `a11y`
      // the accessibility tool; the others arrive with their subcommands, each
      // as a sibling group over its own directory under src/content/docs/.
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
        {
          label: "a11y",
          items: [
            { label: "Overview", link: "/a11y/" },
            {
              label: "Reference",
              items: [{ autogenerate: { directory: "a11y/reference" } }],
            },
          ],
        },
      ],
    }),
  ],
});
