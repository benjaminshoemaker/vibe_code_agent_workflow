import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createAbortController, generateResponse } from "../../libs/openai";
import { SESSION_COOKIE_NAME } from "../../utils/session-cookie";

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

      closeStream();
    } catch (error: any) {
      if (isAbortError(error)) {
        closeStream();
        return;
      }

      if (isTimeoutError(error)) {
        sendNeedsMore({ stage: request.body.stage, reason: "TIMEOUT" });
        closeStream();
        return;
      }

      app.log.error({ err: error }, "chat stream failed");
      sendNeedsMore({ stage: request.body.stage, reason: "SERVER_ERROR" });
      closeStream();
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
