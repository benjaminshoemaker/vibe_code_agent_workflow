import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { runStage } from "../../src/services/orchestrator";
import { db } from "../../src/db/client";
import { chatMessages, docs, docNames, sessions } from "../../src/db/schema";
import { and, eq } from "drizzle-orm";

describe("Stage writers integration", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = await seedSessionWithIdea();
  });

  afterEach(async () => {
    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  });

  it("populates intake → one_pager → spec docs", async () => {
    let result = await runStage({ sessionId, stage: "intake" });
    expect(result.status).toBe("ready");
    const ideaDoc = await readDoc(sessionId, "idea.md");
    expect(ideaDoc).toMatch(/## Problem/);

    result = await runStage({ sessionId, stage: "one_pager" });
    expect(result.status).toBe("ready");
    const onePagerDoc = await readDoc(sessionId, "idea_one_pager.md");
    expect(onePagerDoc).toMatch(/## MVP Features/);

    result = await runStage({ sessionId, stage: "spec" });
    expect(result.status).toBe("ready");
    const specDoc = await readDoc(sessionId, "spec.md");
    expect(specDoc).toMatch(/Definition of Done/i);
  });
});

async function seedSessionWithIdea() {
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
    content: "I want to build an agent-ready planner that tracks seven validation stages."
  });

  return sessionId;
}

async function readDoc(sessionId: string, name: "idea.md" | "idea_one_pager.md" | "spec.md") {
  const row = await db.query.docs.findFirst({
    where: (table, { and }) => and(eq(table.sessionId, sessionId), eq(table.name, name))
  });
  return row?.content ?? "";
}
