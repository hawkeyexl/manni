// Throwaway: compute cite "lie windows" over this repo's first-parent history.
// usage: node lie-window.mjs <repo> <startCommit>
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const [repo, start] = process.argv.slice(2);
const req = createRequire(`${repo}/package.json`);
const YAML = req("yaml");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });

// --- cat-file batch with cache
const blobCache = new Map();
const cat = spawn("git", ["-C", repo, "cat-file", "--batch"]);
let buf = Buffer.alloc(0); const waiters = [];
cat.stdout.on("data", (d) => { buf = Buffer.concat([buf, d]); pump(); });
function pump() {
  while (waiters.length) {
    const nl = buf.indexOf(10); if (nl < 0) return;
    const head = buf.subarray(0, nl).toString(); const parts = head.split(" ");
    if (parts[1] === "missing") { buf = buf.subarray(nl + 1); waiters.shift()(null); continue; }
    const size = Number(parts[2]); if (buf.length < nl + 1 + size + 1) return;
    const body = buf.subarray(nl + 1, nl + 1 + size).toString("utf8"); buf = buf.subarray(nl + 2 + size);
    waiters.shift()(body);
  }
}
function blob(oid) {
  if (blobCache.has(oid)) return blobCache.get(oid);
  const p = new Promise((r) => { waiters.push(r); cat.stdin.write(oid + "\n"); });
  blobCache.set(oid, p); return p;
}

const norm = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t).replace(/\r\n/g, "\n");
const split = (t) => { const p = norm(t).split("\n"); if (p.at(-1) === "") p.pop(); return p; };
const pin = (s) => "sha256-" + createHash("sha256").update(s, "utf8").digest("hex");
const ws = (l) => l.replace(/\s+/g, " ").trim();
const range = (spec) => {
  if (spec === undefined) return null; const [a, b] = String(spec).split("-").map(Number); return { s: a, e: b ?? a };
};

const commits = git("rev-list", "--first-parent", "--reverse", `${start}^..HEAD`).trim().split("\n");
const meta = new Map();
for (const l of git("log", "--first-parent", "--format=%H %ct %s", `${start}^..HEAD`).trim().split("\n")) {
  const [h, t, ...s] = l.split(" "); meta.set(h, { t: Number(t), s: s.join(" ") });
}
const tagAt = new Map();
for (const l of git("tag", "--merged", "HEAD", "--format=%(objectname) %(*objectname) %(refname:short)").trim().split("\n")) {
  const [o, deref, name] = l.split(" ").length === 3 ? l.split(" ") : [l.split(" ")[0], "", l.split(" ")[1]];
  const c = deref || o; (tagAt.get(c) ?? tagAt.set(c, []).get(c)).push(name);
}
const isCit = (p) => p === "site.metadata.yaml" || (p.startsWith("docs/src/content/docs/") && p.endsWith(".citations.yaml"));

const parsed = new Map();
async function entriesOf(oid) {
  if (parsed.has(oid)) return parsed.get(oid);
  const doc = YAML.parse(await blob(oid)) ?? {}; const out = [];
  for (const [page, v] of Object.entries(doc)) for (const c of v?.citations ?? []) {
    const s = c.source ?? {}; if (!s.file || !s.integrity || String(s.integrity).startsWith("hmac")) continue;
    out.push({ key: `${page}#${c.id}`, file: s.file, lines: s.lines, integrity: s.integrity, sha: s["commit-sha"], claim: c.claim?.integrity });
  }
  parsed.set(oid, out); return out;
}

// original text of a pin state: first window hashing to pin in file at the given commit trees
const origCache = new Map();
async function original(e, trees) {
  const k = `${e.file}\0${e.lines}\0${e.integrity}`; if (origCache.has(k)) return origCache.get(k);
  let found = null; const r = range(e.lines);
  const tryText = (text) => {
    const L = split(text);
    if (!r) return pin(L.join("\n")) === e.integrity ? L : null;
    const n = r.e - r.s + 1;
    if (r.e <= L.length && pin(L.slice(r.s - 1, r.e).join("\n")) === e.integrity) return L.slice(r.s - 1, r.e);
    for (let i = 0; i + n <= L.length; i++) if (pin(L.slice(i, i + n).join("\n")) === e.integrity) return L.slice(i, i + n);
    return null;
  };
  for (const tree of trees) { const oid = tree.get(e.file); if (!oid) continue; found = tryText(await blob(oid)); if (found) break; }
  if (!found && e.sha) { try { found = tryText(git("show", `${e.sha}:${e.file}`)); } catch {} }
  origCache.set(k, found); return found;
}

