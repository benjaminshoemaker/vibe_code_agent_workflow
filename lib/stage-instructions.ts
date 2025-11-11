export type StageInstruction = {
  title: string;
  description: string;
};

export const STAGE_INSTRUCTIONS: Record<string, StageInstruction> = {
  intake: {
    title: "Intake checkpoint",
    description: "Placeholder: remind the team to collect problem, audience, platform, and MVP notes before moving on."
  },
  spec: {
    title: "Spec alignment",
    description: "Placeholder: outline flows, edge cases, and Definition of Done confirmations for this stage."
  },
  design: {
    title: "Design prep",
    description: "Placeholder: call out which mockups or visual references should be shared with the design agent."
  },
  prompt_plan: {
    title: "Planner focus",
    description: "Placeholder: summarize the tasks, expected artifacts, and validation hooks each plan step must cover."
  },
  agents: {
    title: "Agent readiness",
    description: "Placeholder: restate the automation guardrails, prompts, and manual checkpoints before execution."
  },
  export: {
    title: "Export review",
    description: "Placeholder: verify every doc and design bundle is ready for downstream consumers before finalizing."
  }
};

const FALLBACK_INSTRUCTION: StageInstruction = {
  title: "Workflow guidance",
  description: "Placeholder coming soon: this stage will include tailored reminders once the workflow expands."
};

export function getStageInstruction(stage: string): StageInstruction {
  return STAGE_INSTRUCTIONS[stage] ?? FALLBACK_INSTRUCTION;
}
