import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsError } from "../../src/docs/errors.js";
import { startStaticServer } from "../../src/docs/core/static-server.js";

const root = fileURLToPath(new URL("../fixtures/docs/static-site/", import.meta.url));

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw GET: `fetch` would normalize `..` out of the path before sending it. */
function request(port: number, path: string): Promise<Reply> {
  return new Promise((settle, reject) => {
    get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        settle({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    }).on("error", reject);
  });
}

const open: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    open.splice(0).map(
      (s) =>
        new Promise<void>((done) => {
          s.close(() => {
            done();
          });
        }),
    ),
  );
});

async function serve(base: string): Promise<{ port: number; printed: string }> {
  let printed = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    printed += String(chunk);
    return true;
  });
  const server = await startStaticServer({ root, host: "127.0.0.1", port: 0, base });
  vi.restoreAllMocks();
  open.push(server);
  return { port: (server.address() as AddressInfo).port, printed };
}

describe("the built-in static server", () => {
  it("prints its URL, with the base, once listening", async () => {
    const { port, printed } = await serve("/manni/");
    expect(printed).toBe(`http://127.0.0.1:${port}/manni/\n`);
  });

  it("serves index.html for the base and for a directory", async () => {
    const { port } = await serve("/manni/");
    const home = await request(port, "/manni/");
    expect(home.status).toBe(200);
    expect(home.headers["content-type"]).toMatch(/^text\/html/);
    expect(home.body).toContain("home page");
    expect((await request(port, "/manni/guide/")).body).toContain("guide page");
  });

  it("serves a file with its MIME type", async () => {
    const { port } = await serve("/manni/");
    const css = await request(port, "/manni/style.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
  });

  it("redirects a directory without its slash, and / to the base", async () => {
    const { port } = await serve("/manni/");
    const dir = await request(port, "/manni/guide");
    expect(dir.status).toBe(301);
    expect(dir.headers.location).toBe("/manni/guide/");
    const bare = await request(port, "/manni");
    expect(bare.status).toBe(301);
    expect(bare.headers.location).toBe("/manni/");
    const top = await request(port, "/");
    expect(top.status).toBe(302);
    expect(top.headers.location).toBe("/manni/");
  });

  it("answers outside the base, and a missing page, with 404.html", async () => {
    const { port } = await serve("/manni/");
    for (const path of ["/elsewhere/index.html", "/manni/missing/"]) {
      const res = await request(port, path);
      expect(res.status).toBe(404);
      expect(res.body).toContain("custom 404");
    }
  });

  it("mounts at / when the base is /", async () => {
    const { port, printed } = await serve("/");
    expect(printed).toBe(`http://127.0.0.1:${port}/\n`);
    expect((await request(port, "/")).body).toContain("home page");
  });

  it("never serves a file outside the root", async () => {
    const { port } = await serve("/");
    // Four levels up from the fixture is the repo root, whose package.json
    // names the package.
    for (const path of [
      "/../../../../package.json",
      "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/package.json",
      "/..%2f..%2f..%2f..%2fpackage.json",
      "/..%5c..%5c..%5c..%5cpackage.json",
      "/guide/%2E%2E%2F%2E%2E%2F%2E%2E%2F%2E%2E%2F..%2fpackage.json",
    ]) {
      const res = await request(port, path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.body, path).not.toContain("@hawkeyexl/manni");
    }
  });

  it("names the port when it is taken", async () => {
    const holder = createServer();
    open.push(holder);
    await new Promise<void>((done) => holder.listen(0, "127.0.0.1", done));
    const port = (holder.address() as AddressInfo).port;
    const started = startStaticServer({ root, host: "127.0.0.1", port, base: "/" });
    await expect(started).rejects.toThrow(DocsError);
    await expect(started).rejects.toThrow(
      `port ${String(port)} is in use. Pass --port, or stop the process holding it.`,
    );
  });

  it("names a root that does not exist", async () => {
    await expect(
      startStaticServer({ root: "no-such-dir", host: "127.0.0.1", port: 0, base: "/" }),
    ).rejects.toThrow("no-such-dir/ does not exist.");
  });
});
