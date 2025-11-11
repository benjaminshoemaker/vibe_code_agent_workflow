import { describe, it, expect } from "vitest";

import { getStageInstruction } from "../../lib/stage-instructions";

describe("Stage instructions utility (unit)", () => {
  it("returns the intake placeholder copy", () => {
    const instruction = getStageInstruction("intake");
    expect(instruction.title).toContain("Intake");
    expect(instruction.description).toMatch(/placeholder/i);
  });

  it("falls back when the stage is unknown", () => {
    const instruction = getStageInstruction("unknown-stage");
    expect(instruction.title).toContain("Workflow");
    expect(instruction.description).toMatch(/coming soon/i);
  });
});
