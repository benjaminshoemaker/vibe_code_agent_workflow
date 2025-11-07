import fp from "fastify-plugin";
import type { FastifyPluginCallback } from "fastify";

const errorHandlerPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.setErrorHandler((error, request, reply) => {
    if (request.raw.aborted || request.raw.destroyed) {
      reply.status(499).send({ error: "CLIENT_CLOSED_REQUEST" });
      return;
    }

    app.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  done();
};

export default fp(errorHandlerPlugin, { name: "error-handler" });
