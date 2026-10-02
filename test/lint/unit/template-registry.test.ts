import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyRef,
  clearTemplateCaches,
  listBuiltins,
  loadResolvedTemplate,
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
  validateTemplateFile,
  type TemplateResolver,
} from "../../../src/lint/core/template-registry.js";
import {
  headingMatches,
  isWildcard,
  occurrenceRange,
  type Rule,
  type Template,
} from "../../../src/lint/core/template.js";
import { LintError } from "../../../src/lint/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "templates");

/** The message of the `LintError` a rejected promise carries. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LintError);
    return (err as Error).message;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** The message of the `LintError` a synchronous call throws. */
function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LintError);
    return (err as Error).message;
  }
  throw new Error("expected the call to throw, but it returned");
}

/**
 * Capture what the loader says on stderr. Warnings are said once per process,
 * so each test that asserts on one starts from a clean slate.
 */
function captureStderr(): { text: () => string; restore: () => void } {
  resetWarnings();
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
  return {
    text: () => chunks.join(""),
    restore: () => {
      spy.mockRestore();
    },
  };
}

/** The rule at `index` of a loaded template's `sections`. */
function ruleAt(template: Template | undefined, index: number): Rule {
  return at(defined(template, "the template").sections ?? [], index, "rule");
}

/** The rule of a loaded template carrying `id`. */
function ruleById(template: Template | undefined, id: string): Rule {
  const rules = defined(template, "the template").sections ?? [];
  return defined(
    rules.find((rule) => rule.id === id),
    `the rule with id "${id}"`,
  );
}

describe("classifyRef", () => {
  it("classifies a built-in id", () => {
    expect(classifyRef("tgdp:how-to:1").kind).toBe("builtin");
    // A hyphenated segment must still classify as a built-in, not a file.
    expect(classifyRef("manni-lint:how-to:1").kind).toBe("builtin");
    expect(classifyRef("tgdp:how-to:1").ref).toBe("tgdp:how-to:1");
  });

  it("classifies an http(s) url", () => {
    expect(classifyRef("https://example.com/templates.yaml").kind).toBe("url");
    expect(classifyRef("http://example.com/templates.yaml").kind).toBe("url");
  });

  it("classifies a path as a file", () => {
    expect(classifyRef("./templates.yaml").kind).toBe("file");
    expect(classifyRef("templates/how-to.yaml").kind).toBe("file");
    expect(classifyRef("../a/b.json").kind).toBe("file");
  });

  it("never classifies a Windows path as a built-in", () => {
    expect(classifyRef("C:\\Users\\me\\templates.yaml").kind).toBe("file");
    // No extension either: the backslash alone has to be enough.
    expect(classifyRef("C:\\Users\\me\\templates").kind).toBe("file");
    expect(classifyRef("C:").kind).toBe("file");
  });

  it("classifies a bare template filename as a file, not a built-in", () => {
    // No path separator, so only the extension keeps these out of the
    // built-in namespace.
    expect(classifyRef("templates.yaml").kind).toBe("file");
    expect(classifyRef("templates.yml").kind).toBe("file");
    expect(classifyRef("templates.json").kind).toBe("file");
  });
});

/**
 * The manifest, and the two refusals that happen before a file is opened.
 *
 * Loading a built-in is not tested here yet. The seven shipped templates are
 * still written in v1 and are rewritten in a later piece of work; until then
 * every one of them fails this schema, which is what
 * `test/lint/integration/tgdp.test.ts` reports.
 */
describe("built-ins", () => {
  it("lists every entry in the manifest", () => {
    const builtins = listBuiltins();
    expect(builtins.length).toBeGreaterThan(0);
    for (const builtin of builtins) {
      expect(builtin.id).toMatch(/^[a-z0-9-]+:[a-z0-9-]+:[\d.]+$/);
      expect(builtin.title).not.toBe(builtin.id);
      expect(builtin.types.length).toBeGreaterThan(0);
    }
  });

  it("errors on an unknown built-in id, listing what is available", async () => {
    // A real vendor and slug with the wrong version: the near miss is the case
    // worth getting right.
    const message = await rejectionMessage(loadTemplate("tgdp:how-to:9.9"));
    expect(message).toContain('Unknown built-in template "tgdp:how-to:9.9"');
    expect(message).toContain("tgdp:how-to:1.6");
  });

  it("refuses to load a built-in id as a file", async () => {
    const message = await rejectionMessage(loadTemplateFile("tgdp:how-to:1.6"));
    expect(message).toContain("built-in template id, not a template file");
  });

  // The fragment was stripped and then ignored, so this loaded the built-in
  // and succeeded - a configuration error silently selecting a different
  // reference than the author wrote, which is the failure the `Object.hasOwn`
  // guard below exists to prevent one ref-kind over.
  it("rejects a fragment on a built-in id rather than ignoring it", async () => {
    const message = await rejectionMessage(loadTemplate("tgdp:how-to:1.6#typo"));
    expect(message).toContain("#typo");
    expect(message).toContain("tgdp:how-to:1.6");
  });

  // A tool that prints a diagnostic on every run of its own built-ins trains
  // people to ignore its stderr. `captureStderr` catches both `warn()` and
  // Ajv's own strict-mode `console.warn` - the ajv instance writes through
  // `process.stderr.write` either way - so this is one check for both.
  // `clearTemplateCaches` forces every built-in to actually load (and
  // schema-validate) rather than serve a result already cached by an earlier
  // test in this file.
  it("loads every shipped built-in without printing anything to stderr", async () => {
    const stderr = captureStderr();
    try {
      clearTemplateCaches();
      for (const { id } of listBuiltins()) {
        await loadTemplate(id);
      }
    } finally {
      stderr.restore();
    }
    expect(stderr.text()).toBe("");
  });
});

