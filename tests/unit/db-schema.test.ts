import { describe, expect, it } from "vitest";
import { docNames, stageNames } from "../../src/db/schema";

describe("database schema enums", () => {
  it("matches the spec-defined stage sequence", () => {
    expect(stageNames).toEqual(["intake", "spec", "design", "prompt_plan", "agents", "export"]);
  });

  it("tracks the allowed doc names", () => {
    expect(docNames).toEqual(["idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"]);
  });
});
