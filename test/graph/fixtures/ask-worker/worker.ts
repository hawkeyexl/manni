// The worker on docs/src/content/docs/graph/retrieve-from-a-script/index.mdx,
// kept here so `tsc` type-checks it. The page imports the published entry
// point; this file imports the same module from source. ask-worker.test.ts
// asserts the two stay identical apart from that one specifier.
import { createRetriever, type LookupResult } from "../../../../src/graph/runtime/index.js";

interface Passage {
  id: string;
  role: "answer" | "background" | "dependent";
  title: string;
  text: string;
  unverified: boolean;
}

interface Env {
  MODEL: { answer(input: { question: string; context: Passage[] }): Promise<string> };
}

const docs = await createRetriever({ manifest: "https://hawkeyexl.github.io/manni/graph/chunks.json" });

function passages(
  result: LookupResult,
  section: "matches" | "traversal" | "impact",
  role: Passage["role"],
): Passage[] {
  return result[section].passages.flatMap((p) =>
    p.text === null
      ? []
      : [{ id: p.iri, role, title: p.title, text: p.text, unverified: p.provenance.pins.error > 0 }],
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { question } = (await request.json()) as { question: string };
    const result = await docs.lookup(question);
    if (result.refusal) return Response.json({ answer: null, refusal: result.refusal });
    const context = [
      ...passages(result, "matches", "answer"),
      ...passages(result, "traversal", "background"),
      ...passages(result, "impact", "dependent"),
    ];
    const answer = await env.MODEL.answer({ question, context }); // your model, your backend
    return Response.json({ answer, citations: result.citations });
  },
};
