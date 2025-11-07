import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/client";
import { docs } from "../../db/schema";
import { SESSION_COOKIE_NAME, setSessionCookie } from "../../utils/session-cookie";
import { orchestrator } from "../../services/orchestrator";

const docsRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get<{ Params: { name: string } }>("/api/docs/:name", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const doc = await db.query.docs.findFirst({
      where: (table) =>
        and(eq(table.sessionId, sessionId), eq(table.name, request.params.name as any))
    });

    if (!doc) {
      return reply.code(404).send({ error: "DOC_NOT_FOUND" });
    }

    setSessionCookie(reply, sessionId);
    return reply.send({ name: doc.name, content: doc.content, approved: !!doc.approved });
  });

  app.put<{ Params: { name: string }; Body: { content: string } }>(
    "/api/docs/:name",
    async (request, reply) => {
      const sessionId = request.cookies[SESSION_COOKIE_NAME];
      if (!sessionId) {
        return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
      }

      const doc = await db.query.docs.findFirst({
        where: (table) =>
          and(eq(table.sessionId, sessionId), eq(table.name, request.params.name as any))
      });

      if (!doc) {
        return reply.code(404).send({ error: "DOC_NOT_FOUND" });
      }

      if (doc.approved) {
        return reply.code(409).send({ error: "DOC_APPROVED" });
      }

      await db
        .update(docs)
        .set({ content: request.body.content, updatedAt: Date.now() })
        .where(and(eq(docs.sessionId, sessionId), eq(docs.name, doc.name)));

      await orchestrator.reingest({ sessionId, docName: doc.name });
      setSessionCookie(reply, sessionId);
      return reply.send({ ok: true });
    }
  );

  done();
};

export default fp(docsRoutes, { name: "docs-routes" });
