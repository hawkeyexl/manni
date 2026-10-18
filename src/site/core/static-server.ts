/**
 * The built-in static server `manni site preview` uses for frameworks whose
 * own CLI has no preview (MkDocs, Zensical, Sphinx, Hugo, Jekyll). It serves a
 * build output directory, mounted at the collection `url:` path, until the
 * process is stopped. `node:http` and `node:fs` only.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, relative, resolve, sep } from "node:path";
import { errorMessage } from "../../shared/errors.js";
import { SiteError } from "../errors.js";

export interface StaticOptions {
  root: string;
  host: string;
  port: number;
  /** The URL path the root is mounted at, e.g. `/manni/`. */
  base: string;
}

// ponytail: the types a static docs build ships. Anything else goes out as
// application/octet-stream; add a row when a site needs one.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};

/** `/manni/` from `manni`, `/manni` or `/manni/`; `/` from `/` or empty. */
function normalizeBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

async function kindOf(path: string): Promise<"file" | "dir" | undefined> {
  try {
    const s = await stat(path);
    if (s.isDirectory()) return "dir";
    return s.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}

function sendFile(req: IncomingMessage, res: ServerResponse, path: string, status = 200): void {
  res.writeHead(status, {
    "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path)
    .on("error", () => res.destroy())
    .pipe(res);
}

function redirect(res: ServerResponse, status: 301 | 302, location: string): void {
  res.writeHead(status, { location });
  res.end();
}

/**
 * The file inside `root` a URL path below the base names, or undefined when it
 * names nothing inside it. The URL parser has already collapsed `..` and
 * `%2e%2e` segments; what it leaves are encoded separators (`..%2f`, `..%5c`),
 * so the decoded path is checked for `..` segments and then for containment.
 * Both layers are needed: the parser normalises before it decodes, so a `..`
 * hidden behind an encoded separator only appears after this decode.
 */
function inside(root: string, rest: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.split(/[\\/]/).includes("..")) return undefined;
  const path = resolve(root, `.${sep}${decoded}`);
  return path === root || path.startsWith(root + sep) ? path : undefined;
}

function handler(root: string, base: string) {
  const notFound = join(root, "404.html");
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    if (base !== "/" && (pathname === "/" || pathname === base.slice(0, -1))) {
      redirect(res, pathname === "/" ? 302 : 301, `${base}${url.search}`);
      return;
    }
    const path = pathname.startsWith(base) ? inside(root, pathname.slice(base.length)) : undefined;
    const kind = path === undefined ? undefined : await kindOf(path);
    if (path !== undefined && kind === "dir" && !pathname.endsWith("/")) {
      redirect(res, 301, `${pathname}/${url.search}`);
      return;
    }
    const file = path !== undefined && kind === "dir" ? join(path, "index.html") : path;
    if (file !== undefined && (await kindOf(file)) === "file") {
      sendFile(req, res, file);
    } else if ((await kindOf(notFound)) === "file") {
      sendFile(req, res, notFound, 404);
    } else {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
    }
  };
}

function urlOf(host: string, port: number, base: string): string {
  const shown = host.includes(":") ? `[${host}]` : host;
  return `http://${shown}:${String(port)}${base}`;
}

/**
 * Serve `root` at `base` on `host:port` and print the URL to stdout once
 * listening. Resolves with the listening server; the caller closes it.
 */
export async function startStaticServer(opts: StaticOptions): Promise<Server> {
  const root = resolve(opts.root);
  if ((await kindOf(root)) !== "dir") {
    const shown = relative(process.cwd(), root).split(sep).join("/") || ".";
    throw new SiteError(`${shown}/ does not exist.`);
  }
  const base = normalizeBase(opts.base);
  const handle = handler(root, base);
  const server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((settle, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new SiteError(
          err.code === "EADDRINUSE"
            ? `port ${String(opts.port)} is in use. Pass --port, or stop the process holding it.`
            : `cannot listen on ${urlOf(opts.host, opts.port, "")}: ${errorMessage(err)}`,
        ),
      );
    });
    server.listen(opts.port, opts.host, settle);
  });
  const { port } = server.address() as AddressInfo;
  process.stdout.write(`${urlOf(opts.host, port, base)}\n`);
  return server;
}

/** Serve until SIGINT or SIGTERM, then close the server and resolve. */
export async function serveStatic(opts: StaticOptions): Promise<void> {
  const server = await startStaticServer(opts);
  await new Promise<void>((settle) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      server.close(() => {
        settle();
      });
      server.closeAllConnections();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
