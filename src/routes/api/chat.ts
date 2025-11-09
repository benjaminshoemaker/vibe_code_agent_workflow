import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createAbortController, generateResponse, type OpenAIResponseInput } from "../../libs/openai";
import { SESSION_COOKIE_NAME } from "../../utils/session-cookie";
import { runStage } from "../../services/orchestrator";
import { db } from "../../db/client";
import { chatMessages, stageNames, type StageName } from "../../db/schema";

type ChatRequestBody = {
  message: string;
  stage: string;
};

type NeedsMorePayload = {
  stage: string;
  reason: string;
};

export const CHAT_KEEPALIVE_MS = 15_000;
const CHAT_MINUTE_LIMIT = 30;
const CHAT_MINUTE_WINDOW_MS = 60_000;
const CHAT_HOUR_LIMIT = 300;
const CHAT_HOUR_WINDOW_MS = 3_600_000;
const READY_TO_DRAFT_FLAG = "READY_TO_DRAFT";
const INTAKE_ASSISTANT_PROMPT = [
  "Ask me one question at a time so we can develop a one-pager for this idea. Each question should build on the previous ones, and the end goal is a one-pager description of the idea that I could pass to a product manager. We need to gather at least the following:",
  "- What problem does the app solve?",
  "- Who is the ideal user for this app?",
  "- What platform(s) does it live on (mobile web, mobile app, web, CLI)?",
  "- Describe the core user experience, step-by-step.",
  "- What are the must-have features for the MVP?",
  "",
  "The user will provide an initial description of their app. Evaluate that, and then ask them one question at a time until we have enough detail to answer the questions above & create a one-pager description of the app. If you can infer an answer from the initial idea input, no need to ask a question about it. Let's do this iteratively.",
  "",
  "IMPORTANT: Once we have enough information, ask the user if they'd like you to draft the one-pager. If they confirm, you MUST end your reply with the exact text 'READY_TO_DRAFT' on its own line. Do NOT write the one-pager yourself - the system will automatically generate it.",
  "",
  "Example:",
  "Assistant: Great! I think we have all the information we need. Would you like me to draft the one-pager now?",
  "User: Yes",
  "Assistant: Perfect! I'll create the one-pager for you now.",
  "",
  READY_TO_DRAFT_FLAG
].join("\n");

