import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { StageDriver } from "../../src/orchestrator/types";
import { runStage } from "../../src/services/orchestrator";
import { db } from "../../src/db/client";
import { chatMessages, docs, docNames, sessions } from "../../src/db/schema";

describe("LangGraph stage orchestrator", () => {
  it("runs writers, emits doc.updated + stage.ready, and respects re-ingest policy", async () => {
    const events: string[] = [];
    const reingestPhases: string[] = [];
    const sessionId = await seedSession();

    const result = await runStage({
      sessionId,
      stage: "intake",
      onEvent: (event) => events.push(event.event),
      reingest: async (payload) => {
        reingestPhases.push(payload.phase);
      }
    });

    expect(result.status).toBe("ready");
    expect(events).toEqual(expect.arrayContaining(["assistant.delta", "doc.updated", "stage.ready"]));
    expect(reingestPhases).toEqual(["stage_start", "pre_validation"]);

    await cleanupSession(sessionId);
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

async function seedSession() {
  const sessionId = randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    sessionId,
    currentStage: "intake",
    approvedIntake: false,
    approvedOnePager: false,
    approvedSpec: false,
    approvedDesign: false,
    approvedPromptPlan: false,
    approvedAgents: false,
    createdAt: now,
    lastActivity: now
  });

  await db.insert(docs).values(
    docNames.map((name) => ({
      sessionId,
      name,
      content: "",
      approved: false,
      updatedAt: now
    }))
  );

  await db.insert(chatMessages).values({
    sessionId,
    role: "user",
    content: "Manual intake summary to seed the writers."
  });

  return sessionId;
}

async function cleanupSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
}
