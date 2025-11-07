import fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import next from "next";
import type { NextServer } from "next/dist/server/next";
import { env } from "./env";
import securityHeadersPlugin from "./plugins/security";
import errorHandlerPlugin from "./plugins/error-handler";
import sessionRoutes from "./routes/api/session";
import docsRoutes from "./routes/api/docs";
import stagesRoutes from "./routes/api/stages";
import chatRoutes from "./routes/api/chat";
import designsRoutes from "./routes/api/designs";

export type NextRequestHandler = ReturnType<NextServer["getRequestHandler"]>;

type CreateAppOptions = {
  nextHandler: NextRequestHandler;
  dev: boolean;
};

const isApiRoute = (path?: string) => path?.startsWith("/api");

export function createApp({ nextHandler, dev }: CreateAppOptions): FastifyInstance {
  const app = fastify({
    logger: {
      level: dev ? "info" : "warn"
    }
  });

  app.register(fastifyCookie);
  app.register(securityHeadersPlugin);
  app.register(errorHandlerPlugin);
  app.register(sessionRoutes);
  app.register(docsRoutes);
  app.register(stagesRoutes);
  app.register(designsRoutes);
  app.register(chatRoutes);

  app.get("/api/health", async (_, reply) => {
    return reply.send({ ok: true });
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/*",
    handler: async (request, reply) => {
      const requestPath = request.raw.url ?? request.url ?? "";
      if (isApiRoute(requestPath)) {
        return reply.callNotFound();
      }

      await nextHandler(request.raw, reply.raw);
      reply.hijack();
    }
  });

  return app;
}

export type BuiltServer = {
  app: FastifyInstance;
  nextApp: NextServer;
};

export async function buildServer(): Promise<BuiltServer> {
  const dev = env.NODE_ENV !== "production";
  const nextApp = next({ dev, dir: "." });
  await nextApp.prepare();
  const app = createApp({ nextHandler: nextApp.getRequestHandler(), dev });
  return { app, nextApp };
}

export async function start() {
  const { app, nextApp } = await buildServer();
  const port = env.PORT ?? 3000;
  const host = env.HOST ?? "0.0.0.0";

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down server...");
    try {
      await app.close();
      await nextApp.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await app.listen({ port, host });
    app.log.info(`Server ready on http://${host}:${port}`);
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
