import { generateResponse } from "../libs/openai";
import { BudgetExceededError } from "./budget";
import type { StageDriver, StageDriverResult, StageDriverRunArgs, StageEvent, StageName } from "./types";

const stageDescriptions: Record<StageName, string> = {
  intake:
    "Gather unanswered details about the problem, audience, platform, core flow, MVP features, and optional non-goals.",
  one_pager:
    "Summarize the idea.md into a single concise one-pager covering Problem, Audience, Platform, Core Flow, and MVP Features.",
  spec: "Transform the one-pager into a short specification with a Definition of Done and minimum technical notes.",
  design:
    "Describe the experience that should be captured in the design prompt and list any assets the human designer should create.",
  prompt_plan:
    "Outline the agent execution prompt plan with per-step prompts, expected artifacts, tests, rollback notes, and TODO checkboxes.",
  agents:
    "Draft AGENTS.md with descriptions for each doc plus the Agent responsibility section so the agents stage can execute safely.",
  export: "Prepare a short summary of the final bundle, ensuring every doc and design index entry is represented."
};

const failureEvent = (stage: StageName, reason: string): StageEvent => ({
  event: "stage.needs_more",
  data: { stage, reason }
});

function collectAssistantText(output: any) {
  const segments: string[] = [];
  for (const item of output ?? []) {
    const message = item?.message ?? item;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (const content of message.content) {
      if (content?.type === "output_text" && content?.text) {
        segments.push(content.text);
      }
    }
  }
  return segments;
}

export class DefaultStageDriver implements StageDriver {
  async run({ stage, budget, emit, sessionId }: StageDriverRunArgs): Promise<StageDriverResult> {
    const description =
      stageDescriptions[stage] ?? "Continue the staged workflow and report notable progress to the operator.";

    try {
      await budget.consume("generation");
      const completion = await generateResponse({
        input: [
          {
            role: "system",
            content: `You are the orchestrator for the ${stage} stage of session ${sessionId}. Produce actionable next steps only.`
          },
          {
            role: "user",
            content: description
          }
        ]
      });

      for (const text of collectAssistantText(completion.output)) {
        emit({ event: "assistant.delta", data: text });
      }

      await budget.consume("validation");
      return { status: "ready" };
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        emit(failureEvent(stage, "BUDGET_EXCEEDED"));
        return { status: "needs_more", reason: "BUDGET_EXCEEDED" };
      }

      emit(failureEvent(stage, "LLM_ERROR"));
      return { status: "needs_more", reason: "LLM_ERROR" };
    }
  }
}
