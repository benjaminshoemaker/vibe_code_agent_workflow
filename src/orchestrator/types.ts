export type StageName =
  | "intake"
  | "one_pager"
  | "spec"
  | "design"
  | "prompt_plan"
  | "agents"
  | "export";

export type StageStatus = "running" | "ready" | "needs_more";

export type StageEvent =
  | { event: "assistant.delta"; data: string }
  | { event: "doc.updated"; data: { name: string; size?: number } }
  | { event: "stage.ready"; data: { stage: StageName } }
  | { event: "stage.needs_more"; data: { stage: StageName; reason: string } };

export type StageReingestPhase = "stage_start" | "pre_validation";

export type StageReingestInput = {
  sessionId: string;
  stage: StageName;
  phase: StageReingestPhase;
};

export type StageReingestHandler = (input: StageReingestInput) => Promise<void> | void;

export interface StageBudgetManager {
  readonly totalCalls: number;
  consume: (kind: "generation" | "validation") => Promise<void> | void;
}

export type StageDriverRunArgs<StateSnapshot = StageGraphState> = {
  sessionId: string;
  stage: StageName;
  budget: StageBudgetManager;
  emit: (event: StageEvent) => void;
  stateSnapshot: StateSnapshot;
};

export type StageDriverResult = {
  status: StageStatus;
  reason?: string;
};

export interface StageDriver {
  run(args: StageDriverRunArgs): Promise<StageDriverResult>;
}

export type StageGraphState = {
  sessionId: string;
  stage: StageName;
  llmCalls: number;
  events: StageEvent[];
  status: StageStatus;
};

export type StageRuntimeOptions = {
  sessionId: string;
  driver: StageDriver;
  reingest: StageReingestHandler;
  onEvent?: (event: StageEvent) => void;
  budgetLimit?: number;
};