describe("loadTemplateFile", () => {
  it("loads a yaml file and leaves unstated counts unstated", async () => {
    const file = await loadTemplateFile(join(fixtures, "single.yaml"));
    const howTo = file.templates?.["how-to"];
    const overview = ruleAt(howTo, 0);
    expect(overview.heading).toBe("Overview");
    // Deliberately NOT defaulted to `1` at load time: a written-in default
    // wins the `extends` merge and would reset an inherited `min: 0`.
    // "Once unless stated" is `occurrenceRange`'s job, not the loader's.
    expect(overview.min).toBeUndefined();
    expect(occurrenceRange(overview)).toEqual({ min: 1, max: null });
    expect(ruleAt(howTo, 1).min).toBe(0);
  });

  it("loads a json file", async () => {
    const file = await loadTemplateFile(join(fixtures, "single.json"));
    expect(file.templates?.["concept"]?.types).toEqual(["concept"]);
    expect(ruleAt(file.templates?.["concept"], 0).id).toBe("overview");
  });

  it("reports a missing file by name", async () => {
    const message = await rejectionMessage(loadTemplateFile(join(fixtures, "nope.yaml")));
    expect(message).toContain("Template file not found");
    expect(message).toContain("nope.yaml");
  });

  it("names the source and the instance path of a schema error", async () => {
    const source = join(fixtures, "invalid.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));
    // The pre-rewrite loader threw a bare "Template is invalid" here.
    expect(message).toContain(source);
    expect(message).toContain("/templates/how-to/sections/0/contains");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("paragrafs");
  });
});

/**
 * A template file can be fetched, so the two things that only happen over the
 * network have to stay pinned: the fetch is cached for the life of the process,
 * and it gives up rather than hanging a CI job.
 */
describe("a remote template file", () => {
  let server: Server;
  let origin: string;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/slow") return; // never answers, so the fetch times out
      hits += 1;
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end("templates:\n  how-to:\n    types: [how-to]\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    clearTemplateCaches();
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => {
        done();
      });
    });
  });

  it("fetches a url once and serves the cache after that", async () => {
    clearTemplateCaches();
    hits = 0;
    const url = `${origin}/templates.yaml`;
    const first = await loadTemplateFile(url);
    const second = await loadTemplateFile(url);
    expect(second).toBe(first);
    expect(hits).toBe(1);
  });

  it("gives up on a url that never answers, naming the timeout", async () => {
    const message = await rejectionMessage(
      loadTemplateFile(`${origin}/slow`, { timeoutMs: 50 }),
    );
    expect(message).toContain("Failed to fetch template file");
    expect(message).toContain("timed out after 50ms");
  });
});

describe("`instructions` migration", () => {
  it("replaces the raw schema error with a migration message", async () => {
    const source = join(fixtures, "instructions.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain(source);
    expect(message).toContain('"templates.how-to.sections.title" uses `instructions`');
    expect(message).toContain("manni lint no longer evaluates");
    expect(message).toContain("manni docevals assertion eval in manni.config.yaml");
    // The eval snippet, with the author's own instruction in it.
    expect(message).toContain("  docevals:");
    expect(message).toContain("    evals:");
    expect(message).toContain("      how-to-title:");
    expect(message).toContain("        assertion: Must mention the intent of the document");
    expect(message).toContain("        grader: ai");
    // And none of Ajv's useless "must NOT be valid" for the `not` keyword.
    expect(message).not.toContain("must NOT be valid");
  });

  // It is looked for before the v1-key scan on purpose. A file carrying
  // `instructions` is a v1 file too, and "where the feature went" is the more
  // useful of the two answers.
  it("wins over the v1-key refusal on a file that is both", async () => {
    const message = await rejectionMessage(
      loadTemplateFile(join(fixtures, "instructions.yaml")),
    );
    expect(message).toContain("uses `instructions`");
    expect(message).not.toContain("is a list of rules");
  });

  it("catches `instructions` wherever it sits in the file", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            Sample: {
              sections: [
                { id: "Introduction", sections: [{ instructions: ["Explain it"] }] },
              ],
            },
          },
        },
        "nested.yaml",
      ),
    );
    expect(message).toContain('"templates.Sample.sections.0.sections.0"');
    expect(message).toContain("        assertion: Explain it");
  });

  // A rule may legitimately be called `instructions`: TGDP's README doctype
  // wants a section about installation instructions. The id is not the key.
  it("does not mistake a rule named `instructions` for the legacy key", () => {
    const file = validateTemplateFile(
      {
        templates: {
          readme: { sections: [{ id: "instructions", heading: "Instructions" }] },
        },
      },
      "readme.yaml",
    );
    expect(ruleById(file.templates?.["readme"], "instructions").heading).toBe(
      "Instructions",
    );
  });

  it("still catches the legacy property on a rule named `instructions`", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            readme: {
              sections: [
                { id: "instructions", instructions: ["Explain how to install it"] },
              ],
            },
          },
        },
        "readme.yaml",
      ),
    );
    expect(message).toContain('"templates.readme.sections.0"');
    expect(message).toContain("        assertion: Explain how to install it");
  });
});

