/**
 * The judge reads an HTML or XML page's body as text (proposal 0125, decision
 * 21). Tags are dropped through lint's parser for the page's format, a Flare
 * topic reads resolved against its project, and `cleanBody`, which strips MDX
 * noise, never runs over it. Markdown's prompt is pinned byte for byte in
 * `judge.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { readPage, type PageFile } from "../../../src/docevals/core/discover.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { bodyOffset, extractorForExtension } from "../../../src/meta/internal.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const FORMATS = resolve(import.meta.dirname, "../fixtures/formats");
const config = parseDocevalsConfig("", join(FORMATS, "manni.config.yaml"));

/** `page` with one judged eval on its body, as a manifest would supply it. */
function judged(page: PageFile): GraderTarget {
  const withEval: PageFile = {
    ...page,
    frontmatter: {
      ...page.frontmatter,
      data: { ...page.frontmatter.data, evals: [{ id: "claim", assertion: "The page names the product." }] },
    },
  };
  const plan = resolvePage(withEval, config);
  const ev = plan.evals[0];
  if (ev === undefined) throw new Error("the page resolved no evals");
  return { plan, eval: ev };
}

/** The `# Page content` the judge sent for `page`. */
async function sent(page: PageFile): Promise<string> {
  const provider = new MockProvider([mockVerdict("pass", 0.95)]);
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-markup-"));
  await makeJudge({ provider, root })([judged(page)], config, {});
  const user = provider.requests[0]?.user ?? "";
  return user.slice(user.indexOf("# Page content\n\n") + "# Page content\n\n".length);
}

describe("the judge on an HTML or XML page", () => {
  it("reads a Flare topic as text, its variables resolved", async () => {
    const text = await sent(readPage(join(FORMATS, "Content/topic.htm"), FORMATS));
    expect(text).toBe("Install Widget\n\nRun the installer.\n\nTODO: name the flags.");
  });

  it("reads a DITA topic as text", async () => {
    const text = await sent(readPage(join(FORMATS, "Content/concept.dita"), FORMATS));
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("The widget installs in one step.");
  });

  it("keeps a code line cleanBody would drop", async () => {
    const content = "<html><head><title>T</title></head><body><pre><code>import x from \"y\"</code></pre></body></html>";
    const absPath = join(FORMATS, "code.html");
    const extractor = extractorForExtension(".html");
    if (extractor === undefined) throw new Error("no HTML extractor");
    const page: PageFile = {
      file: "code.html",
      absPath,
      content,
      body: content.slice(bodyOffset(content, absPath) ?? 0),
      frontmatter: extractor.extract(content, absPath),
    };
    expect(await sent(page)).toBe('import x from "y"');
  });
});
