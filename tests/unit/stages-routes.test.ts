import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../src/db/client";
import { docs, designs, sessions, type StageName } from "../../src/db/schema";
import { createApp, type NextRequestHandler } from "../../src/server";

const noopNextHandler: NextRequestHandler = async (_req, res) => {
  res.statusCode = 404;
  res.end();
};

const app = createApp({ nextHandler: noopNextHandler, dev: true });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("stage routes", () => {
  it("rejects invalid stage names", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/stages/unknown/approve"
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects approvals for stages that are not active", async () => {
    const session = await createSession();
    await setDocContent(session.sessionId, "idea_one_pager.md", requiredSections());

    const response = await postStage(session.cookie, "spec");

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("STAGE_MISMATCH");
  });

  it("fails intake validation when idea_one_pager.md is empty", async () => {
    const session = await createSession();
    const response = await postStage(session.cookie, "intake");

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ ok: false });
    expect(response.json().reasons[0]).toContain("idea_one_pager.md");
  });

  it("approves intake stage, locks doc, and advances to spec", async () => {
    const session = await createSession();
    await setDocContent(session.sessionId, "idea_one_pager.md", requiredSections());

    const response = await postStage(session.cookie, "intake");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const dbSession = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, session.sessionId)
    });
    expect(Boolean(dbSession?.approvedIntake)).toBe(true);
    expect(dbSession?.currentStage).toBe("spec");

    const ideaDoc = await db.query.docs.findFirst({
      where: (table, { and }) =>
        and(eq(table.sessionId, session.sessionId), eq(table.name, "idea_one_pager.md"))
    });
    expect(Boolean(ideaDoc?.approved)).toBe(true);
  });

  it("requires designs before approving the design stage", async () => {
    const session = await createSession();
    await setSessionStage(session.sessionId, "design");

    const failure = await postStage(session.cookie, "design");
    expect(failure.statusCode).toBe(422);
    expect(failure.json().reasons[0]).toContain("designs");

    await db.insert(designs).values({
      sessionId: session.sessionId,
      path: "1-Landing.png",
      size: 123,
      contentType: "image/png",
      sha256: "abc123",
      data: Buffer.from("png")
    });

    const success = await postStage(session.cookie, "design");
    expect(success.statusCode).toBe(200);
    expect(success.json()).toEqual({ ok: true });

    const dbSession = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, session.sessionId)
    });
    expect(Boolean(dbSession?.approvedDesign)).toBe(true);
    expect(dbSession?.currentStage).toBe("prompt_plan");
  });

  it("approves agents stage and advances to export", async () => {
    const session = await createSession();
    await setSessionStage(session.sessionId, "agents");
    await setDocContent(session.sessionId, "AGENTS.md", "## Agent responsibility\n- Keep TODOs in sync.");

    const response = await postStage(session.cookie, "agents");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const dbSession = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, session.sessionId)
    });
    expect(Boolean(dbSession?.approvedAgents)).toBe(true);
    expect(dbSession?.currentStage).toBe("export");
  });
});

async function createSession() {
  const response = await app.inject({ method: "POST", url: "/api/session/init" });
  const { session_id } = response.json<{ session_id: string }>();
  return { cookie: response.headers["set-cookie"] as string, sessionId: session_id };
}

async function postStage(cookie: string, stage: string) {
  return app.inject({
    method: "POST",
    url: `/api/stages/${stage}/approve`,
    headers: { cookie }
  });
}

async function setDocContent(sessionId: string, name: string, content: string) {
  await db
    .update(docs)
    .set({ content })
    .where(and(eq(docs.sessionId, sessionId), eq(docs.name, name as any)));
}

async function setSessionStage(sessionId: string, stage: StageName) {
  await db
    .update(sessions)
    .set({ currentStage: stage })
    .where(eq(sessions.sessionId, sessionId));
}

function requiredSections() {
  return [
    "## Problem",
    "## Audience",
    "## Platform",
    "## Core Flow",
    "## MVP Features"
  ].join("\n\n");
}
