import { describe, expect, it, vi, type Mock } from "vitest";
import type { StageDriver } from "../../src/orchestrator/types";
import { runStage } from "../../src/services/orchestrator";

vi.mock("../../src/libs/openai", () => ({
  generateResponse: vi.fn()
}));

const { generateResponse } = await import("../../src/libs/openai");

describe("LangGraph stage orchestrator", () => {
  it("emits assistant deltas, stage.ready, and respects re-ingest policy", async () => {
    (generateResponse as Mock).mockResolvedValueOnce({
      output: [
        {
          message: {
            role: "assistant",
            content: [{ type: "output_text", text: "Stage output ready." }]
          }
        }
      ]
    });

    const events: string[] = [];
    const reingestPhases: string[] = [];

    const result = await runStage({
      sessionId: "sess-1",
      stage: "intake",
      onEvent: (event) => events.push(event.event),
      reingest: async (payload) => reingestPhases.push(payload.phase)
    });

    expect(result.status).toBe("ready");
    expect(events).toContain("assistant.delta");
    expect(events).toContain("stage.ready");
    expect(reingestPhases).toEqual(["stage_start", "pre_validation"]);
  });

  it("emits stage.needs_more when the LLM budget is exceeded", async () => {
    const exhaustingDriver: StageDriver = {
      async run({ budget, emit }) {
        for (let i = 0; i < 5; i += 1) {
          await budget.consume("generation");
        }
        emit({ event: "assistant.delta", data: "should not happen" });
        return { status: "ready" };
      }
    };

    const result = await runStage({
      sessionId: "sess-2",
      stage: "one_pager",
      driver: exhaustingDriver
    });

    expect(result.status).toBe("needs_more");
    expect(result.events.at(-1)?.event).toBe("stage.needs_more");
  });
});
