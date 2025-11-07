import fp from "fastify-plugin";
import type { FastifyPluginCallback } from "fastify";

const errorHandlerPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.setErrorHandler((error, request, reply) => {
    if (request.raw.aborted || request.raw.destroyed) {
      reply.status(499).send({ error: "CLIENT_CLOSED_REQUEST" });
      return;
    }

    const statusCode = (error as any)?.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      let code = "BAD_REQUEST";
      if (statusCode === 401) code = "UNAUTHORIZED";
      else if (statusCode === 404) code = "NOT_FOUND";
      else if (statusCode === 413) code = "PAYLOAD_TOO_LARGE";
      else if (statusCode === 415) code = "UNSUPPORTED_MEDIA_TYPE";
      reply.status(statusCode).send({ error: code });
      return;
    }

    app.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  done();
};

export default fp(errorHandlerPlugin, { name: "error-handler" });
