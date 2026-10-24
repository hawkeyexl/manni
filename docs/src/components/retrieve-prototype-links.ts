/** Resolve graph source paths to this docs site's published pages. */
export function playgroundSourceUrl(
  sourceUrl: string,
  iri: string,
  baseUrl: string,
  locationHref: string,
): string | undefined {
  try {
    const prefix = "docs/src/content/docs/";
    let target = sourceUrl;
    if (sourceUrl.startsWith(prefix)) {
      const path = sourceUrl.slice(prefix.length).split(/[?#]/)[0];
      if (!path || path.split("/").some((segment) => segment === ".." || segment === ".")) return undefined;
      const route = path.replace(/(?:^|\/)index\.mdx?$/, "").replace(/\.mdx?$/, "");
      const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`, locationHref);
      const resolved = new URL(route === "" ? "./" : `${route.replace(/\/$/, "")}/`, base);
      if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) return undefined;
      const source = new URL(sourceUrl, locationHref);
      resolved.search = source.search;
      let fragment = "";
      try { fragment = new URL(iri).hash; } catch { /* An opaque node id has no section anchor. */ }
      resolved.hash = source.hash || fragment;
      target = resolved.href;
    }
    const url = new URL(target, locationHref);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
