/**
 * The once-per-run pass that attaches each page's routed template evals
 * (`core/templates.ts`). The router is injected, as `readers.ts` injects its
 * loader, except where the test is about lint's own routing.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocevalsConfig } from "../helpers/config.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import {
  displayRef,
  withTemplateEvals,
  type RouteInput,
  type TemplateRouter,
} from "../../../src/docevals/core/templates.js";
import type { RoutedPage } from "../../../src/lint/index.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const CONFIG = parseDocevalsConfig(
  [
    "evals:",
    "  house-voice:",
    "    assertion: The page is in the house voice.",
    "    examples: { pass: yes, fail: no }",
  ].join("\n"),
);

function page(frontmatterYaml: string, file = "docs/page.md"): PageFile {
  const content = `---\n${frontmatterYaml}\n---\nBody.`;
  return {
    file,
    absPath: `/fake/${file}`,
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
}

/** Routes `type: x` to `x.yaml`, refuses a `$template` URL, and counts loads. */
function fakeRouter(entries: Record<string, unknown>[] | string[] = ["Claim."]): {
  router: TemplateRouter;
  loads: string[];
  routed: RouteInput[];
} {
  const loads: string[] = [];
  const routed: RouteInput[] = [];
  const router: TemplateRouter = {
    route(input): RoutedPage {
      routed.push(input);
      const fm = input.frontmatter ?? {};
      const tpl = fm["$template"];
      if (typeof tpl === "string") {
        return {
          resolution: { ref: tpl, stage: "frontmatter-template", steps: [] },
          ref: null,
          refusal: "URL refused",
        };
      }
      const type = fm["type"];
      if (typeof type !== "string") {
        return { resolution: { ref: null, stage: null, cause: "no-type", steps: [] }, ref: null };
      }
      const ref = `${type}.yaml`;
      return { resolution: { ref, stage: "type", steps: [] }, ref };
    },
    load(ref) {
      loads.push(ref);
      return Promise.resolve({ evals: entries, sources: [`/fake/${ref}`] });
    },
  };
  return { router, loads, routed };
}

describe("withTemplateEvals", () => {
  it("attaches the routed template and loads each one once", async () => {
    const { router, loads } = fakeRouter();
    const pages = await withTemplateEvals(
      [page("type: how-to", "a.md"), page("type: how-to", "b.md"), page("title: x", "c.md")],
      CONFIG,
      "/fake",
      () => Promise.resolve(router),
    );
    expect(loads).toEqual(["how-to.yaml"]);
    expect(pages[0]?.template).toEqual({
      ref: "how-to.yaml",
      stage: "type",
      entries: ["Claim."],
      sources: ["/fake/how-to.yaml"],
    });
    expect(pages[1]?.template?.ref).toBe("how-to.yaml");
    // Unrouted: no template, no problem.
    expect(pages[2]?.template).toBeUndefined();
  });

  it("prints a local template relative to the run's directory, and loads it absolute", async () => {
    const { router, loads } = fakeRouter();
    const abs = resolve("/repo/templates/how-to.yaml");
    const routeAbs: TemplateRouter = {
      route: () => ({ resolution: { ref: abs, stage: "type", steps: [] }, ref: `${abs}#how-to` }),
      load: (ref) => router.load(ref),
    };
    const [p] = await withTemplateEvals([page("type: how-to")], CONFIG, resolve("/repo"), () =>
      Promise.resolve(routeAbs),
    );
    expect(p?.template?.ref).toBe("templates/how-to.yaml#how-to");
    expect(loads).toEqual([`${abs}#how-to`]);
  });

  it("carries lint's refusal for a $template URL", async () => {
    const { router } = fakeRouter();
    const [p] = await withTemplateEvals(
      [page("$template: https://example.com/t.yaml")],
      CONFIG,
      "/fake",
      () => Promise.resolve(router),
    );
    expect(p?.template).toMatchObject({ ref: null, refusal: "URL refused", entries: [] });
  });

  it("refuses a template use: no docevals.evals entry defines, before any page is graded", async () => {
    const { router } = fakeRouter([{ use: "house-voice" }, { use: "no-such-eval" }]);
    const run = withTemplateEvals([page("type: how-to")], CONFIG, "/fake", () =>
      Promise.resolve(router),
    );
    await expect(run).rejects.toThrow(DocevalsError);
    await expect(run).rejects.toThrow(
      'how-to.yaml: evals use "no-such-eval", which no template it extends and no ' +
        "docevals.evals entry in /fake/manni.config.yaml defines",
    );
  });

  it("routes on the page's own frontmatter, not on a manifest-supplied type", async () => {
    const { router, routed } = fakeRouter();
    const supplied: PageFile = {
      ...page("type: how-to\ntitle: x"),
      external: {
        locate: (pointer) => (pointer === "/type" ? { file: "site.metadata.yaml", line: 2 } : undefined),
        collisions: [],
        evalManifests: [],
      },
    };
    const [p] = await withTemplateEvals([supplied], CONFIG, "/fake", () =>
      Promise.resolve(router),
    );
    expect(routed[0]?.frontmatter).toEqual({ title: "x" });
    expect(p?.template).toBeUndefined();
  });
});

describe("withTemplateEvals over lint's own routing", () => {
  it("routes a typed page to the built-in with no config at all", async () => {
    const [p] = await withTemplateEvals([page("type: how-to")], CONFIG, "/fake");
    expect(p?.template?.ref).toBe("tgdp:how-to:1.6");
    expect(p?.template?.sources).toEqual([]);
    expect(p?.template?.entries.length).toBeGreaterThan(0);
  });

  it("does not route a type a manifest supplied", async () => {
    const supplied: PageFile = {
      ...page("type: how-to"),
      external: {
        locate: (pointer) => (pointer === "/type" ? { file: "site.metadata.yaml", line: 2 } : undefined),
        collisions: [],
        evalManifests: [],
      },
    };
    const [p] = await withTemplateEvals([supplied], CONFIG, "/fake");
    expect(p?.template).toBeUndefined();
  });
});

describe("displayRef", () => {
  const base = resolve("/repo");
  it("shows a template inside the run's directory relative to it, #name kept", () => {
    expect(displayRef(`${resolve("/repo/templates/how-to.yaml")}#how-to`, base)).toBe(
      "templates/how-to.yaml#how-to",
    );
  });
  it("keeps the absolute path of a template outside the run's directory", () => {
    const outside = resolve("/elsewhere/how-to.yaml");
    expect(displayRef(outside, base)).toBe(outside.replaceAll("\\", "/"));
  });
  it("leaves built-in ids and URLs as written", () => {
    expect(displayRef("tgdp:how-to:1.6", base)).toBe("tgdp:how-to:1.6");
    expect(displayRef("https://example.com/t.yaml#how-to", base)).toBe(
      "https://example.com/t.yaml#how-to",
    );
  });
});