const chatRoutes: FastifyPluginCallback = (app, _opts, done) => {
  // Pre-lock concurrent chat streams as early as possible in the lifecycle
  app.addHook("onRequest", (request, reply, next) => {
    const url = request.raw.url || request.url || "";
    if (request.method !== "POST" || !url.startsWith("/api/chat")) return next();
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) return next();
    if (!app.rateLimiter.acquireChat(sessionId)) {
      reply.code(429).header("Retry-After", "1").send({ error: "CHAT_STREAM_ACTIVE" });
      return;
    }
    (request as any).chatLockAcquired = true;
    next();
  });
  app.post<{ Body: ChatRequestBody }>("/api/chat", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    // Rate limit: 30/min, 300/hour per sid; enforce one concurrent stream
    const minute = app.rateLimiter.check(sessionId, "chat:minute", CHAT_MINUTE_LIMIT, CHAT_MINUTE_WINDOW_MS);
    if (!minute.ok) {
      return reply.code(429).header("Retry-After", String(minute.retryAfterSec)).send({ error: "RATE_LIMIT_EXCEEDED" });
    }
    const hour = app.rateLimiter.check(sessionId, "chat:hour", CHAT_HOUR_LIMIT, CHAT_HOUR_WINDOW_MS);
    if (!hour.ok) {
      return reply.code(429).header("Retry-After", String(hour.retryAfterSec)).send({ error: "RATE_LIMIT_EXCEEDED" });
    }
    if (!(request as any).chatLockAcquired) {
      if (!app.rateLimiter.acquireChat(sessionId)) {
        return reply.code(429).header("Retry-After", "1").send({ error: "CHAT_STREAM_ACTIVE" });
      }
      (request as any).chatLockAcquired = true;
    }

    const stageParam = typeof request.body.stage === "string" ? request.body.stage : "";
    const validStage = (stageNames as readonly string[]).includes(stageParam)
      ? (stageParam as StageName)
      : undefined;
    const userMessage = typeof request.body.message === "string" ? request.body.message : "";

    try {
      await db.insert(chatMessages).values({
        sessionId,
        stage: validStage,
        role: "user",
        content: userMessage
      });
    } catch (error) {
      if ((request as any).chatLockAcquired) {
        app.rateLimiter.releaseChat(sessionId);
      }
      throw error;
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
      app.rateLimiter.releaseChat(sessionId);
      app.log.info({ sessionId }, "Chat lock released");
    };

    // Safety net: ensure lock is released if connection closes unexpectedly
    reply.raw.on('close', () => {
      if (!closed) {
        app.log.warn({ sessionId }, "Connection closed unexpectedly, releasing lock");
        closeStream();
      }
    });

    reply.raw.on('error', (err) => {
      app.log.error({ err, sessionId }, "Stream error, releasing lock");
      if (!closed) {
        closeStream();
      }
    });

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
    const deferIntakeBridge = enableBridge && validStage === "intake";
    const runStageImmediately = enableBridge && !!validStage && validStage !== "intake";

    const startOrchestrator = () => {
      if (!enableBridge || !validStage) {
        return Promise.resolve();
      }
      return runStage({
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
              reply.raw.write(formatEvent("stage.needs_more", event.data));
              break;
            }
            default:
              break;
          }
        }
      }).catch((err) => {
        request.log.error({ err }, "orchestrator.runStage failed");
      }).then(() => undefined);
    };

    let orchestratorPromise: Promise<void> = Promise.resolve();
    if (runStageImmediately) {
      orchestratorPromise = startOrchestrator();
    }

    try {
      // Load conversation history for this session and stage (includes the message we just saved)
      const allMessages = await db.query.chatMessages.findMany({
        where: (table, { eq, and }) => and(
          eq(table.sessionId, sessionId),
          validStage ? eq(table.stage, validStage) : eq(table.stage, table.stage)
        ),
        orderBy: (table, { asc }) => [asc(table.createdAt)],
        limit: 100 // Limit to last 100 messages to avoid token limits
      });

      const openAiInput: OpenAIResponseInput = [];
      if (validStage === "intake") {
        openAiInput.push({ role: "system", content: INTAKE_ASSISTANT_PROMPT, type: "message" });
      }

      // Add all conversation history (this includes the message we just saved)
      for (const msg of allMessages) {
        if (msg.role === "user" || msg.role === "assistant") {
          openAiInput.push({
            role: msg.role,
            content: msg.content,
            type: "message"
          });
        }
      }

      const response = await generateResponse({
        input: openAiInput,
        abortSignal: abortController.signal
      });

      let assistantTranscript = "";
      for (const output of response.output ?? []) {
        const segments = extractAssistantSegments(output);
        for (const segment of segments) {
          assistantTranscript += segment;
          const outbound = stripReadyFlag(segment);
          if (!reply.raw.closed && outbound) {
            reply.raw.write(formatEvent("assistant.delta", outbound));
          }
        }
      }

      if (!assistantTranscript.trim()) {
        const fallbackSegments = extractOutputTextSegments(response);
        for (const segment of fallbackSegments) {
          assistantTranscript += segment;
          const outbound = stripReadyFlag(segment);
          if (!reply.raw.closed && outbound) {
            reply.raw.write(formatEvent("assistant.delta", outbound));
          }
        }
      }

      // Save assistant response to database
      if (assistantTranscript.trim()) {
        try {
          await db.insert(chatMessages).values({
            sessionId,
            stage: validStage,
            role: "assistant",
            content: assistantTranscript.trim()
          });
        } catch (error) {
          app.log.error({ err: error }, "Failed to save assistant message");
        }
      }

      if (deferIntakeBridge && containsReadyFlag(assistantTranscript)) {
        orchestratorPromise = startOrchestrator();
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
  const lines = payload.split(/\r?\n/);
  const dataLines = lines.map((line) => `data: ${line}`);
  return `event: ${event}\n${dataLines.join("\n")}\n\n`;
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
    const text = extractTextFromContent(content);
    if (text) {
      segments.push(text);
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

function containsReadyFlag(text: string) {
  return text
    .split(/\r?\n/)
    .some((line) => line.trim() === READY_TO_DRAFT_FLAG);
}

function stripReadyFlag(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== READY_TO_DRAFT_FLAG);
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}

function extractOutputTextSegments(response: any) {
  if (!Array.isArray(response?.output_text)) {
    return [] as string[];
  }
  return response.output_text.filter((text: unknown) => typeof text === "string" && text.trim().length > 0);
}

function extractTextFromContent(content: any) {
  if (!content) return undefined;
  if (typeof content === "string") return content;
  if (typeof content?.text === "string") return content.text;
  if (Array.isArray(content?.text)) {
    return content.text.filter((part: unknown) => typeof part === "string").join("");
  }
  if (typeof content?.value === "string") return content.value;
  if (typeof content?.content === "string") return content.content;
  return undefined;
}

export default fp(chatRoutes, { name: "chat-routes" });
