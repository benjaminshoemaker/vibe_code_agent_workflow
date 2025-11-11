import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { StageBudget, BudgetExceededError } from "./budget";
import { MAX_STAGE_LLM_CALLS } from "./constants";
import type {
  StageEvent,
  StageGraphState,
  StageName,
  StageRuntimeOptions,
  StageStatus
} from "./types";

const StageState = Annotation.Root({
  sessionId: Annotation<string>(),
  stage: Annotation<StageName>(),
  llmCalls: Annotation<number>({
    default: () => 0,
    reducer: (_current, update) => update
  }),
  status: Annotation<StageStatus>({
    default: () => "running",
    reducer: (_current, update) => update
  }),
  events: Annotation<StageEvent[]>({
    default: () => [],
    reducer: (left, right) => left.concat(right)
  })
});

export const STAGES: StageName[] = ["intake", "spec", "design", "prompt_plan", "agents", "export"] as const;

const STAGE_GRAPH_NODES: Array<typeof START | StageName> = [START, ...STAGES];

type NodeConfig = RunnableConfig & {
  configurable?: {
    runtime?: StageRuntimeOptions;
  };
};

const runtimeFallback: StageRuntimeOptions = {
  sessionId: "",
  driver: {
    async run() {
      return { status: "needs_more", reason: "RUNTIME_NOT_CONFIGURED" };
    }
  },
  reingest: async () => {}
};

function resolveRuntime(config?: NodeConfig): StageRuntimeOptions {
  const runtime = config?.configurable?.runtime ?? runtimeFallback;
  return {
    ...runtime,
    budgetLimit: runtime.budgetLimit ?? MAX_STAGE_LLM_CALLS
  };
}

function createEventBuffer(onEvent?: (event: StageEvent) => void) {
  const buffer: StageEvent[] = [];
  return {
    emit(event: StageEvent) {
      buffer.push(event);
      onEvent?.(event);
    },
    flush() {
      return buffer;
    },
    has(type: StageEvent["event"]) {
      return buffer.some((event) => event.event === type);
    }
  };
}

function createStageNode(stage: StageName) {
  return async (state: StageGraphState, config?: NodeConfig) => {
    const runtime = resolveRuntime(config);
    const sessionId = runtime.sessionId || state.sessionId;
    const reingest = runtime.reingest ?? (async () => {});
    const budget = new StageBudget(runtime.budgetLimit ?? MAX_STAGE_LLM_CALLS, state.llmCalls ?? 0);
    const events = createEventBuffer(runtime.onEvent);
    let status: StageStatus = "running";

    const emitNeedsMore = (reason: string) => {
      events.emit({ event: "stage.needs_more", data: { stage, reason } });
    };

    try {
      await reingest({ sessionId, stage, phase: "stage_start" });

      const result = await runtime.driver.run({
        sessionId,
        stage,
        budget,
        emit: events.emit.bind(events),
        stateSnapshot: state
      });

      if (result.status === "needs_more") {
        status = "needs_more";
        if (!events.has("stage.needs_more")) {
          emitNeedsMore(result.reason ?? "NEEDS_MORE");
        }
        return {
          llmCalls: budget.totalCalls,
          events: events.flush(),
          status
        };
      }

      await reingest({ sessionId, stage, phase: "pre_validation" });
      events.emit({ event: "stage.ready", data: { stage } });
      status = "ready";
    } catch (error) {
      status = "needs_more";
      if (error instanceof BudgetExceededError) {
        emitNeedsMore("BUDGET_EXCEEDED");
      } else {
        emitNeedsMore("RUNTIME_ERROR");
      }
    }

    return {
      llmCalls: budget.totalCalls,
      events: events.flush(),
      status
    };
  };
}

export function createStageGraph() {
  const graph = new StateGraph(StageState, { nodes: STAGE_GRAPH_NODES });

  graph.addConditionalEdges(START, (state: StageGraphState) => state.stage);

  for (const stage of STAGES) {
    graph.addNode(stage, createStageNode(stage));
    graph.addEdge(stage, END);
  }

  return graph.compile({
    checkpointer: new MemorySaver(),
    name: "stage-orchestrator"
  });
}
