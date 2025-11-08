import { BudgetExceededError } from "./budget";
import { stageWriters } from "./writers";
import type { StageDriver, StageDriverResult, StageDriverRunArgs } from "./types";

export class DefaultStageDriver implements StageDriver {
  async run(args: StageDriverRunArgs): Promise<StageDriverResult> {
    const writer = stageWriters[args.stage];
    if (!writer) {
      args.emit({ event: "stage.needs_more", data: { stage: args.stage, reason: "WRITER_MISSING" } });
      return { status: "needs_more", reason: "WRITER_MISSING" };
    }

    try {
      await args.budget.consume("generation");
      const result = await writer(args);
      if (result.status === "ready") {
        await args.budget.consume("validation");
      }
      return result;
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        args.emit({ event: "stage.needs_more", data: { stage: args.stage, reason: "BUDGET_EXCEEDED" } });
        return { status: "needs_more", reason: "BUDGET_EXCEEDED" };
      }

      args.emit({ event: "stage.needs_more", data: { stage: args.stage, reason: "WRITER_ERROR" } });
      return { status: "needs_more", reason: "WRITER_ERROR" };
    }
  }
}
