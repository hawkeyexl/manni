/**
 * `buildTemplateRouting`, `routePage` and `templateSources`: the routing
 * `manni lint` runs per page, exported so `manni docevals` routes identically.
 * Each rung of the precedence chain is pinned against what `runLint` reports
 * as the page's `template` for the same input.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTemplateRouting,
  routePage,
  templateSources,
} from "../../../src/lint/core/routing.js";
import { refRelativeTo } from "../../../src/lint/core/template-registry.js";
import { runLint } from "../../../src/lint/commands/lint.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "templates");
const EVALS = join(fixtures, "evals.yaml");
const EXTENDS = join(fixtures, "extends.yaml");

const slash = (p: string): string => p.replace(/\\/g, "/");

/** A page at `docs/page.md` under a made-up root. */
function page(frontmatter: Record<string, unknown> | null) {
  const absolutePath = slash(resolve("/repo/docs/page.md"));
  return { filePath: "docs/page.md", absolutePath, frontmatter };
}

describe("routePage", () => {
  it("routes everything to --template", async () => {
    const routing = await buildTemplateRouting({
      config: {},
      cliTemplate: "tgdp:reference:1.6",
    });
    const routed = routePage(routing, page({ type: "how-to" }));
    expect(routed.ref).toBe("tgdp:reference:1.6");
    expect(routed.resolution.stage).toBe("cli");
  });

  it("resolves a bare --template name inside the last templates file", async () => {
    const routing = await buildTemplateRouting({
      config: { templates: [EXTENDS] },
      templates: [EVALS],
      cliTemplate: "child",
    });
    expect(routing.templatePaths).toEqual([EVALS]);
    expect(routePage(routing, page(null)).ref).toBe(`${EVALS}#child`);
  });

  it("re-bases a relative $template beside the page", async () => {
    const routing = await buildTemplateRouting({ config: {} });
    const p = page({ $template: "./house.yaml#how-to" });
    const routed = routePage(routing, p);
    expect(routed.resolution.stage).toBe("frontmatter-template");
    expect(routed.resolution.ref).toBe("./house.yaml#how-to");
    expect(routed.ref).toBe(refRelativeTo(p.absolutePath, "./house.yaml#how-to"));
    expect(routed.refusal).toBeUndefined();
  });

  it("refuses a $template that names a URL", async () => {
    const routing = await buildTemplateRouting({ config: {} });
    const routed = routePage(routing, page({ $template: "https://example.com/t.yaml" }));
    expect(routed.ref).toBeNull();
    expect(routed.resolution.ref).toBe("https://example.com/t.yaml");
    expect(routed.refusal).toBe(
      '$template may not name a URL ("https://example.com/t.yaml"): a document must not choose what the linter fetches. Declare it in manni.config.yaml under "templates:" or "types:", or pass it with --template.',
    );
  });

  it("applies a config override, and CLI overrides win over config", async () => {
    const fromConfig = await buildTemplateRouting({
      config: { overrides: [{ files: "docs/**", template: "tgdp:reference:1.6" }] },
    });
    const routed = routePage(fromConfig, page({ type: "how-to" }));
    expect(routed.ref).toBe("tgdp:reference:1.6");
    expect(routed.resolution.stage).toBe("config-override");

    const fromCli = await buildTemplateRouting({
      config: { overrides: [{ files: "docs/**", template: "tgdp:reference:1.6" }] },
      overrides: [],
    });
    expect(routePage(fromCli, page({ type: "how-to" })).ref).toBe("tgdp:how-to:1.6");
  });

  it("routes by type through built-ins, templates files and the types map", async () => {
    const builtin = await buildTemplateRouting({ config: {} });
    expect(routePage(builtin, page({ type: "how-to" })).ref).toBe("tgdp:how-to:1.6");

    // `child` inherits `types: [evals-demo]` through `extends`, and routes.
    const user = await buildTemplateRouting({ config: { templates: [EVALS] } });
    expect(routePage(user, page({ type: "evals-demo" })).ref).toBe(`${EVALS}#child`);

    const mapped = await buildTemplateRouting({
      config: { types: { "how-to": "tgdp:reference:1.6" } },
    });
    expect(routePage(mapped, page({ type: "how-to" })).ref).toBe("tgdp:reference:1.6");
  });

  it("falls back to the default template for an untyped page", async () => {
    const routing = await buildTemplateRouting({
      config: { template: "tgdp:reference:1.6" },
    });
    const routed = routePage(routing, page({}));
    expect(routed.ref).toBe("tgdp:reference:1.6");
    expect(routed.resolution.stage).toBe("config-default");
  });

  it("routes nothing for an unknown type or no type", async () => {
    const routing = await buildTemplateRouting({ config: {} });
    const unknown = routePage(routing, page({ type: "how-too" }));
    expect(unknown.ref).toBeNull();
    expect(unknown.resolution.cause).toBe("unknown-type");
    expect(unknown.refusal).toBeUndefined();

    const untyped = routePage(routing, page(null));
    expect(untyped.ref).toBeNull();
    expect(untyped.resolution.cause).toBe("no-type");
  });

  it("agrees with the template runLint reports for the same page", async () => {
    const content = "---\ntype: evals-demo\n---\n\n# Title\n\n## Overview\n\nText.\n";
    const { results } = await runLint({
      inputs: ["-"],
      as: "markdown",
      stdinContent: content,
      templates: [EVALS],
      noConfig: true,
    });
    const routing = await buildTemplateRouting({ config: {}, templates: [EVALS] });
    const routed = routePage(routing, {
      filePath: "<stdin>",
      absolutePath: "<stdin>",
      frontmatter: { type: "evals-demo" },
    });
    expect(results[0]?.template).toBe(routed.ref);
  });

  it("caches each loaded template, with its extends chain merged", async () => {
    const routing = await buildTemplateRouting({ config: {} });
    const first = routing.getTemplate(`${EVALS}#child`);
    expect(routing.getTemplate(`${EVALS}#child`)).toBe(first);
    expect((await first).types).toEqual(["evals-demo"]);
  });
});

describe("templateSources", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-lint-sources-"));
    await writeFile(
      join(dir, "base.yaml"),
      "templates:\n  base:\n    extends: tgdp:how-to:1.6\n",
    );
    await writeFile(
      join(dir, "house.yaml"),
      "templates:\n  house:\n    extends: ./base.yaml#base\n",
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists a local template and each local file in its extends chain, once", async () => {
    expect(await templateSources(`${EVALS}#child`)).toEqual([slash(EVALS)]);
    expect(await templateSources(`${EXTENDS}#child`)).toEqual([slash(EXTENDS)]);
  });

  it("re-bases a relative extends and omits a built-in parent", async () => {
    expect(await templateSources(join(dir, "house.yaml"))).toEqual([
      slash(join(dir, "house.yaml")),
      slash(join(dir, "base.yaml")),
    ]);
  });

  it("omits built-in ids", async () => {
    expect(await templateSources("tgdp:how-to:1.6")).toEqual([]);
  });
});
