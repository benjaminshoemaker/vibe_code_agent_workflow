import { createStageGraph } from "../orchestrator/graph";
import { DefaultStageDriver } from "../orchestrator/driver";
import { MAX_STAGE_LLM_CALLS } from "../orchestrator/constants";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  StageEvent,
  StageName,
  StageReingestHandler,
  StageReingestInput,
  StageStatus,
  StageDriver
} from "../orchestrator/types";

export type ReingestPayload = {
  sessionId: string;
  docName: string;
};

const stageGraph = createStageGraph();
const defaultDriver = new DefaultStageDriver();

async function reingestDoc(payload: ReingestPayload) {
  if (process.env.NODE_ENV !== "test") {
    console.info("orchestrator.reingest", payload);
  }
}

async function refreshContext(payload: StageReingestInput) {
  if (process.env.NODE_ENV !== "test") {
    console.info("orchestrator.refreshContext", payload);
  }
}

export type StageRunOptions = {
  sessionId: string;
  stage: StageName;
  onEvent?: (event: StageEvent) => void;
  reingest?: StageReingestHandler;
  budgetLimit?: number;
  driver?: StageDriver;
};

export type StageRunResult = {
  llmCalls: number;
  events: StageEvent[];
  status: StageStatus;
};

export async function runStage(options: StageRunOptions): Promise<StageRunResult> {
  const initialState = {
    sessionId: options.sessionId,
    stage: options.stage,
    llmCalls: 0,
    events: [],
    status: "running" as StageStatus
  };

  const runConfig: RunnableConfig = {
    configurable: {
      thread_id: `${options.sessionId}:${options.stage}`,
      checkpoint_id: `${options.sessionId}:${options.stage}`,
      runtime: {
        sessionId: options.sessionId,
        driver: options.driver ?? defaultDriver,
        reingest: options.reingest ?? refreshContext,
        onEvent: options.onEvent,
        budgetLimit: options.budgetLimit ?? MAX_STAGE_LLM_CALLS
      }
    }
  };

  const result = await stageGraph.withConfig(runConfig).invoke(initialState);

  return {
    llmCalls: result.llmCalls ?? 0,
    events: result.events ?? [],
    status: result.status ?? "running"
  };
}

export const orchestrator = {
  reingest: reingestDoc,
  refreshContext,
  runStage
};
