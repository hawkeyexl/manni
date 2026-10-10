#!/usr/bin/env node
/**
 * One hill-climb round over the runtime-evals set: run the live benchmark
 * `--reps` times per judge, then write the round in the layout the claude-api
 * hillclimb report reads (`results.jsonl`, `summary.json`, `traces/`), one flow
 * per judge under `.claude/hillclimb/runtime-evals/<judge>/`.
 *
 *   node scripts/runtime-evals-hillclimb.mjs --round baseline --reps 3
 *   node scripts/runtime-evals-hillclimb.mjs --round v1 --reps 3 --desc "show tool results"
 *
 * Resume is idempotent: a rep whose raw file exists is not run again. Judges run
 * in parallel (one uses the Claude CLI, the other the local GPU); reps run in
 * sequence. A changed harness file stops the run until `--approve-harness`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "test/tracevals/fixtures/runtime-evals");
const FLOWS = join(ROOT, ".claude/hillclimb/runtime-evals");
const LIVE = "test/tracevals/integration/runtime-evals.live.test.ts";
const HARNESS = [
  "scripts/runtime-evals-hillclimb.mjs",
  LIVE,
  "test/tracevals/runtime-evals.ts",
  "test/tracevals/fixtures/runtime-evals/cases.json",
  "package-lock.json",
];
const JUDGES = {
  haiku: { provider: "claude-cli", model: "claude-haiku-5-5" },
  qwen: { provider: "llama-cpp", model: "qwen3.5-4b" },
};

function args() {
  const out = { round: "", reps: 3, judges: Object.keys(JUDGES), desc: "", target: "code", approve: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    const k = a[i];
    const v = a[i + 1];
    if (k === "--round") out.round = v, i += 1;
    else if (k === "--reps") out.reps = Number(v), i += 1;
    else if (k === "--judges") out.judges = v.split(","), i += 1;
    else if (k === "--desc") out.desc = v, i += 1;
    else if (k === "--target") out.target = v, i += 1;
    else if (k === "--approve-harness") out.approve = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!/^(baseline|v\d+)$/.test(out.round)) throw new Error("--round must be baseline or vN");
  if (!Number.isInteger(out.reps) || out.reps < 1) throw new Error("--reps must be a whole number of at least 1");
  for (const j of out.judges) if (!(j in JUDGES)) throw new Error(`unknown judge ${j}`);
  return out;
}

async function harnessSha() {
  const h = createHash("sha256");
  for (const p of HARNESS) h.update(p).update(await readFile(join(ROOT, p)));
  return h.digest("hex");
}

const readJson = async (p) => JSON.parse(await readFile(p, "utf-8"));

async function loadCases() {
  const raw = await readJson(join(CORPUS, "cases.json"));
  const cases = Array.isArray(raw) ? raw : raw.cases;
  for (const c of cases) {
    if (c.split !== "train" && c.split !== "test") throw new Error(`case ${c.id} has no train/test split`);
  }
  return cases;
}

function runRep(judge, file) {
  const { provider, model } = JUDGES[judge];
  return new Promise((done) => {
    const child = spawn("npx", ["vitest", "run", LIVE], {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        MANNI_TRACEVALS_LIVE: "1",
        MANNI_RUNTIME_EVALS_PROVIDER: provider,
        MANNI_RUNTIME_EVALS_MODEL: model,
        MANNI_RUNTIME_EVALS_OUT: file,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (d) => (tail = (tail + d.toString()).slice(-4000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // The live test's floors may fail the vitest run; the results file is what counts.
    child.on("close", (code) => done({ code, tail }));
  });
}

/** Rows, traces and a summary for one judge's round, rebuilt from its raw rep files. */
async function build(judge, roundDir, cases, meta) {
  const rawDir = join(roundDir, "raw");
  const reps = (await readdir(rawDir)).filter((f) => /^rep\d+\.json$/.test(f)).sort();
  const split = new Map(cases.map((c) => [c.id, c]));
  const rows = [];
  await mkdir(join(roundDir, "traces"), { recursive: true });
  for (const f of reps) {
    const rep = Number(f.slice(3, -5));
    const run = await readJson(join(rawDir, f));
    for (const result of run.cases) {
      const c = split.get(result.id);
      if (c === undefined) continue;
      const firm = result.pairs.filter((p) => !p.debatable);
      const share = firm.length > 0 ? 1 / result.pairs.length : 0;
      for (const p of firm) {
        const id = `${result.id}::${p.key}`;
        const safe = id.replace(/[^A-Za-z0-9._-]+/g, "_");
        rows.push({
          prompt_id: id,
          rep,
          prompt: `${result.what}\nRule: ${p.key}\nSession: ${c.trace}`,
          tags: [c.split, result.id],
          grade: {
            accuracy: p.correct ? 1 : 0,
            false_block: p.falseBlock ? 1 : 0,
            missed_break: p.missedBreak ? 1 : 0,
            needs_review: p.placement === "needs-review" ? 1 : 0,
          },
          explanation: { accuracy: p.reasoning ?? (p.error ? `error: ${p.error}` : "") },
          model: run.judge.model,
          latency_s: (result.ms / 1000) * share,
          cost_usd: typeof result.costUsd === "number" ? result.costUsd * share : 0,
          usage: {
            input_tokens: Math.round((result.usage?.inputTokens ?? 0) * share),
            output_tokens: Math.round((result.usage?.outputTokens ?? 0) * share),
          },
          meta: { label: p.label, placement: p.placement, scores: p.scores ?? null, severity: p.severity },
        });
        await writeFile(
          join(roundDir, "traces", `${safe}_rep${String(rep)}.json`),
          `${JSON.stringify(
            [
              {
                role: "user",
                content: `Case ${result.id} (${c.split}): ${result.what}\nRule ${p.key}\nSession file: test/tracevals/fixtures/runtime-evals/${c.trace}\nLabel: ${p.label}`,
              },
              {
                role: "assistant",
                content: `${p.reasoning ?? (p.error ? `error: ${p.error}` : "(no reasoning)")}\n\nscores ${JSON.stringify(p.scores ?? null)} -> placement ${p.placement}${p.correct ? "" : " (wrong)"}`,
              },
            ],
            null,
            2,
          )}\n`,
          "utf-8",
        );
      }
    }
  }
  await writeFile(join(roundDir, "results.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  await writeFile(join(roundDir, "summary.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");

  const score = (s) => {
    const rs = rows.filter((r) => r.tags[0] === s);
    const n = rs.length;
    const sum = (k) => rs.reduce((a, r) => a + r.grade[k], 0);
    const per = reps.length || 1;
    return {
      n,
      accuracy: n ? sum("accuracy") / n : 0,
      falseBlocks: sum("false_block") / per,
      missedBreaks: sum("missed_break") / per,
      needsReview: sum("needs_review") / per,
    };
  };
  return { reps: reps.length, train: score("train"), test: score("test") };
}

async function main() {
  const o = args();
  const cases = await loadCases();
  const sha = await harnessSha();
  const fmt = (x) => `${(x.accuracy * 100).toFixed(1)}% (fb ${x.falseBlocks.toFixed(1)}, mb ${x.missedBreaks.toFixed(1)}, nr ${x.needsReview.toFixed(1)}, n ${String(x.n)})`;

  await Promise.all(
    o.judges.map(async (judge) => {
      const flow = join(FLOWS, JUDGES[judge].model);
      await mkdir(flow, { recursive: true });
      const statePath = join(flow, "_state.json");
      const state = existsSync(statePath) ? await readJson(statePath) : {};
      if (state.harness_sha !== undefined && state.harness_sha !== sha && !o.approve) {
        console.error(`${judge}: a harness file changed since it was approved; rerun with --approve-harness after review`);
        process.exitCode = 2;
        return;
      }
      const roundDir = join(flow, o.round);
      await mkdir(join(roundDir, "raw"), { recursive: true });
      for (let rep = 0; rep < o.reps; rep += 1) {
        const file = join(roundDir, "raw", `rep${String(rep)}.json`);
        if (existsSync(file)) continue;
        const t0 = Date.now();
        const { code, tail } = await runRep(judge, file);
        if (!existsSync(file)) {
          console.error(`${judge} rep ${String(rep)}: no results (vitest exit ${String(code)})\n${tail}`);
          process.exitCode = 1;
          return;
        }
        console.log(`${judge} ${o.round} rep ${String(rep + 1)}/${String(o.reps)} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      const meta = { description: o.desc || o.round, target: o.target, judge: JUDGES[judge] };
      const s = await build(judge, roundDir, cases, meta);
      const ids = (split) => [...new Set(cases.filter((c) => c.split === split).flatMap((c) =>
        Object.entries(c.labels).filter(([, l]) => !l.debatable).map(([k]) => `${c.id}::${k}`)))];
      const next = {
        reps: o.reps,
        goal: { target: "accuracy", direction: "higher", hold: ["false_block", "missed_break", "needs_review"] },
        approve_each_round: false,
        ...state,
        current_round: o.round === "baseline" ? 0 : Number(o.round.slice(1)),
        train_ids: ids("train"),
        test_ids: ids("test"),
        harness_paths: HARNESS,
        harness_sha: state.harness_sha === undefined || o.approve ? sha : state.harness_sha,
        metrics: [
          { id: "accuracy", kind: "binary", label: "Accuracy" },
          { id: "false_block", kind: "binary", label: "False block", better: "lower" },
          { id: "missed_break", kind: "binary", label: "Missed break", better: "lower" },
          { id: "needs_review", kind: "binary", label: "Needs review", better: "lower" },
        ],
        perf_fields: [
          { id: "cost_usd", label: "Cost", unit: "$" },
          { id: "latency_s", label: "Latency", unit: "s" },
        ],
      };
      await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
      console.log(`${judge} ${o.round}: ${String(s.reps)} reps | train ${fmt(s.train)} | test ${fmt(s.test)}`);
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
