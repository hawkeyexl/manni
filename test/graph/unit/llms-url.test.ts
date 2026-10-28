/**
 * `graph export llms` links in the detected framework's URL style. A Flare
 * site publishes `Content/…/Topic.htm`, so its links end `.htm` (proposal
 * 0125, decision 22).
 */
import { describe, expect, it } from "vitest";
import { routeOf, urlStyle } from "../../../src/graph/commands/llms.js";
import type { RouteMapping } from "../../../src/graph/core/config.js";

const routes: RouteMapping[] = [{ basePath: "", root: "", extensions: [".htm"], indexFiles: ["index"] }];

describe("llms URL style", () => {
  it("writes .htm links for a Flare site", () => {
    expect(urlStyle("Flare")).toBe("htm");
    expect(routeOf("Content/Topics/Install.htm", routes, urlStyle("Flare"))).toBe("/Content/Topics/Install.htm");
  });

  it("leaves the other styles as they were", () => {
    expect(routeOf("Content/Topics/Install.htm", routes, urlStyle("Sphinx"))).toBe("/Content/Topics/Install.html");
    expect(routeOf("Content/Topics/Install.htm", routes, urlStyle(null))).toBe("/Content/Topics/Install/");
  });
});
