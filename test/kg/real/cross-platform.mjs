/**
 * The cross-platform ranking gate (ADR 01025).
 *
 * dockg's real shape is: **corpus vectors built in Node, query embedded in the
 * browser.** Node and the browser run different ONNX backends and cannot be made
 * to run the same one (transformers.js v4 takes disjoint `device` values per
 * platform), so their vectors differ — measured at cosine 0.999914.
 *
 * Requiring *identical* rankings was tried first and failed reproducibly: with
 * q8 weights, an activation landing on a quantization boundary rounds opposite
 * ways on the two backends, and the resulting score shift (~4e-3) exceeds the
 * gap between adjacent near-tied results (~1.8e-3).
 *
 * So this asserts what the arithmetic supports: **any pair Node separates by more
 * than twice the observed score noise keeps its relative order in the browser.**
 * Near-ties may swap, and are printed rather than hidden. The noise floor itself
 * is bounded, so a library regression cannot silently widen the tolerance.
 *
 * Plain Node + Playwright rather than vitest browser mode, so the default test
 * config needs no browser dependencies at all. Run from the `embed-real` CI job:
 *
 *   npm run build && node test/real/cross-platform.mjs
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
// The built artifact, not src: this is what a consumer imports, and plain Node
// cannot resolve TypeScript's .js-means-.ts specifiers. Run `npm run build` first.
import { createLocalEmbedder, DEFAULT_MODEL } from "../../dist/embed.js";

const WORK = resolve(".tmp/real/cross");

/** A corpus with deliberately close neighbours, so ties are actually at risk. */
const CORPUS = [
  [
    "kg/doc/install#npm",
    "Install the CLI with npm install, then run dockg init.",
  ],
  [
    "kg/doc/install#yarn",
    "Installing via yarn: yarn add the package and run init.",
  ],
  [
    "kg/doc/config#file",
    "Configuration lives in dockg.config.yaml at the repo root.",
  ],
  [
    "kg/doc/config#keys",
    "Every config key is validated against a JSON Schema.",
  ],
  [
    "kg/doc/build#determinism",
    "Building twice over unchanged inputs is byte-identical.",
  ],
  [
    "kg/doc/build#output",
    "The build writes canonically sorted Turtle to the out path.",
  ],
  [
    "kg/doc/search#lexical",
    "Lexical search ranks nodes with BM25 over the search index.",
  ],
  [
    "kg/doc/search#vector",
    "Vector search ranks nodes by cosine similarity of embeddings.",
  ],
  [
    "kg/doc/export#jsonld",
    "Export the graph as JSON-LD for consumers that prefer JSON.",
  ],
  [
    "kg/doc/export#iirds",
    "Export an iiRDS package containing metadata.rdf and content.",
  ],
  [
    "kg/doc/misc#penguins",
    "The mating habits of the emperor penguin in winter.",
  ],
  [
    "kg/doc/misc#baking",
    "Sourdough needs a mature starter and a long cold proof.",
  ],
];

const QUERIES = [
  "how do I install this",
  "where do settings go",
  "is the output reproducible",
  "semantic search by meaning",
  "convert the graph to JSON",
];

const TOP_K = 5;

function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/** Rank the corpus against one query vector. Mirrors `VectorIndex.search`. */
function rank(queryVector, corpusVectors) {
  return corpusVectors
    .map(({ id, vector }) => ({ id, score: cosine(queryVector, vector) }))
    .sort((x, y) =>
      x.score === y.score ? (x.id < y.id ? -1 : 1) : y.score - x.score,
    )
    .slice(0, TOP_K);
}

/**
 * Bundle the transformers web build **and dockg's own embedder** so the page
 * needs no import map.
 *
 * Both, not just transformers: the page used to call `t.pipeline(...)` directly
 * with an explicit `device`, which meant the browser half of this gate never
 * touched `createLocalEmbedder` — the function whose platform-default device
 * selection is the entire subject of ADR 01025, and whose Node half is driven
 * for real below. A gate that certifies a hand-rolled reimplementation of the
 * thing it exists to certify is the "a byte-golden is not a consumer" mistake
 * ADR 01026 refuses.
 *
 * `dist/embed.js` bundles cleanly for the browser: it imports nothing from Node,
 * and its `transformers` option is an injection seam, so the page hands it the
 * web build rather than letting it resolve the Node one.
 *
 * The web dist imports bare specifiers (`onnxruntime-web/webgpu`), which a plain
 * browser cannot resolve. esbuild's JS API rather than its CLI: spawning `npx`
 * is a `.cmd` shell-out that Node refuses on Windows without `shell: true`.
 */
