/**
 * The route resolver `analyzeDoc` uses for a `/` link, called directly, as
 * `manni strategy` calls it for a journey step's `doc`.
 */
import { describe, expect, it } from "vitest";
import { PathIndex, resolveRoute } from "../../../src/graph/core/analyze.js";
import type { RouteMapping } from "../../../src/graph/core/config.js";

const ROUTES: RouteMapping[] = [{ basePath: "/site", root: "docs", extensions: [".md"], indexFiles: ["index"] }];
const index = new PathIndex(new Set(["docs/guide.md", "docs/ci/index.md"]));

describe("resolveRoute", () => {
  it("resolves a mapped route to its page, a directory route to its index", () => {
    expect(resolveRoute("/site/guide/", ROUTES, index)).toBe("docs/guide.md");
    expect(resolveRoute("/site/ci/", ROUTES, index)).toBe("docs/ci/index.md");
  });

  it("says broken for a mapped route with no file, and null for an unmapped one", () => {
    expect(resolveRoute("/site/tutorial/", ROUTES, index)).toBe("broken");
    expect(resolveRoute("/elsewhere/guide/", ROUTES, index)).toBeNull();
  });
});
