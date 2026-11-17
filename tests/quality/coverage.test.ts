import { describe, expect, it } from "vitest";
import { uncovered } from "@/lib/quality/coverage";

const last = { models: ["gemini-a"], prompt_version: "extract-v1" };

describe("uncovered", () => {
  it("is empty when nothing has changed", () => expect(uncovered({ models: ["gemini-a"], promptVersions: ["extract-v1", "draft-v1", "pains-v2"] }, last)).toEqual([]));
  it("names a model the golden set never saw", () => expect(uncovered({ models: ["gemini-a", "gemini-b"], promptVersions: ["extract-v1"] }, last)).toEqual(["gemini-b"]));
  it("names a new extraction prompt, but ignores other prompts, which the golden set does not test", () => {
    expect(uncovered({ models: ["gemini-a"], promptVersions: ["extract-v2", "draft-v9"] }, last)).toEqual(["extract-v2"]);
  });
  it("cannot say anything without a real run to compare against", () => expect(uncovered({ models: ["x"], promptVersions: ["extract-v9"] }, undefined)).toEqual([]));
});
