import type { StageBudgetManager } from "./types";

export class BudgetExceededError extends Error {
  constructor(public readonly limit: number) {
    super(`Stage budget exceeded (limit: ${limit})`);
    this.name = "BudgetExceededError";
  }
}

export class StageBudget implements StageBudgetManager {
  private count: number;

  constructor(private readonly limit: number, initialCount = 0) {
    this.count = initialCount;
  }

  get totalCalls() {
    return this.count;
  }

  private track() {
    if (this.count >= this.limit) {
      throw new BudgetExceededError(this.limit);
    }
    this.count += 1;
  }

  consume(_kind?: "generation" | "validation"): void {
    this.track();
  }
}