/**
 * External `$ref` resolution is off. A template file is untrusted input - it can
 * be fetched over http, or written by someone other than whoever runs the lint -
 * and the dereferencer resolves `$ref` targets by reading files and making
 * requests from the linting host. Left on, `$ref: /etc/passwd` or
 * `$ref: http://169.254.169.254/...` in a template turned a lint run into an
 * arbitrary read.
 *
 * With external resolution off such a `$ref` is not fetched and not followed; it
 * is simply left standing, and the schema - `additionalProperties: false` on
 * every rule - then rejects the file for carrying it.
 */
describe("`$ref` resolution stays inside the file", () => {
  // The regression risk of turning it off: intra-file `$ref` is how a template
  // file shares one rule between templates, and it must survive.
  it("resolves an internal `$ref` shared between two templates", async () => {
    const file = await loadTemplateFile(join(fixtures, "internal-ref.yaml"));

    const howTo = ruleById(file.templates?.["how-to"], "next-steps");
    expect(howTo.heading).toBe("Next steps");
    expect(howTo.min).toBe(0);
    expect(howTo.contains?.paragraphs?.min).toBe(1);

    const reference = ruleById(file.templates?.["reference"], "next-steps");
    expect(reference.heading).toBe("Next steps");
    expect(reference.contains?.paragraphs?.min).toBe(1);
  });

  // This one reached the network: the fixture's host does not exist, and the
  // failure it used to produce was "Error downloading ... fetch failed" - which
  // is proof the request was made.
  it("rejects a `$ref` at an http url rather than fetching it", async () => {
    const source = join(fixtures, "external-http-ref.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain("/templates/how-to/sections/0");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("$ref");
    // Not "could not resolve a `$ref`": the point is that nothing was fetched,
    // not that fetching failed.
    expect(message).not.toContain("could not resolve");
  });

  // The fixture's `$ref` names a file that really is there, so this used to
  // load clean - the read succeeded and nothing anywhere said it had happened.
  it("rejects a `$ref` at a local file rather than reading it", async () => {
    const source = join(fixtures, "external-file-ref.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));

    expect(message).toContain("/templates/how-to/sections/0");
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain("$ref");
    expect(message).not.toContain("could not resolve");
  });
});

describe("loadTemplate", () => {
  it("returns the only template in a file with no fragment", async () => {
    const template = await loadTemplate(join(fixtures, "single.yaml"));
    expect(template.types).toEqual(["how-to"]);
  });

  it("selects a template with a `#` fragment", async () => {
    const template = await loadTemplate(join(fixtures, "multi.yaml#reference"));
    expect(template.types).toEqual(["reference"]);
    expect(ruleAt(template, 0).heading).toBe("Syntax");
  });

  it("lists the available names when a multi-template file has no fragment", async () => {
    const source = join(fixtures, "multi.yaml");
    const message = await rejectionMessage(loadTemplate(source));
    expect(message).toContain("defines 2 templates");
    expect(message).toContain('name one with a "#" fragment');
    expect(message).toContain("how-to");
    expect(message).toContain("reference");
  });

  it("lists the available names when the fragment names nothing", async () => {
    const message = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#nope")));
    expect(message).toContain('no template named "nope"');
    expect(message).toContain("how-to, reference");
  });

  // The template map is a plain object parsed from YAML, so `#constructor` and
  // `#toString` used to reach a member inherited from `Object.prototype`. That
  // member is truthy, so the "no template named" guard let it through and a
  // function came back as a template. Carrying no rules, it checked the
  // document against nothing, and the file was reported as PASSING.
  it("reports a fragment naming an inherited object member as no such template", async () => {
    const ctor = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#constructor")));
    expect(ctor).toContain('no template named "constructor"');
    expect(ctor).toContain("how-to, reference");

    const str = await rejectionMessage(loadTemplate(join(fixtures, "multi.yaml#toString")));
    expect(str).toContain('no template named "toString"');
  });
});

describe("resolveExtends", () => {
  const library: Record<string, Template> = {
    base: {
      types: ["how-to"],
      title: "House how-to",
      sections: [
        { id: "overview", heading: "Overview", contains: { paragraphs: { min: 1 } } },
        { id: "see-also", min: 0, heading: "See also" },
        {
          id: "task",
          sections: [
            { id: "steps", heading: "Steps", contains: { lists: { min: 1 } } },
            { id: "caveats", min: 0 },
          ],
        },
      ],
    },
    child: {
      extends: "base",
      sections: [
        { id: "overview", heading: "Introduction", contains: { paragraphs: { min: 2 } } },
        // Tightens one nested rule. Its siblings under `task`, and `task`'s own
        // keys, must survive.
        { id: "task", sections: [{ id: "caveats", min: 1 }] },
      ],
    },
  };

  /**
   * A resolver over a template map. A `TemplateResolver` returns a promise, so
   * a missing ref has to *reject* rather than throw where the caller is not
   * awaiting yet - which is what an `async` function throwing used to give.
   */
  const resolverFor =
    (map: Record<string, Template>): TemplateResolver =>
    (ref) => {
      const template = map[ref];
      return template
        ? Promise.resolve(template)
        : Promise.reject(new LintError(`no such template: ${ref}`));
    };

  const load: TemplateResolver = resolverFor(library);

  const mergedChild = () =>
    resolveExtends(defined(library["child"], "the child template"), load);

  it("returns a template with no `extends` unchanged", async () => {
    const base = defined(library["base"], "the base template");
    expect(await resolveExtends(base, load)).toBe(base);
  });

  it("replaces the parent's rule of the same id and inherits every key the child omits", async () => {
    const merged = await mergedChild();

    expect(ruleById(merged, "overview").heading).toBe("Introduction");
    expect(ruleById(merged, "see-also").heading).toBe("See also");
    expect(merged.types).toEqual(["how-to"]);
    expect(merged.title).toBe("House how-to");
    // The chain is resolved, so nothing downstream tries to resolve it again.
    expect(merged.extends).toBeUndefined();
  });

  it("replaces an inherited rule in place, keeping the parent's order", async () => {
    const merged = await mergedChild();
    expect((merged.sections ?? []).map((rule) => rule.id)).toEqual([
      "overview",
      "see-also",
      "task",
    ]);
  });

  it("appends a child rule that names no id the parent uses", async () => {
    const withExtras: Record<string, Template> = {
      base: { sections: [{ id: "overview", heading: "Overview" }] },
      child: {
        extends: "base",
        sections: [
          // One with an id the parent does not use, one with no id at all.
          { id: "troubleshooting", heading: "Troubleshooting" },
          { heading: "See also" },
        ],
      },
    };
    const merged = await resolveExtends(
      defined(withExtras["child"], "the child template"),
      resolverFor(withExtras),
    );

    expect((merged.sections ?? []).map((rule) => rule.heading)).toEqual([
      "Overview",
      "Troubleshooting",
      "See also",
    ]);
  });

  // An unnamed child rule is appended every time, never matched by position.
  // Matching by position would mean a parent that inserts a rule silently
  // re-targets every override below it.
  it("appends an unnamed child rule rather than matching it by position", async () => {
    const byPosition: Record<string, Template> = {
      base: { sections: [{ id: "overview", heading: "Overview" }] },
      child: { extends: "base", sections: [{ heading: "Something else" }] },
    };
    const merged = await resolveExtends(
      defined(byPosition["child"], "the child template"),
      resolverFor(byPosition),
    );

    expect(merged.sections).toHaveLength(2);
    expect(ruleAt(merged, 0).heading).toBe("Overview");
  });

  // The merge reaches individual rules, not just ids at the top: a child that
  // names one key of a nested rule keeps the parent's others.
  it("keeps a nested rule's other keys when the child names only some", async () => {
    const deep: Record<string, Template> = {
      base: {
        sections: [
          {
            id: "task",
            max: 4,
            sections: [
              {
                id: "steps",
                heading: "Steps",
                contains: { lists: { min: 1 } },
              },
            ],
          },
        ],
      },
      narrower: {
        extends: "base",
        sections: [
          { id: "task", sections: [{ id: "steps", contains: { lists: { min: 2 } } }] },
        ],
      },
    };

    const merged = await resolveExtends(
      defined(deep["narrower"], "the narrower template"),
      resolverFor(deep),
    );
    const task = ruleById(merged, "task");

    expect(task.max).toBe(4);
    const steps = at(task.sections ?? [], 0, "the steps rule");
    expect(steps.contains).toEqual({ lists: { min: 2 } });
    expect(steps.heading).toBe("Steps");
  });

  // `sections` is a container, not a rule. Replacing it wholesale would mean
  // tightening one nested rule silently discarded every sibling the parent
  // declared - which is the opposite of what `extends` is for.
  it("merges nested rules instead of replacing the branch", async () => {
    const task = ruleById(await mergedChild(), "task");

    expect((task.sections ?? []).map((rule) => rule.id)).toEqual([
      "steps",
      "caveats",
    ]);
    const steps = at(task.sections ?? [], 0, "the steps rule");
    expect(steps.heading).toBe("Steps");
    expect(steps.contains?.lists?.min).toBe(1);
    expect(at(task.sections ?? [], 1, "the caveats rule").min).toBe(1);
  });

  // A rule's own keys stay units: overriding `contains` replaces it rather
  // than merging a child `min` into a parent `max`.
  it("replaces a content rule rather than merging into it", async () => {
    expect(ruleById(await mergedChild(), "overview").contains).toEqual({
      paragraphs: { min: 2 },
    });
  });

  // Regression: Ajv `useDefaults` used to write counts into every rule at load
  // time, so a child that overrode one nested rule carried defaults that beat
  // the parent's real values. Loading through the schema is the whole point.
  it("inherits counts the child never states, after a real schema load", async () => {
    const child = await loadTemplate(join(fixtures, "inherit-unstated.yaml#child"));
    const merged = await resolveExtends(child, (ref) => loadTemplate(join(fixtures, ref)));
    const task = ruleById(merged, "task");

    expect(task.min).toBe(0);
    expect(task.max).toBe(3);
    expect(at(task.sections ?? [], 0, "the steps rule").contains?.lists?.min).toBe(2);
  });

  it("leaves the parent untouched", async () => {
    await mergedChild();
    const base = defined(library["base"], "the base template");
    expect(ruleById(base, "overview").heading).toBe("Overview");
    expect((base.sections ?? []).map((rule) => rule.id)).toEqual([
      "overview",
      "see-also",
      "task",
    ]);
    // Deep merge must copy, not mutate, the parent's nested branch.
    const task = ruleById(base, "task");
    expect(at(task.sections ?? [], 1, "the caveats rule").min).toBe(0);
  });

  it("resolves an `extends` that points into a file", async () => {
    const child = await loadTemplate(join(fixtures, "extends.yaml#child"));
    const merged = await resolveExtends(child, (ref) => loadTemplate(join(fixtures, ref)));

    expect(ruleById(merged, "overview").heading).toBe("Introduction");
    expect(ruleById(merged, "overview").contains?.paragraphs?.min).toBe(2);
    expect(ruleById(merged, "see-also").heading).toBe("See also");
    expect(merged.types).toEqual(["how-to"]);
    expect(merged.extends).toBeUndefined();
  });

  it("detects a cycle and names the chain", async () => {
    const cyclic: Record<string, Template> = {
      a: { extends: "b" },
      b: { extends: "a" },
    };

    const message = await rejectionMessage(
      resolveExtends(defined(cyclic["a"], 'template "a"'), resolverFor(cyclic)),
    );
    expect(message).toContain('Template "extends" cycle');
    expect(message).toContain("b -> a -> b");
  });

  it("detects a template that extends itself", async () => {
    const selfish: Record<string, Template> = { me: { extends: "me" } };
    const message = await rejectionMessage(
      resolveExtends(defined(selfish["me"], 'template "me"'), resolverFor(selfish)),
    );
    expect(message).toContain("me -> me");
  });
});

describe("the template schema", () => {
  const load = (data: unknown, source = "t.yaml") => validateTemplateFile(data, source);
  const one = (rule: Record<string, unknown>) => ({
    templates: { "how-to": { sections: [rule] } },
  });

  it("accepts a rule that says nothing at all", () => {
    const file = load(one({}));
    const rule = ruleAt(file.templates?.["how-to"], 0);
    expect(isWildcard(rule)).toBe(true);
    expect(occurrenceRange(rule)).toEqual({ min: 1, max: null });
  });

  it("accepts every form of `heading`", () => {
    const file = load({
      templates: {
        "how-to": {
          sections: [
            { id: "exact", heading: "Overview" },
            { id: "one-of", heading: ["Overview", "Introduction"] },
            { id: "regex", heading: { pattern: "^Step \\d+" } },
            { id: "none", heading: false },
          ],
        },
      },
    });
    const howTo = file.templates?.["how-to"];

    expect(headingMatches(ruleById(howTo, "exact").heading, "Overview")).toBe(true);
    expect(headingMatches(ruleById(howTo, "one-of").heading, "Introduction")).toBe(true);
    expect(headingMatches(ruleById(howTo, "one-of").heading, "Nope")).toBe(false);
    expect(headingMatches(ruleById(howTo, "regex").heading, "Step 2 of 3")).toBe(true);
    // `false` is not a wildcard: it states the section has no heading.
    const none = ruleById(howTo, "none");
    expect(none.heading).toBe(false);
    expect(isWildcard(none)).toBe(false);
    expect(headingMatches(none.heading, null)).toBe(true);
    expect(headingMatches(none.heading, "Overview")).toBe(false);
  });

  it("leaves `max` absent, meaning unbounded", () => {
    const file = load(one({ id: "task", min: 1 }));
    const rule = ruleAt(file.templates?.["how-to"], 0);
    expect(rule.max).toBeUndefined();
    expect(occurrenceRange(rule)).toEqual({ min: 1, max: null });
    // `max: 0` is how the format forbids a thing, so it must survive as 0.
    const forbidden = load(one({ contains: { codeBlocks: { max: 0 } } }));
    expect(
      ruleAt(forbidden.templates?.["how-to"], 0).contains?.codeBlocks?.max,
    ).toBe(0);
  });

  it("accepts `repeat` as a list of rules", () => {
    const file = load(
      one({
        id: "symptoms",
        min: 1,
        repeat: [{ heading: { pattern: "^Symptom" } }, { heading: "Fix" }],
      }),
    );
    expect(ruleAt(file.templates?.["how-to"], 0).repeat).toHaveLength(2);
  });

  it("accepts `title`, `types` and `extends` on a template", () => {
    const file = load({
      templates: {
        "how-to": {
          title: "How-to",
          types: ["how-to", "howto"],
          extends: "tgdp:how-to:1",
        },
      },
    });
    expect(file.templates?.["how-to"]?.types).toEqual(["how-to", "howto"]);
    expect(file.templates?.["how-to"]?.title).toBe("How-to");
    expect(file.templates?.["how-to"]?.extends).toBe("tgdp:how-to:1");
  });

  it("accepts `$schema`, and never reads it", () => {
    const file = load({
      $schema: "https://example.com/template.json",
      templates: { "how-to": {} },
    });
    expect(file.$schema).toBe("https://example.com/template.json");
  });

  it("rejects an unknown key at the top level", () => {
    const message = thrownMessage(() =>
      load({ templates: {}, "doc-structure-lint": "0.0.1" }, "legacy.yaml"),
    );
    expect(message).toContain("legacy.yaml");
    expect(message).toContain("doc-structure-lint");
  });

  it("requires a `templates` key", () => {
    const message = thrownMessage(() => load({ info: {} }, "empty.yaml"));
    expect(message).toContain("must have required property 'templates'");
  });

  it("rejects a template name that does not start with a letter", () => {
    const message = thrownMessage(() => load({ templates: { "1st": {} } }));
    expect(message).toContain("/templates");
    expect(message).toContain("1st");
  });

  it("rejects a heading object key that is not `pattern`", () => {
    const message = thrownMessage(() => load(one({ heading: { const: "Overview" } })));
    expect(message).toContain("/templates/how-to/sections/0/heading");
  });

  it("rejects a content kind the model does not have", () => {
    const message = thrownMessage(() => load(one({ contains: { footnotes: {} } })));
    expect(message).toContain("/templates/how-to/sections/0/contains");
    expect(message).toContain("footnotes");
  });

  it("rejects a sequence entry that names two content kinds", () => {
    const message = thrownMessage(() =>
      load(one({ sequence: [{ paragraphs: { min: 1 }, codeBlocks: {} }] })),
    );
    expect(message).toContain("/templates/how-to/sections/0/sequence/0");
  });

  // The message, not just the path. Ajv renders a `not` as "must NOT be
  // valid", which names where the problem is and nothing about what it is.
  it("rejects a rule that sets both `sequence` and `contains`", () => {
    const message = thrownMessage(() =>
      load(one({ sequence: [{ paragraphs: { min: 1 } }], contains: { lists: {} } })),
    );
    expect(message).toContain("/templates/how-to/sections/0");
    expect(message).toContain("sets both sequence and contains");
    expect(message).not.toContain("must NOT be valid");
  });

  it("says what is wrong with a rule that sets both `heading` and `repeat`", () => {
    const message = thrownMessage(() =>
      load(one({ heading: "Symptoms", repeat: [{ heading: "Symptom" }] })),
    );
    expect(message).toContain("a repeat group has no heading of its own");
    expect(message).not.toContain("must NOT be valid");
  });

  // The same exclusivity, one level down. `elements` and `listItems` take a
  // body of their own, so if the schema let both through, one would be checked
  // and the other dropped in silence. It does not, and this is what says so.
  it("rejects an `elements` rule that sets both `sequence` and `contains`", () => {
    const message = thrownMessage(() =>
      load(
        one({
          contains: {
            elements: {
              tag: "Steps",
              sequence: [{ paragraphs: {} }],
              contains: { lists: {} },
            },
          },
        }),
      ),
    );
    expect(message).toContain("/templates/how-to/sections/0/contains/elements");
    expect(message).toContain("sets both sequence and contains");
  });

  it("rejects a `listItems` rule that sets both `sequence` and `contains`", () => {
    const message = thrownMessage(() =>
      load(
        one({
          contains: {
            lists: { items: { sequence: [{ paragraphs: {} }], contains: { lists: {} } } },
          },
        }),
      ),
    );
    expect(message).toContain("/templates/how-to/sections/0/contains/lists/items");
    expect(message).toContain("sets both sequence and contains");
  });

  it("rejects a rule that sets both `heading` and `repeat`", () => {
    const message = thrownMessage(() =>
      load(one({ heading: "Symptoms", repeat: [{ heading: "Symptom" }] })),
    );
    expect(message).toContain("/templates/how-to/sections/0");
  });

  it("rejects an admonition variant nobody models", () => {
    const message = thrownMessage(() =>
      load(one({ contains: { admonitions: { variant: "aside" } } })),
    );
    expect(message).toContain("variant");
  });

  it("rejects a negative count", () => {
    const message = thrownMessage(() => load(one({ min: -1 })));
    expect(message).toContain("/templates/how-to/sections/0/min");
  });

  it("rejects a top-level value that is not an object", () => {
    const message = thrownMessage(() => load("nope", "scalar.yaml"));
    expect(message).toContain("scalar.yaml");
    expect(message).toContain("must be object");
  });

  it("declares no `default` anywhere", async () => {
    const schema: unknown = (
      await import("../../../schemas/lint/template.json", { with: { type: "json" } })
    ).default;
    expect(JSON.stringify(schema)).not.toContain('"default"');
  });
});

/**
 * What the schema cannot say. Three of these compare two siblings, which
 * draft-07 has no keyword for; one compiles a regular expression, which it has
 * no opinion about; and one is a warning, because the template is legal and
 * only its author can say whether the ambiguity is intended.
 */
describe("the checks the schema cannot make", () => {
  const one = (rule: Record<string, unknown>) => ({
    templates: { "how-to": { sections: [rule] } },
  });

  it("refuses a `max` below the `min` beside it, naming the rule by id", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(one({ id: "task", min: 2, max: 1 }), "t.yaml"),
    );
    expect(message).toBe('t.yaml: rule "task" sets max 1 below min 2.');
  });

  it("names a rule with no id by its path", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(one({ min: 3, max: 2 }), "t.yaml"),
    );
    expect(message).toBe(
      "t.yaml: rule templates.how-to.sections[0] sets max 2 below min 3.",
    );
  });

  it("refuses a `max` below `min` inside a block rule too", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(one({ contains: { lists: { min: 2, max: 1 } } }), "t.yaml"),
    );
    expect(message).toBe(
      "t.yaml: rule templates.how-to.sections[0].contains.lists sets max 1 below min 2.",
    );
  });

  it("refuses two siblings that share an id", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(
        {
          templates: {
            "how-to": {
              sections: [
                { id: "task", heading: "Install" },
                { id: "task", heading: "Configure" },
              ],
            },
          },
        },
        "t.yaml",
      ),
    );
    expect(message).toBe('t.yaml: two sibling rules share the id "task".');
  });

  it("allows the same id under two different parents", () => {
    const file = validateTemplateFile(
      {
        templates: {
          "how-to": {
            sections: [
              { id: "a", heading: "Install", sections: [{ id: "steps" }] },
              { id: "b", heading: "Configure", sections: [{ id: "steps" }] },
            ],
          },
        },
      },
      "t.yaml",
    );
    expect(file.templates?.["how-to"]?.sections).toHaveLength(2);
  });

  it("refuses `min` or `max` on a template", () => {
    const expected = "t.yaml: a template may not set min or max; a page is one page.";
    expect(
      thrownMessage(() => validateTemplateFile({ templates: { a: { min: 2 } } }, "t.yaml")),
    ).toBe(expected);
    expect(
      thrownMessage(() => validateTemplateFile({ templates: { a: { max: 1 } } }, "t.yaml")),
    ).toBe(expected);
  });

  it("names a broken heading pattern, and the file it is in", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(one({ heading: { pattern: "Step (" } }), "t.yaml"),
    );
    expect(message).toContain('Invalid pattern "Step (" in t.yaml:');
    expect(message).toMatch(/\.$/);
  });

  it("names a broken paragraph pattern too", () => {
    const message = thrownMessage(() =>
      validateTemplateFile(one({ contains: { paragraphs: { pattern: "(" } } }), "t.yaml"),
    );
    expect(message).toContain('Invalid pattern "(" in t.yaml:');
  });

  it("warns, rather than failing, on two adjacent rules nothing tells apart", () => {
    const stderr = captureStderr();
    try {
      validateTemplateFile(
        { templates: { "how-to": { sections: [{ id: "a" }, { id: "b" }] } } },
        "t.yaml",
      );
    } finally {
      stderr.restore();
    }
    expect(stderr.text()).toContain(
      "t.yaml: two adjacent rules have no heading and no repeat; only rule order tells them apart.",
    );
  });

  it("says nothing when the neighbours are told apart", () => {
    const stderr = captureStderr();
    try {
      validateTemplateFile(
        {
          templates: {
            "how-to": {
              sections: [
                { id: "a", heading: "Setup" },
                { id: "b" },
                // A `repeat` group is told apart by what it repeats.
                { id: "c", repeat: [{ heading: "Symptom" }] },
              ],
            },
          },
        },
        "t.yaml",
      );
    } finally {
      stderr.restore();
    }
    expect(stderr.text()).toBe("");
  });

  it("warns when two wildcards claim the same occurrence range", () => {
    const stderr = captureStderr();
    try {
      validateTemplateFile(
        {
          templates: {
            "how-to": {
              sections: [
                { id: "a", max: 1 },
                { id: "b", max: 1 },
              ],
            },
          },
        },
        "t.yaml",
      );
    } finally {
      stderr.restore();
    }
    expect(stderr.text()).toContain(
      "t.yaml: two adjacent rules have no heading and no repeat; only rule order tells them apart.",
    );
  });

  it("says nothing when two wildcards claim different occurrence ranges", () => {
    // `reference-description` (exactly once) next to `structured-entry` (any
    // number, no upper bound) - tgdp:reference's actual pair. The ranges
    // differ, so the matcher can tell the rules apart without a heading.
    const stderr = captureStderr();
    try {
      validateTemplateFile(
        {
          templates: {
            "how-to": {
              sections: [
                { id: "reference-description", max: 1 },
                { id: "structured-entry", min: 0 },
              ],
            },
          },
        },
        "t.yaml",
      );
    } finally {
      stderr.restore();
    }
    expect(stderr.text()).toBe("");
  });
});