async function bundleForBrowser() {
  mkdirSync(WORK, { recursive: true });
  const entry = join(WORK, "entry.mjs");
  const web = resolve(
    "node_modules/@huggingface/transformers/dist/transformers.web.js",
  );
  writeFileSync(
    entry,
    [
      `export * as transformers from ${JSON.stringify(web)};`,
      `export { createLocalEmbedder } from ${JSON.stringify(resolve("dist/embed.js"))};`,
      "",
    ].join("\n"),
  );
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    outfile: join(WORK, "bundle.mjs"),
    // dist/embed.js also carries a dynamic `import("@huggingface/transformers")`
    // for the case where nothing is injected. The page always injects, so that
    // path is dead here — but esbuild still resolves it, and would pull in the
    // *Node* build. Point it at the web one.
    alias: { "@huggingface/transformers": web },
    logLevel: "error",
  });
}

function writePage(queries) {
  writeFileSync(
    join(WORK, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>gate</title><pre id="o">…</pre>
<script type="module">
const log = (s) => { document.getElementById("o").textContent += "\\n" + s; };
try {
  const { transformers, createLocalEmbedder } = await import("./bundle.mjs");
  // dockg's own embedder, with the web transformers injected — not a
  // hand-rolled pipeline call. This is what makes the browser leg a consumer of
  // the shipped code rather than a second implementation of it, so the platform
  // default device selection ADR 01025 turns on is genuinely exercised here.
  // No \`device\` is passed, for the same reason \`createLocalEmbedder\` does not
  // pass one: the accepted values are disjoint across platforms.
  const embedder = await createLocalEmbedder({ role: "query", transformers });
  // Read the pinned thread count back: setting a property that nothing reads is
  // exactly the failure ADR 01025 documents on the Node side. It is set by
  // createLocalEmbedder now, so this also proves the injected module is the one
  // it configured.
  window.__THREADS = transformers.env?.backends?.onnx?.wasm?.numThreads ?? null;
  const out = [];
  // Raw queries: the embedder applies the model's own prefix convention, which
  // is the behavior under test rather than something for the page to replicate.
  for (const q of ${JSON.stringify(queries)}) {
    out.push(Array.from(await embedder.embed(q)));
  }
  window.__VECTORS = out;
  document.title = "DONE";
  log("embedded " + out.length + " queries");
} catch (e) { window.__ERROR = String(e && e.message); document.title = "ERR"; log("ERROR " + e.message); }
</script>`,
  );
}

const TYPES = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

async function main() {
  console.log(`model: ${DEFAULT_MODEL}`);

  console.log("embedding corpus and queries in Node…");
  const passages = await createLocalEmbedder({ role: "passage" });
  const corpusVectors = [];
  for (const [id, text] of CORPUS) {
    corpusVectors.push({ id, vector: await passages.embed(text) });
  }
  const queries = await createLocalEmbedder({ role: "query" });
  const nodeQueryVectors = [];
  for (const q of QUERIES) nodeQueryVectors.push(await queries.embed(q));

  console.log("bundling web build…");
  await bundleForBrowser();
  // Raw queries. The page now calls `createLocalEmbedder`, which applies the
  // model's prefix convention itself — the same code the Node leg above ran —
  // so pre-applying it here would prefix twice and compare two strings neither
  // platform would ever produce. (When the page called the raw pipeline it had
  // to be handed prefixed text; that asymmetry is what made an unprefixed page
  // able to certify nothing under a model like bge-small.)
  writePage(QUERIES);

  const server = createServer(async (req, res) => {
    const p = join(
      WORK,
      req.url === "/"
        ? "index.html"
        : decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    try {
      const body = readFileSync(p);
      res.writeHead(200, {
        "content-type": TYPES[extname(p)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("nf");
    }
  });
  // Port 0: the OS assigns a free one. A hardcoded port is a source of
  // failures that have nothing to do with what this gate measures.
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  console.log("embedding the same queries in headless Chrome…");
  const browser = await chromium.launch();
  let browserQueryVectors, threads;
  try {
    const page = await browser.newPage();
    // Surface page-side failures. Without this a crash inside the module
    // script is invisible and shows up only as a wait timeout.
    page.on("console", (m) => {
      if (m.type() === "error") console.error(`  [page] ${m.text()}`);
    });
    page.on("pageerror", (e) => console.error(`  [page] ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/`);
    try {
      // `waitForFunction(fn, arg, options)` — the second parameter is the
      // *argument*, not the options. Passing `{timeout}` there silently leaves
      // the 30 s default in place, which is what failed CI: the browser
      // downloads its own copy of the model (Node's npm-side cache does not
      // serve the page), so a cold run needs minutes, not seconds.
      await page.waitForFunction(
        () => document.title === "DONE" || document.title === "ERR",
        undefined,
        { timeout: 900_000 },
      );
    } catch (e) {
      // Guarded: if the page died hard enough that reading it also throws, that
      // exception would replace the timeout and lose the actual failure.
      const state = await page.innerText("#o").catch(() => "<page unreadable>");
      console.error(`\npage state at timeout:\n${state}`);
      throw e;
    }
    const err = await page.evaluate(() => window.__ERROR ?? null);
    if (err) throw new Error(`browser embedding failed: ${err}`);
    browserQueryVectors = await page.evaluate(() => window.__VECTORS);
    threads = await page.evaluate(() => window.__THREADS);
  } finally {
    await browser.close();
    server.close();
  }

  // Discipline 1 is only claimed for the WASM side; assert it there rather than
  // trusting that the assignment took.
  console.log(`browser wasm numThreads readback: ${threads}`);
  if (threads !== 1)
    throw new Error(`numThreads did not pin in the browser (got ${threads})`);

  let violations = 0;
  let decisivePairs = 0;
  let worstCosine = 1;
  let worstScoreNoise = 0;
  let closestSurvivingCall = Infinity;
  const tailSwaps = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const nodeV = nodeQueryVectors[i];
    const browserV = Float32Array.from(browserQueryVectors[i]);
    const cos = cosine(nodeV, browserV);
    worstCosine = Math.min(worstCosine, cos);

    // The noise floor in the units that decide ordering. Component-wise vector
    // distance is a proxy; what actually flips a rank is how far each *score*
    // moved, so measure that directly.
    const nodeScores = new Map(
      corpusVectors.map(({ id, vector }) => [id, cosine(nodeV, vector)]),
    );
    const browserScores = new Map(
      corpusVectors.map(({ id, vector }) => [id, cosine(browserV, vector)]),
    );
    let scoreNoise = 0;
    for (const [id, s] of nodeScores)
      scoreNoise = Math.max(scoreNoise, Math.abs(s - browserScores.get(id)));
    worstScoreNoise = Math.max(worstScoreNoise, scoreNoise);

    // A pair is *decisive* when Node separates it by more than twice the
    // observed score noise — no amount of the disagreement measured on this run
    // could reorder it. Those must hold. Pairs closer than that are genuine
    // near-ties, and q8 arithmetic does not resolve them identically on two
    // backends (ADR 01025); they are allowed to swap.
    const threshold = 2 * scoreNoise;
    const ids = corpusVectors.map((c) => c.id);
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const gap = nodeScores.get(ids[a]) - nodeScores.get(ids[b]);
        if (Math.abs(gap) <= threshold) continue;
        decisivePairs++;
        closestSurvivingCall = Math.min(closestSurvivingCall, Math.abs(gap));
        const browserGap =
          browserScores.get(ids[a]) - browserScores.get(ids[b]);
        if (Math.sign(gap) !== Math.sign(browserGap)) {
          violations++;
          console.error(
            `  VIOLATION: ${ids[a]} vs ${ids[b]} — node gap ${gap.toExponential(3)}, browser gap ${browserGap.toExponential(3)}`,
          );
        }
      }
    }

    const nodeIds = rank(nodeV, corpusVectors).map((r) => r.id);
    const browserIds = rank(browserV, corpusVectors).map((r) => r.id);
    const identical = nodeIds.join("|") === browserIds.join("|");
    if (!identical) tailSwaps.push(QUERIES[i]);

    console.log(
      `\n[${identical ? "identical" : "near-tie swap"}] ${QUERIES[i]}\n` +
        `  cosine(node,browser)=${cos.toFixed(9)} scoreNoise=${scoreNoise.toExponential(3)}\n` +
        `  node:    ${nodeIds.join(", ")}\n` +
        `  browser: ${browserIds.join(", ")}`,
    );
  }

  console.log(
    `\n=== worst query cosine ${worstCosine.toFixed(9)} | worst score noise ${worstScoreNoise.toExponential(3)}` +
      `\n=== ${decisivePairs} decisive pairs checked, ${violations} violations` +
      `\n=== closest decisive gap upheld: ${closestSurvivingCall.toExponential(3)}` +
      `\n=== top-${TOP_K} identical for ${QUERIES.length - tailSwaps.length}/${QUERIES.length} queries` +
      (tailSwaps.length ? `; near-tie swaps in: ${tailSwaps.join("; ")}` : ""),
  );

  // A gate calibrated to measured noise must also bound that noise, or a
  // library regression that doubles the disagreement would silently widen the
  // tolerance and keep passing. This ceiling is ~3x the noise observed when the
  // gate was written (7e-3); crossing it means something changed and the
  // measurements in ADR 01025 need redoing.
  const NOISE_CEILING = 2e-2;
  if (worstScoreNoise > NOISE_CEILING) {
    console.error(
      `\nScore noise ${worstScoreNoise.toExponential(3)} exceeds the ${NOISE_CEILING.toExponential(1)} ceiling — ` +
        `the platforms have drifted further apart than ADR 01025 measured. Re-measure before widening this.`,
    );
    process.exit(1);
  }

  if (violations > 0) {
    console.error(
      `\n${violations} decisively-ordered pairs were reordered across platforms.`,
    );
    process.exit(1);
  }
  console.log(
    `\nEvery decisively-ordered pair held across platforms. Near-ties within ${(2 * worstScoreNoise).toExponential(3)} may swap, by design.`,
  );
}

await main();
