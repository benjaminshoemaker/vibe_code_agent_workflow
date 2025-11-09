import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { designs, docs } from "../../db/schema";
import { SESSION_COOKIE_NAME } from "../../utils/session-cookie";
import { buildManifest, createZipStream } from "../../utils/export";

const exportRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post("/api/export/zip", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const [docRows, designRows] = await Promise.all([
      db.query.docs.findMany({ where: eq(docs.sessionId, sessionId), columns: { name: true, content: true } }),
      db.query.designs.findMany({
        where: eq(designs.sessionId, sessionId),
        columns: { path: true, size: true, contentType: true, sha256: true, data: true }
      })
    ]);

    const manifest = buildManifest(docRows, designRows);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/zip",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename=export-${sessionId}.zip`
    });

    const { stream, finalize } = createZipStream({ docs: docRows, designs: designRows, manifest });
    stream.on("error", () => {
      if (!reply.raw.closed) reply.raw.end();
    });
    stream.on("end", () => {
      if (!reply.raw.closed) reply.raw.end();
    });
    stream.pipe(reply.raw);
    finalize();
  });

  done();
};

export default fp(exportRoutes, { name: "export-routes" });