// status of a pin state in a blob: current | moved | ws | changed | missing
const statusCache = new Map();
async function status(e, oid, orig) {
  if (!oid) return "missing";
  const k = `${oid}\0${e.lines}\0${e.integrity}`; if (statusCache.has(k)) return statusCache.get(k);
  const L = split(await blob(oid)); const r = range(e.lines); let st;
  if (!r) st = pin(L.join("\n")) === e.integrity ? "current" : (orig && ws(L.join("\n")) === ws(orig.join("\n")) ? "ws" : "changed");
  else if (r.e <= L.length && pin(L.slice(r.s - 1, r.e).join("\n")) === e.integrity) st = "current";
  else {
    st = "changed"; const n = r.e - r.s + 1;
    if (orig) {
      const w0 = orig.map(ws);
      for (let i = 0; i + n <= L.length; i++) if (L[i] === orig[0] && pin(L.slice(i, i + n).join("\n")) === e.integrity) { st = "moved"; break; }
      if (st === "changed") {
        // whitespace-only: same lines modulo whitespace, any position, ignoring blank lines
        const w0nb = w0.filter((x) => x !== ""); const Lw = L.map(ws);
        outer: for (let i = 0; i < Lw.length; i++) {
          if (Lw[i] !== w0nb[0]) continue; let j = 0, k2 = i;
          while (j < w0nb.length && k2 < Lw.length) { if (Lw[k2] === "") { k2++; continue; } if (Lw[k2] !== w0nb[j]) continue outer; j++; k2++; }
          if (j === w0nb.length) { st = "ws"; break; }
        }
      }
    }
  }
  statusCache.set(k, st); return st;
}