/**
 * v1 never shipped, so there is no compatibility path and no alias. What there
 * is instead is a sentence per key naming the v2 spelling, because a v1 file is
 * what anyone who tried the format early still has on disk. This is the message
 * such a person actually meets, so it is pinned word for word.
 */
describe("refusing a v1 file", () => {
  const rule = (extra: Record<string, unknown>) => ({
    templates: { "how-to": { sections: [{ id: "task", ...extra }] } },
  });

  it("refuses a whole v1 file from disk", async () => {
    const source = join(fixtures, "v1-file.yaml");
    const message = await rejectionMessage(loadTemplateFile(source));
    expect(message).toBe(
      `${source}: "additionalSections" is not a template key. v2 has no equivalent, so drop it.`,
    );
  });

  it("refuses `sections` written as a map", () => {
    expect(
      thrownMessage(() =>
        validateTemplateFile(
          { templates: { "how-to": { sections: { overview: {} } } } },
          "t.yaml",
        ),
      ),
    ).toBe(
      't.yaml: "sections" is a list of rules, not a map. Name each rule with "id" and list them in order.',
    );
  });

  it("refuses `required`", () => {
    expect(thrownMessage(() => validateTemplateFile(rule({ required: false }), "t.yaml"))).toBe(
      't.yaml: "required" is not a template key. A rule is optional with "min: 0".',
    );
  });

  it("refuses `repeat` written as a boolean", () => {
    expect(thrownMessage(() => validateTemplateFile(rule({ repeat: true }), "t.yaml"))).toBe(
      't.yaml: "repeat" is a list of rules, not a boolean. A rule repeats through "min" and "max".',
    );
  });

  it("refuses `additionalSections`", () => {
    expect(
      thrownMessage(() => validateTemplateFile(rule({ additionalSections: true }), "t.yaml")),
    ).toBe(
      't.yaml: "additionalSections" is not a template key. v2 has no equivalent, so drop it.',
    );
  });

  it("refuses `code_blocks`, naming the v2 spelling", () => {
    expect(
      thrownMessage(() => validateTemplateFile(rule({ code_blocks: { min: 1 } }), "t.yaml")),
    ).toBe('t.yaml: "code_blocks" is not a template key. The v2 spelling is "codeBlocks".');
  });

  it("refuses `paragraphs.patterns`, naming the v2 spelling", () => {
    expect(
      thrownMessage(() =>
        validateTemplateFile(rule({ paragraphs: { patterns: ["^Do"] } }), "t.yaml"),
      ),
    ).toBe(
      't.yaml: "patterns" is not a paragraphs key. The v2 spelling is "pattern", one regular expression.',
    );
  });

  // The keys are v1's, but the names inside a rule list are the author's. A
  // rule called `required` is a rule, not the v1 key.
  it("does not mistake a rule id for a v1 key", () => {
    const file = validateTemplateFile(
      { templates: { "how-to": { sections: [{ id: "required", heading: "Required" }] } } },
      "t.yaml",
    );
    expect(ruleById(file.templates?.["how-to"], "required").heading).toBe("Required");
  });

  it("leaves `info` alone, because it is free-form by contract", () => {
    const file = validateTemplateFile(
      { info: { required: true, sections: { a: 1 } }, templates: { "how-to": {} } },
      "t.yaml",
    );
    expect(file.info?.["required"]).toBe(true);
  });
});

