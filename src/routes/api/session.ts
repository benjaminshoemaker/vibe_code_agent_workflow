import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { chatMessages, designs, docNames, docs, sessions } from "../../db/schema";
import { createSessionId, setSessionCookie, SESSION_COOKIE_NAME } from "../../utils/session-cookie";

type SessionResponse = {
  current_stage: string;
  approved: Record<string, boolean>;
  docs: string[];
  designs_count: number;
};

const sessionRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post("/api/session/init", async (request, reply) => {
    const sessionId = createSessionId();
    const now = Date.now();

    await db.transaction(async (tx) => {
      await tx.insert(sessions).values({
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

      await tx.insert(docs).values(
        docNames.map((name) => ({
          sessionId,
          name,
          content: "",
          approved: false,
          updatedAt: now
        }))
      );

      await tx.insert(chatMessages).values({
        sessionId,
        role: "assistant",
        content: "Welcome! Start with the intake stage when you're ready."
      });
    });

    setSessionCookie(reply, sessionId);
    reply.code(201).send({ session_id: sessionId });
  });

  app.get("/api/session", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, sessionId)
    });

    if (!session) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    await db.update(sessions).set({ lastActivity: Date.now() }).where(eq(sessions.sessionId, sessionId));

    setSessionCookie(reply, sessionId);

    const [docRows, designCount] = await Promise.all([
      db.query.docs.findMany({
        where: eq(docs.sessionId, sessionId),
        columns: { name: true }
      }),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(designs)
        .where(eq(designs.sessionId, sessionId))
        .then((rows) => rows[0]?.count ?? 0)
    ]);

    const response: SessionResponse = {
      current_stage: session.currentStage,
      approved: {
        intake: !!session.approvedIntake,
        spec: !!session.approvedSpec,
        design: !!session.approvedDesign,
        prompt_plan: !!session.approvedPromptPlan,
        agents: !!session.approvedAgents
      },
      docs: docRows.map((doc) => doc.name),
      designs_count: designCount
    };

    reply.send(response);
  });

  done();
};

export default fp(sessionRoutes, { name: "session-routes" });
