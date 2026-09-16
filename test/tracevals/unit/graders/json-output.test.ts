import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makePlan, makeTrace } from "../../helpers.js";

const grader = graderFor("json-output")!;

describe("json-output grader", () => {
  it("validates the last assistant text against a schema", async () => {
    const result = await grader.grade({
      trace: makeTrace({ assistantTexts: ["done", '{"status":"ok"}'] }),
      plan: makePlan({
        grader: "json-output",
        options: {
          schema: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string" } },
          },
        },
      }),
    });
    expect(result.findings).toEqual([]);
  });

  it("fails when the output does not match the schema", async () => {
    const result = await grader.grade({
      trace: makeTrace({ assistantTexts: ['{"status":42}'] }),
      plan: makePlan({
        grader: "json-output",
        options: {
          schema: { type: "object", properties: { status: { type: "string" } } },
        },
      }),
    });
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("fails when the output is not JSON at all", async () => {
    const result = await grader.grade({
      trace: makeTrace({ assistantTexts: ["not json"] }),
      plan: makePlan({
        grader: "json-output",
        options: { schema: { type: "object" } },
      }),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("JSON");
  });

  it("grades the same $id-bearing schema across a batch of traces", async () => {
    // The module-level Ajv kept every schema it compiled, so a schema
    // declaring `$id` compiled on trace 1 and threw
    // `schema with key or id "…" already exists` on traces 2..N — erroring
    // every trace after the first in a batch run or a `calibrate` sweep.
    const schema = () => ({
      $id: "https://example.test/report.json",
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } },
    });
    const gradeOnce = () =>
      grader.grade({
        trace: makeTrace({ assistantTexts: ['{"status":"ok"}'] }),
        plan: makePlan({ grader: "json-output", options: { schema: schema() } }),
      });

    const first = await gradeOnce();
    expect(first.error).toBeUndefined();
    const second = await gradeOnce();
    expect(second.error, "the second trace in the batch errored").toBeUndefined();
    expect(second.findings).toEqual([]);
    const third = await gradeOnce();
    expect(third.error).toBeUndefined();
  });
});
