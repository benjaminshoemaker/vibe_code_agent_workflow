import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createAbortController, generateResponse } from "../../libs/openai";
import { SESSION_COOKIE_NAME } from "../../utils/session-cookie";
import { runStage } from "../../services/orchestrator";
import { stageNames, type StageName } from "../../db/schema";

type ChatRequestBody = {
  message: string;
  stage: string;
};

type NeedsMorePayload = {
  stage: string;
  reason: string;
};

export const CHAT_KEEPALIVE_MS = 15_000;

const chatRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post<{ Body: ChatRequestBody }>("/api/chat", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const abortController = createAbortController();

    // Write initial keepalive to establish connection
    reply.raw.write(":keepalive\n\n");

    const keepalive = setInterval(() => {
      if (!reply.raw.closed) {
        reply.raw.write(":keepalive\n\n");
      }
    }, CHAT_KEEPALIVE_MS);

    let closed = false;

    const closeStream = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      if (!reply.raw.closed) {
        reply.raw.end();
      }
    };

    const sendNeedsMore = (payload: NeedsMorePayload) => {
      if (!reply.raw.closed) {
        reply.raw.write(formatEvent("stage.needs_more", payload));
      }
    };

    const handleClientAbort = () => {
      abortController.abort();
      closeStream();
    };

    request.raw.on("aborted", handleClientAbort);

    const enableBridge = process.env.NODE_ENV !== "test";
    const stageParam = request.body.stage as string;
    const validStage = (stageNames as readonly string[]).includes(stageParam)
      ? (stageParam as StageName)
      : undefined;

    const orchestratorPromise = enableBridge && validStage
      ? runStage({
          sessionId,
          stage: validStage,
          onEvent: (event) => {
            if (reply.raw.closed) return;
            switch (event.event) {
              case "assistant.delta": {
                const data = typeof event.data === "string" ? event.data : String(event.data ?? "");
                reply.raw.write(formatEvent("assistant.delta", data));
                break;
              }
              case "doc.updated": {
                const name = (event as any).data?.name;
                if (typeof name === "string" && name) {
                  reply.raw.write(formatEvent("doc.updated", name));
                }
                break;
              }
              case "stage.ready": {
                const stage = (event as any).data?.stage;
                if (typeof stage === "string" && stage) {
                  reply.raw.write(formatEvent("stage.ready", stage));
                }
                break;
              }
              case "stage.needs_more": {
                // Preserve JSON payload shape for needs_more
                reply.raw.write(formatEvent("stage.needs_more", event.data));
                break;
              }
              default:
                break;
            }
          }
        }).catch((err) => {
          request.log.error({ err }, "orchestrator.runStage failed");
        })
      : Promise.resolve();

    try {
      const response = await generateResponse({
        input: [{ role: "user", content: request.body.message }],
        abortSignal: abortController.signal
      });

      for (const output of response.output ?? []) {
        const segments = extractAssistantSegments(output);
        for (const segment of segments) {
          if (!reply.raw.closed) {
            reply.raw.write(formatEvent("assistant.delta", segment));
          }
        }
      }

      await Promise.resolve(orchestratorPromise);
      closeStream();
    } catch (error: any) {
      if (isAbortError(error)) {
        try {
          await Promise.resolve(orchestratorPromise);
        } finally {
          closeStream();
        }
        return;
      }

      if (isTimeoutError(error)) {
        sendNeedsMore({ stage: request.body.stage, reason: "TIMEOUT" });
        try {
          await Promise.resolve(orchestratorPromise);
        } finally {
          closeStream();
        }
        return;
      }

      app.log.error({ err: error }, "chat stream failed");
      sendNeedsMore({ stage: request.body.stage, reason: "SERVER_ERROR" });
      try {
        await Promise.resolve(orchestratorPromise);
      } finally {
        closeStream();
      }
    }
  });

  done();
};

function isTimeoutError(error: any) {
  return error?.status === 408 || error?.code === "ETIMEDOUT" || error?.name === "TimeoutError";
}

function isAbortError(error: any) {
  return (
    error?.name === "AbortError" ||
    error?.name === "APIUserAbortError" ||
    error?.type === "APIUserAbortError"
  );
}

function formatEvent(event: string, data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

type OutputContent = Array<{ type: string; text: string }>;

type MessageLike = {
  role: string;
  content: OutputContent;
};

function extractAssistantSegments(output: any) {
  const segments: string[] = [];
  const message = getAssistantMessage(output);
  if (!message) {
    return segments;
  }

  for (const content of message.content) {
    if (content?.type === "output_text" && content?.text) {
      segments.push(content.text);
    }
  }
  return segments;
}

function getAssistantMessage(output: any): MessageLike | undefined {
  if (output?.type !== "message") {
    return undefined;
  }

  if (output?.message?.role === "assistant") {
    return output.message as MessageLike;
  }

  if (output?.role === "assistant" && Array.isArray(output?.content)) {
    return { role: output.role, content: output.content } as MessageLike;
  }

  return undefined;
}

export default fp(chatRoutes, { name: "chat-routes" });
