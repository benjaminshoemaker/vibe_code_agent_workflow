import { describe, expect, it, beforeEach, afterEach, vi, type Mock } from "vitest";
import { randomUUID } from "node:crypto";
import { runStage } from "../../src/services/orchestrator";
import { db } from "../../src/db/client";
import { chatMessages, docs, docNames, sessions } from "../../src/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("../../src/libs/openai", () => {
  const generateResponse = vi.fn();
  return { generateResponse };
});

const { generateResponse } = await import("../../src/libs/openai");
const SPEC_COMPILE_PROMPT =
  "Now that we've wrapped up the brainstorming process, can you compile our findings into a comprehensive, developer-ready specification? Include all relevant requirements, architecture choices, data handling details, error handling strategies, and a testing plan so a developer can immediately begin implementation.";

describe("Stage writers integration", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = await seedSessionWithIdea();
  });

  afterEach(async () => {
    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  });

  it("populates intake → spec docs", async () => {
    mockLLMResponse(`# Idea Overview

## Summary
The product keeps multi-stage plans organized.

## Problem
Operators juggle too many documents.

## Audience
Founders and ops leads.

## Platform
Responsive web application.

## Core Flow
Interview via chat, capture docs, approve each stage.

## MVP Features
Chat, docs, approvals.

## Non-Goals
Mobile apps in the MVP.`);

    let result = await runStage({ sessionId, stage: "intake" });
    expect(result.status).toBe("ready");
    const ideaDoc = await readDoc(sessionId, "idea_one_pager.md");
    expect(ideaDoc).toMatch(/## Problem/);

    result = await runStage({ sessionId, stage: "spec" });
    expect(result.status).toBe("ready");
    const specDoc = await readDoc(sessionId, "spec.md");
    expect(specDoc).toMatch(/Definition of Done/i);
  });

  it("uses intake Q&A responses to craft idea_one_pager.md sections", async () => {
    await db.insert(chatMessages).values([
      {
        sessionId,
        stage: "intake",
        role: "assistant",
        content: "What's the core problem you're solving?"
      },
      {
        sessionId,
        stage: "intake",
        role: "user",
        content: "Freelancers bounce between spreadsheets and Slack when pitching climate projects."
      },
      {
        sessionId,
        stage: "intake",
        role: "assistant",
        content: "Who is the ideal audience?"
      },
      {
        sessionId,
        stage: "intake",
        role: "user",
        content: "RevOps leads at climate-focused Series A startups and their marketing contractors."
      },
      {
        sessionId,
        stage: "intake",
        role: "assistant",
        content: "Walk me through the core flow."
      },
      {
        sessionId,
        stage: "intake",
        role: "user",
        content: "They outline a playbook, assign tasks, and review AI-generated one pagers."
      },
      {
        sessionId,
        stage: "intake",
        role: "assistant",
        content: "Which platform will you target first?"
      },
      {
        sessionId,
        stage: "intake",
        role: "user",
        content: "Responsive web first with Slack notifications for approvals."
      },
      {
        sessionId,
        stage: "intake",
        role: "assistant",
        content: "List the must-have MVP features."
      },
      {
        sessionId,
        stage: "intake",
        role: "user",
        content: "Shared kanban, AI suggestions, and a resumable export summary."
      }
    ]);

    mockLLMResponse(`# Idea Overview

## Summary
Freelancers finally get a shared workspace for climate project pitches, replacing scattered chats and sheets.

## Problem
Freelancers bounce between spreadsheets and Slack when pitching climate projects, so briefs get lost and approvals stall.

## Audience
RevOps leads at climate-focused Series A startups plus their marketing contractors collaborating across time zones.

## Platform
Responsive web with Slack notifications for approvals and nudges.

## Core Flow
Teams outline a playbook, assign tasks, gather AI one-pagers, and approve exports directly from the shared board.

## MVP Features
Shared kanban, AI suggestions, resumable export summary, and Slack-based approvals.

## Non-Goals
Native mobile apps or channel-specific automation in v1.`);

    const result = await runStage({ sessionId, stage: "intake" });
    expect(result.status).toBe("ready");

    const ideaDoc = await readDoc(sessionId, "idea_one_pager.md");
    expect(ideaDoc).toContain("Freelancers bounce between spreadsheets and Slack");
    expect(ideaDoc).toContain("RevOps leads at climate-focused Series A startups");
    expect(ideaDoc).toContain("Responsive web with Slack notifications for approvals and nudges.");
    expect(ideaDoc).not.toContain("Session:");
  });

  it("compiles spec.md from the transcript using the provided prompt", async () => {
    vi.clearAllMocks();
    await db
      .update(docs)
      .set({ content: seededOnePager() })
      .where(and(eq(docs.sessionId, sessionId), eq(docs.name, "idea_one_pager.md")));

    await db.insert(chatMessages).values([
      {
        sessionId,
        stage: "spec",
        role: "assistant",
        content: "Thank you for providing idea_one_pager.md. I'm going to walk you through questions to create a developer-ready specification."
      },
      {
        sessionId,
        stage: "spec",
        role: "user",
        content: "We need multi-tenant RBAC with audit trails."
      },
      {
        sessionId,
        stage: "spec",
        role: "assistant",
        content: "How should we persist conversations and docs?"
      },
      {
        sessionId,
        stage: "spec",
        role: "user",
        content: "Store everything in Turso via Drizzle with soft deletes."
      }
    ]);

    mockLLMResponse(`# Functional Spec

## Summary
- Multi-tenant RBAC with audit logs.

## Definition of Done
- Docs, chat, and approvals wired.
`);

    const result = await runStage({ sessionId, stage: "spec" });
    expect(result.status).toBe("ready");
    const specDoc = await readDoc(sessionId, "spec.md");
    expect(specDoc).toContain("Functional Spec");
    expect(specDoc).toMatch(/Multi-tenant RBAC/i);
    expect(specDoc).toContain("## Intake Reference");

    const lastCall = (generateResponse as Mock).mock.calls.at(-1)?.[0];
    expect(lastCall?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: SPEC_COMPILE_PROMPT, type: "message" })
      ])
    );
  });
});

async function seedSessionWithIdea() {
  const sessionId = randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    sessionId,
    currentStage: "intake",
    approvedIntake: false,
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
    stage: "intake",
    role: "user",
    content: "I want to build an agent-ready planner that tracks seven validation stages."
  });

  return sessionId;
}

async function readDoc(sessionId: string, name: "idea_one_pager.md" | "spec.md") {
  const row = await db.query.docs.findFirst({
    where: (table, { and }) => and(eq(table.sessionId, sessionId), eq(table.name, name))
  });
  return row?.content ?? "";
}

function seededOnePager() {
  return `# Idea Overview

## Summary
Planner keeps seven stages organized.

## Problem
Specs drift from intake context.

## Audience
Operators shepherding approvals.

## Platform
Responsive web first.

## Core Flow
Chat -> docs -> approvals -> export.

## MVP Features
Chat, docs, approvals, export.

## Non-Goals
Native mobile apps in v1.`;
}

function mockLLMResponse(text: string) {
  (generateResponse as Mock).mockResolvedValueOnce({
    output: [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "output_text", text }]
        }
      }
    ],
    output_text: [text]
  });
}
