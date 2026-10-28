/**
 * A MadCap Flare topic as its target builds it (proposal 0125, decisions 11,
 * 12, 14 and 15): the tree `parseHtml` builds a Flare topic's sections from.
 *
 * The topic is parsed afresh and resolved in place. Snippet references become
 * the snippet's content, variables become their values, and elements whose
 * condition tags the target excludes leave. Links are not read here: they are
 * what the file says, under every condition, so `parseHtml` collects them from
 * the unresolved parse.
 *
 * A block a snippet brought in reports at the snippet reference's position in
 * the including file, nested snippets included. A snippet parsed on its own
 * reports at its own lines, so a fault in one is found and fixed once.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { defaultTreeAdapter } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import {
  type ConditionExpression,
  type FlareProject,
  type FlareRun,
  includes,
  lookupVariable,
  parseConditionExpression,
  parseConditionTags,
  resolveText,
  resolveVariable,
  VARIABLE_REFERENCE,
} from "../../shared/flare/index.js";
import { parseXhtml } from "../../shared/xhtml.js";
import type { DocumentTree } from "../types.js";

type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export interface FlareView {
  /** The resolved tree. */
  doc: Document;
  /** The project and target it resolved against; absent with no project. */
  flare?: NonNullable<DocumentTree["flare"]>;
}

/** What one stretch of content resolves under: the topic's own, or a snippet's. */
interface Scope {
  /** The file the content is from, absolute: the topic, or a snippet. */
  file: string;
  /** The snippets open around the content, absolute, outermost first. */
  chain: string[];
  /** Snippet condition expressions that filter the content beside the target's. */
  filters: ConditionExpression[];
  /** The topic root's snippet expression, for a reference that carries none. */
  snippetDefault?: ConditionExpression;
  /** Values that win over the set: the target's, then each open snippet's. */
  overrides: Map<string, string>;
}

/** What every scope of one topic shares. */
interface Topic {
  label: string;
  absPath: string;
  run: FlareRun;
  /** Undefined with no project, which leaves variables and conditions as written. */
  project: FlareProject | undefined;
  title: string | undefined;
}

/** parse5 lowercases the prefixed names Flare writes. */
const SNIPPETS = new Set(["madcap:snippetblock", "madcap:snippettext"]);

/** Index markers: empty elements that add no text. `MadCap:glossaryTerm` wraps text, so it is not one. */
const MARKERS = new Set(["madcap:keyword", "madcap:concept"]);

/** The blocks a text snippet's body is unwrapped from, so only inline content lands in a line. */
const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6"]);

function attrOf(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function childElement(parent: ParentNode, tag: string): Element | undefined {
  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isElementNode(child) && child.tagName === tag) return child;
  }
  return undefined;
}

function expressionOf(text: string | undefined): ConditionExpression | undefined {
  return text === undefined || text.trim() === "" ? undefined : parseConditionExpression(text);
}

/** `Set.Name:value,` pairs, a trailing comma allowed. A value runs to the next comma. */
// ponytail: a value holding a comma splits; read Flare's escaping if a project writes one.
function snippetVariables(attr: string | undefined): [string, string][] {
  if (attr === undefined) return [];
  return attr.split(",").flatMap((pair) => {
    const colon = pair.indexOf(":");
    const name = pair.slice(0, colon).trim();
    return colon < 0 || name === "" ? [] : [[name, pair.slice(colon + 1)] as [string, string]];
  });
}

/**
 * Resolve a Flare topic. `title` is its `System.Title`, the page title meta
 * reads. With no project above the topic the run says so once, and snippets
 * still expand, relative to the files that name them.
 */
export function resolveFlare(
  content: string,
  label: string,
  absPath: string,
  run: FlareRun,
  title: string | undefined,
): FlareView {
  const doc = parseXhtml(content);
  const project = run.projectFor(absPath);
  if (project === undefined) run.noProjectNotice(label);
  const target = project?.target;
  const flare: FlareView["flare"] =
    project === undefined
      ? undefined
      : {
          project: project.flprj,
          ...(target === undefined
            ? {}
            : { target: { name: target.name, from: project.targetFrom ?? "the only target" } }),
        };

  // The root's own conditions decide whether the target builds the topic at
  // all, and its expression is the default for every snippet reference in it.
  const root = childElement(doc, "html");
  const rootAttr = (name: string): string | undefined =>
    root === undefined ? undefined : attrOf(root, name);
  if (flare !== undefined && !includes(target?.expression, parseConditionTags(rootAttr("madcap:conditions")))) {
    return { doc, flare: { ...flare, excluded: true } };
  }
  const snippetDefault =
    project === undefined ? undefined : expressionOf(rootAttr("madcap:conditiontagexpression"));
  resolveIn(
    doc,
    {
      file: absPath,
      chain: [],
      filters: [],
      ...(snippetDefault === undefined ? {} : { snippetDefault }),
      overrides: new Map(target?.variables ?? []),
    },
    { label, absPath, run, project, title },
  );
  return { doc, ...(flare === undefined ? {} : { flare }) };
}

/**
 * A link target as the build names it (decision 12): each `[%=Set.Name%]` in
 * it resolves through the project's variables, the target's overrides
 * winning. A reference left over, to a variable no set defines or a date, or
 * on a page with no project, names no file, so the target is undefined and is
 * not a link.
 */
