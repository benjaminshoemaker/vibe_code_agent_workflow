import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { and, eq } from "drizzle-orm";
import { stageNames, sessions, docs, type StageName, type DocName } from "../../db/schema";
import { db } from "../../db/client";
import { SESSION_COOKIE_NAME, setSessionCookie } from "../../utils/session-cookie";
import { validateStage } from "../../validators/stage-validator";
import { orchestrator } from "../../services/orchestrator";

const stageDocMap: Partial<Record<StageName, DocName>> = {
  intake: "idea_one_pager.md",
  spec: "spec.md",
  prompt_plan: "prompt_plan.md",
  agents: "AGENTS.md"
};

const stagesRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post<{ Params: { stage: string } }>("/api/stages/:stage/approve", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const stage = request.params.stage as StageName;
    if (!stageNames.includes(stage)) {
      return reply.code(400).send({ error: "INVALID_STAGE" });
    }

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, sessionId)
    });

    if (!session) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    if ((session.currentStage as StageName) !== stage) {
      setSessionCookie(reply, sessionId);
      return reply.code(409).send({ error: "STAGE_MISMATCH" });
    }

    // Re-ingest context right before validation per spec
    try {
      await orchestrator.refreshContext({ sessionId, stage, phase: "pre_validation" });
    } catch (err) {
      request.log.warn({ err }, "refreshContext failed before validation");
    }

    const validation = await validateStage(sessionId, stage);
    if (!validation.ok) {
      setSessionCookie(reply, sessionId);
      return reply.code(422).send(validation);
    }

    await db.transaction(async (tx) => {
      const docName = stageDocMap[stage];
      if (docName) {
        await tx
          .update(docs)
          .set({ approved: true, updatedAt: Date.now() })
          .where(and(eq(docs.sessionId, sessionId), eq(docs.name, docName)));
      }

      await tx
        .update(sessions)
        .set(buildSessionUpdates(stage))
        .where(eq(sessions.sessionId, sessionId));
    });

    setSessionCookie(reply, sessionId);
    return reply.send({ ok: true });
  });

  done();
};

function buildSessionUpdates(stage: StageName): Partial<typeof sessions.$inferInsert> {
  const updates: Partial<typeof sessions.$inferInsert> = {
    lastActivity: Date.now(),
    currentStage: nextStage(stage)
  };

  switch (stage) {
    case "intake":
      updates.approvedIntake = true;
      break;
    case "spec":
      updates.approvedSpec = true;
      break;
    case "design":
      updates.approvedDesign = true;
      break;
    case "prompt_plan":
      updates.approvedPromptPlan = true;
      break;
    case "agents":
      updates.approvedAgents = true;
      break;
    default:
      break;
  }

  return updates;
}

function nextStage(stage: StageName): StageName {
  const index = stageNames.indexOf(stage);
  return stageNames[index + 1] ?? stage;
}

export default fp(stagesRoutes, { name: "stages-routes" });