const open = new Map(); const windows = []; const stateSeen = new Map(); let neverTrue = new Set(); let tot = new Set();
const recentTrees = [];
const naiveOpen = new Map(); const naiveWin = [];
let idx = 0; const perCommitStale = []; const allTrees = []; const states = new Map();
for (const c of commits) {
  const tree = new Map();
  for (const l of git("ls-tree", "-r", c).split("\n")) { if (!l) continue; const tab = l.indexOf("\t"); tree.set(l.slice(tab + 1), l.slice(0, tab).split(" ")[2]); }
  allTrees.push(tree); recentTrees.unshift(tree); if (recentTrees.length > 3) recentTrees.pop();
  const ents = []; for (const [p, oid] of tree) if (isCit(p)) ents.push(...(await entriesOf(oid)));
  const now = new Map(); let staleHere = 0;
  for (const e of ents) {
    tot.add(e.key);
    const sk = `${e.file}\0${e.lines}\0${e.integrity}`;
    const orig = await original(e, recentTrees);
    if (!states.has(sk)) states.set(sk, { e, first: idx, orig });
    if (!orig) { neverTrue.add(sk); }
    const st = await status(e, tree.get(e.file), orig);
    now.set(e.key, { e, st, sk });
    const stale = st === "changed" || st === "ws";
    if (st === "changed") staleHere++;
    const naive = st !== "current"; const on = naiveOpen.get(e.key);
    if (naive && !on) naiveOpen.set(e.key, { at: idx });
    else if (!naive && on) { naiveWin.push({ key: e.key, file: e.file, opened: meta.get(commits[on.at]).s, closed: meta.get(c).s, commits: idx - on.at, days: (meta.get(c).t - meta.get(commits[on.at]).t) / 86400 }); naiveOpen.delete(e.key); }
    const o = open.get(e.key);
    if (stale && !o) open.set(e.key, { key: e.key, file: e.file, lines: e.lines, sk, openAt: idx, open: c, kinds: new Set([st]), hasOrig: !!orig });
    else if (stale && o) o.kinds.add(st);
    else if (!stale && o) { o.closeAt = idx; o.close = c; o.cause = o.sk === sk ? `source-${st}` : "repinned"; windows.push(o); open.delete(e.key); }
  }
  for (const [k, o] of open) if (!now.has(k)) { o.closeAt = idx; o.close = c; o.cause = "entry-removed"; windows.push(o); open.delete(k); }
  perCommitStale.push(staleHere); idx++;
}
// counterfactual: nobody re-pins; when does each minted state first fail?
const cf = [];
for (const [sk, s0] of states) {
  if (!s0.orig) continue; let firstMoved = null, firstStale = null, kind = null;
  for (let i = s0.first + 1; i < allTrees.length; i++) {
    const st = await status(s0.e, allTrees[i].get(s0.e.file), s0.orig);
    if (st === "moved" && firstMoved === null) firstMoved = i;
    if (st === "changed" || st === "ws" || st === "missing") { firstStale = i; kind = st; break; }
  }
  // comment-only test: the span the old first and last line bracket now, comments and blank lines dropped
  let detail = null;
  if (kind === "changed") {
    const oid = allTrees[firstStale].get(s0.e.file); const L = split(await blob(oid));
    const only = (t) => { let at = -1; for (let i = 0; i < L.length; i++) if (L[i] === t) { if (at !== -1) return -1; at = i; } return at; };
    const a = only(s0.orig[0]); const b = s0.orig.length === 1 ? a : only(s0.orig.at(-1));
    if (a < 0 || b < a) detail = "no-span";
    else {
      const code = (ls) => ls.map(ws).filter((l) => l !== "" && !/^(\/\/|\/\*|\*|#)/.test(l)).join("\n");
      const now = L.slice(a, b + 1);
      detail = code(now) === code(s0.orig) ? "comment-only" : (now.length > s0.orig.length && code(now).includes(code(s0.orig).split("\n")[0]) ? "grew" : "edited");
    }
  }
  cf.push({ detail, key: s0.e.key, file: s0.e.file, lines: s0.e.lines, first: s0.first, firstMoved, firstStale, kind,
    staleCommit: firstStale === null ? null : commits[firstStale].slice(0, 9), staleSubject: firstStale === null ? null : meta.get(commits[firstStale]).s,
    days: firstStale === null ? null : +((meta.get(commits[firstStale]).t - meta.get(commits[s0.first]).t) / 86400).toFixed(2),
    commitsToStale: firstStale === null ? null : firstStale - s0.first });
}
writeFileSync("cf.json", JSON.stringify(cf));
{ const shas = new Map(); for (const s0 of states.values()) if (s0.e.sha) shas.set(s0.e.sha, (shas.get(s0.e.sha) ?? 0) + 1);
  let orphanStates = 0, orphanShas = 0; const reach = new Set(git("rev-list", "HEAD").trim().split("\n"));
  for (const [sha, n] of shas) if (!reach.has(sha)) { orphanShas++; orphanStates += n; }
  console.log(`distinct recorded shas ${shas.size}, not reachable from HEAD ${orphanShas}, pin states recording one ${orphanStates} of ${states.size}`); }
for (const o of open.values()) { o.closeAt = null; o.cause = "open-at-HEAD"; windows.push(o); }
cat.stdin.end();

const nowT = meta.get(commits.at(-1)).t;
const out = windows.map((w) => {
  const t0 = meta.get(w.open).t; const t1 = w.close ? meta.get(w.close).t : nowT;
  const tags = []; for (let i = w.openAt; i < (w.closeAt ?? commits.length); i++) tags.push(...(tagAt.get(commits[i]) ?? []));
  return { key: w.key, file: w.file, lines: w.lines, kinds: [...w.kinds], hasOrig: w.hasOrig, open: w.open.slice(0, 9), openSubject: meta.get(w.open).s,
    close: w.close?.slice(0, 9) ?? null, closeSubject: w.close ? meta.get(w.close).s : null, cause: w.cause,
    commits: (w.closeAt ?? commits.length) - w.openAt, days: +((t1 - t0) / 86400).toFixed(2), tags };
});
writeFileSync(process.argv[4] ?? "windows.json", JSON.stringify({ commits: commits.length, pins: tot.size, neverTrueStates: neverTrue.size, maxStaleAtOneCommit: Math.max(...perCommitStale), windows: out }, null, 1));
console.log(`commits ${commits.length} pins ${tot.size} windows ${out.length}`);
writeFileSync("naive.json", JSON.stringify(naiveWin, null, 1));
const nd = naiveWin.map((w) => w.days).sort((a, b) => a - b);
console.log(`naive windows closed ${naiveWin.length}, still open ${naiveOpen.size}, distinct pins ${new Set(naiveWin.map((w) => w.key)).size}, median days ${nd[Math.floor(nd.length / 2)]?.toFixed(2)}, p90 ${nd[Math.floor(nd.length * 0.9)]?.toFixed(2)}, max ${nd.at(-1)?.toFixed(2)}`);
const nc = naiveWin.map((w) => w.commits).sort((a, b) => a - b); console.log(`naive commits median ${nc[Math.floor(nc.length / 2)]} p90 ${nc[Math.floor(nc.length * 0.9)]}`);