export function flareLinkTarget(href: string, project: FlareProject | undefined): string | undefined {
  if (!href.includes("[%=")) return href;
  const resolved = project === undefined ? href : resolveText(project.variables, href, project.target?.variables);
  return resolved.includes("[%=") ? undefined : resolved;
}

/** Whether an element's condition tags stay under the target and every snippet filter. */
function kept(el: Element, scope: Scope, project: FlareProject): boolean {
  const tags = parseConditionTags(attrOf(el, "madcap:conditions"));
  if (tags.length === 0) return true;
  return includes(project.target?.expression, tags) && scope.filters.every((f) => includes(f, tags));
}

/**
 * A variable's value, or undefined to keep the reference. `System.Title` and
 * `System.SourceFile` are the topic's, and every other `System.*` is a build's.
 * A date and time variable keeps its reference silently, and a name no set
 * defines warns once.
 */
function valueOf(name: string, scope: Scope, topic: Topic, project: FlareProject): string | undefined {
  if (name === "System.Title") return topic.title;
  if (name === "System.SourceFile") return basename(topic.absPath);
  const value = resolveVariable(project.variables, name, scope.overrides);
  if (value !== undefined) return value;
  if (!name.startsWith("System.") && lookupVariable(project.variables, name) === undefined) {
    topic.run.warnUndefinedVariable(topic.label, name, project);
  }
  return undefined;
}

function resolveIn(parent: ParentNode, scope: Scope, topic: Topic): void {
  const { project } = topic;
  for (const child of [...parent.childNodes]) {
    if (defaultTreeAdapter.isTextNode(child)) {
      if (project !== undefined && child.value.includes("[%=")) {
        child.value = child.value.replace(
          VARIABLE_REFERENCE,
          (reference, raw: string) => valueOf(raw.trim(), scope, topic, project) ?? reference,
        );
      }
      continue;
    }
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const tag = child.tagName;
    if ((project !== undefined && !kept(child, scope, project)) || MARKERS.has(tag)) {
      defaultTreeAdapter.detachNode(child);
      continue;
    }
    if (tag === "madcap:variable" && project !== undefined) {
      const name = (attrOf(child, "name") ?? "").trim();
      const value = valueOf(name, scope, topic, project) ?? `[%=${name}%]`;
      defaultTreeAdapter.insertTextBefore(parent, value, child);
      defaultTreeAdapter.detachNode(child);
      continue;
    }
    const src = SNIPPETS.has(tag) ? attrOf(child, "src") : undefined;
    if (src !== undefined) {
      expand(parent, child, src, scope, topic);
      continue;
    }
    resolveIn(child, scope, topic);
  }
}

/** Give every node under `parent` the reference's location (decision 14). */
function stamp(parent: ParentNode, location: Element["sourceCodeLocation"]): void {
  for (const child of parent.childNodes) {
    child.sourceCodeLocation = location;
    if ("childNodes" in child) stamp(child, location);
  }
}

/**
 * Replace a snippet reference with the snippet's body, resolved under the
 * reference's own condition expression and variable overrides. A snippet that
 * cannot be read stays a reference, since graph reports it as a broken link.
 * A snippet already open is a cycle: it warns once and is not expanded again.
 */
function expand(parent: ParentNode, ref: Element, src: string, scope: Scope, topic: Topic): void {
  const abs = resolve(dirname(scope.file), src);
  if (scope.chain.includes(abs)) {
    const base = topic.project?.root ?? dirname(topic.absPath);
    const show = (file: string): string => relative(base, file).replace(/\\/g, "/");
    topic.run.warnSnippetCycle(topic.label, show(abs), [...scope.chain, abs].map(show));
    return;
  }
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const html = childElement(parseXhtml(text), "html");
  const body = html === undefined ? undefined : childElement(html, "body");
  if (body === undefined) return;
  stamp(body, ref.sourceCodeLocation);

  const expression =
    topic.project === undefined
      ? undefined
      : (expressionOf(attrOf(ref, "madcap:conditiontagexpression")) ?? scope.snippetDefault);
  resolveIn(
    body,
    {
      file: abs,
      chain: [...scope.chain, abs],
      filters: expression === undefined ? scope.filters : [...scope.filters, expression],
      overrides: new Map([...scope.overrides, ...snippetVariables(attrOf(ref, "madcap:snippetvariables"))]),
      // The topic root's expression is every reference's fallback, nested
      // ones included, so it travels with the scope.
      ...(scope.snippetDefault === undefined ? {} : { snippetDefault: scope.snippetDefault }),
    },
    topic,
  );

  // A text snippet sits inside a line, so its blocks are unwrapped to their
  // inline content and the whitespace between them is dropped. The simple
  // reading: one level, which is what a one-paragraph text snippet holds.
  const nodes: ChildNode[] =
    ref.tagName === "madcap:snippettext"
      ? body.childNodes.flatMap((n) =>
          defaultTreeAdapter.isElementNode(n) && BLOCKS.has(n.tagName)
            ? [...n.childNodes]
            : defaultTreeAdapter.isTextNode(n) && n.value.trim() === ""
              ? []
              : [n],
        )
      : [...body.childNodes];
  for (const node of nodes) {
    defaultTreeAdapter.detachNode(node);
    defaultTreeAdapter.insertBefore(parent, node, ref);
  }
  defaultTreeAdapter.detachNode(ref);
}
