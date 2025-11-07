import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import { stageNames, sessions } from "../../db/schema";
import { db } from "../../db/client";
import { SESSION_COOKIE_NAME, setSessionCookie } from "../../utils/session-cookie";

const stagesRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post<{ Params: { stage: string } }>("/api/stages/:stage/approve", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const stage = request.params.stage as (typeof stageNames)[number];
    if (!stageNames.includes(stage)) {
      return reply.code(400).send({ error: "INVALID_STAGE" });
    }

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, sessionId)
    });

    if (!session) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    setSessionCookie(reply, sessionId);
    return reply.send({ ok: false, reasons: ["Validator not implemented yet"] });
  });

  done();
};

export default fp(stagesRoutes, { name: "stages-routes" });
