import { describe, expect, it } from "vitest";
import { playgroundSourceUrl } from "../../docs/src/components/retrieve-prototype-links.js";

const location = "http://localhost:4327/manni/graph/retrieve-from-a-script/";
const base = "/manni/";

describe("the graph playground's published source links", () => {
  it("maps repository page paths to this site's base and preserves section anchors", () => {
    expect(playgroundSourceUrl("docs/src/content/docs/key/index.mdx", "https://example.com/id/key#rotate", base, location))
      .toBe("http://localhost:4327/manni/key/#rotate");
    expect(playgroundSourceUrl("docs/src/content/docs/meta/reference/api.mdx", "urn:api", base, location))
      .toBe("http://localhost:4327/manni/meta/reference/api/");
    expect(playgroundSourceUrl("docs/src/content/docs/index.mdx", "urn:home", base, location))
      .toBe("http://localhost:4327/manni/");
  });

  it("keeps an explicit source fragment and existing HTTP links", () => {
    expect(playgroundSourceUrl("docs/src/content/docs/key/index.mdx#existing", "urn:key#other", base, location))
      .toBe("http://localhost:4327/manni/key/#existing");
    expect(playgroundSourceUrl("https://example.com/source#actual", "urn:key#other", base, location))
      .toBe("https://example.com/source#actual");
    expect(playgroundSourceUrl("/manni/cite/", "urn:cite", base, location))
      .toBe("http://localhost:4327/manni/cite/");
  });

  it("does not turn script URLs or escaped source paths into links", () => {
    expect(playgroundSourceUrl("javascript:alert(1)", "urn:key", base, location)).toBeUndefined();
    expect(playgroundSourceUrl("data:text/html,hello", "urn:key", base, location)).toBeUndefined();
    expect(playgroundSourceUrl("docs/src/content/docs/../../secret.mdx", "urn:key", base, location)).toBeUndefined();
    expect(playgroundSourceUrl("docs/src/content/docs/%2e%2e/secret.mdx", "urn:key", base, location)).toBeUndefined();
    expect(playgroundSourceUrl("urn:manni:page", "urn:key", base, location)).toBeUndefined();
  });
});
