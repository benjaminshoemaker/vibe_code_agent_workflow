import { describe, it, expect } from "vitest";

import { STAGES } from "../../src/orchestrator/graph";
import { STAGE_INSTRUCTIONS } from "../../lib/stage-instructions";

describe("Stage instructions coverage (integration)", () => {
  it("provides guidance for every orchestrator stage", () => {
    const missing: string[] = [];
    for (const stage of STAGES) {
      const instruction = STAGE_INSTRUCTIONS[stage];
      if (!instruction) {
        missing.push(stage);
        continue;
      }
      expect(instruction.description.length).toBeGreaterThan(0);
    }
    expect(missing).toHaveLength(0);
  });
});