/**
 * Two failures a template author meets on disk, each of which used to describe
 * itself as something else. Both need real files, so they share one temporary
 * directory rather than a fixture: a directory standing in for a file cannot be
 * committed, and a cycle wants two files that name each other by path.
 */
describe("what a template ref does on a real filesystem", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-lint-registry-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Every failed read was reported as "not found", which contradicts `ls -la`
  // and sends the reader after a path that is plainly there. A permission
  // denial, a directory named like a template, and a process out of file
  // handles are three different problems with three different fixes.
  it("reports a read that failed for any other reason with the OS message", async () => {
    const asDirectory = join(dir, "adirectory.yaml");
    await mkdir(asDirectory, { recursive: true });

    const message = await rejectionMessage(loadTemplateFile(asDirectory));
    expect(message).toContain(asDirectory);
    expect(message).toContain("could not be read");
    expect(message).toContain("EISDIR");
    expect(message).not.toContain("not found");
  });

  it("still reports a ref that names nothing as not found", async () => {
    const message = await rejectionMessage(
      loadTemplateFile(join(dir, "absent.yaml")),
    );
    expect(message).toContain("Template file not found");
  });

  // The chain was seeded with the *parent*, so `a -> b -> a` was reported as
  // `b -> a -> b`: the file the author pointed the tool at never appeared in
  // the cycle it was said to be part of.
  it("names a cycle from the template the run started at", async () => {
    const a = join(dir, "cycle-a.yaml");
    const b = join(dir, "cycle-b.yaml");
    await writeFile(
      a,
      ["templates:", "  a:", "    extends: ./cycle-b.yaml#b", ""].join("\n"),
    );
    await writeFile(
      b,
      ["templates:", "  b:", "    extends: ./cycle-a.yaml#a", ""].join("\n"),
    );

    const message = await rejectionMessage(loadResolvedTemplate(`${a}#a`));
    expect(message).toContain('Template "extends" cycle');

    const chain = defined(
      /cycle: (.+)\.$/.exec(message),
      "the reported cycle chain",
    )[1];
    const steps = defined(chain, "the chain text").split(" -> ");
    expect(steps).toHaveLength(3);
    // A cycle starts and ends at the same place, and that place is where the
    // reader started.
    expect(at(steps, 0, "first step")).toBe(`${a}#a`);
    expect(at(steps, 2, "last step")).toBe(`${a}#a`);
    expect(at(steps, 1, "second step")).toBe(`${b}#b`);
  });
});
