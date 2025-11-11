import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createAbortController, generateResponse, type OpenAIResponseInput } from "../../libs/openai";
import { SESSION_COOKIE_NAME } from "../../utils/session-cookie";
import { runStage } from "../../services/orchestrator";
import { db } from "../../db/client";
import { chatMessages, docs, stageNames, type StageName } from "../../db/schema";

type ChatMessageRow = typeof chatMessages.$inferSelect;

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
const READY_TO_COMPILE_SPEC_FLAG = "READY_TO_COMPILE_SPEC";
const SPEC_GREETING = "Thank you for providing idea_one_pager.md. I'm going to walk you through questions to create a developer-ready specification.";
const INTAKE_ASSISTANT_PROMPT = [
  "Ask me one question at a time so we can develop a one-pager for this idea. Each question should build on the previous ones, and the end goal is a one-pager description of the idea that I could pass to a product manager. We need to gather at least the following:",
  "- What problem does the app solve?",
  "- Who is the ideal user for this app?",
  "- What platform(s) does it live on (mobile web, mobile app, web, CLI)?",
  "- Describe the core user experience, step-by-step.",
  "- What are the must-have features for the MVP?",
  "",
  "The user will provide an initial description of their app. Evaluate that, and then ask them one question at a time until we have enough detail to answer the questions above & create a one-pager description of the app. If you can infer an answer from the initial idea input or the conversation, no need to ask a question about it. Let's do this iteratively.",
  "",
  "IMPORTANT:",
  "- When you believe we have enough detail to draft, prompt the user for permission and end that message with the exact text 'READY_TO_DRAFT' on its own line.",
  "- Never draft the one-pager yourself. Wait for the user to explicitly say they want the draft. Once they do, acknowledge it (even if they ask before you emit READY_TO_DRAFT) and move them toward approval.",
  READY_TO_DRAFT_FLAG
].join("\n");
const STAGE_READY_FLAGS: Partial<Record<StageName, string>> = {
  intake: READY_TO_DRAFT_FLAG,
  spec: READY_TO_COMPILE_SPEC_FLAG
};

function buildSpecAssistantPrompt(ideaDoc?: string) {
  const ideaSource = ideaDoc?.trim() ? ideaDoc.trim() : "idea_one_pager.md is empty. Ask clarifying questions so we can fill it in.";
  return [
    SPEC_GREETING,
    "",
    "Ask me one question at a time so we can develop a thorough, step-by-step spec for this idea. Each question should build on my previous answers, and our end goal is to have a detailed specification I can hand off to a developer. Let's do this iteratively and dig into every relevant detail. If you can infer an answer from the initial idea input, no need to ask a question about it. Remember, only one question at a time.",
    "",
    "Here's the idea:",
    ideaSource,
    "",
    "Guidelines:",
    "- Start your first reply with the greeting above, then dive into the first question.",
    "- Only ask a new question if the idea or my latest answer doesn't already cover it.",
    "- Keep referencing the idea input whenever it already answers the question.",
    "- When you have enough detail to compile the spec, prompt the user for permission and end that prompt with 'READY_TO_COMPILE_SPEC' on its own line.",
    "- Wait for the operator to explicitly say they want the spec compiled (they might do this before you emit the flag). Once they do, acknowledge it and move them toward hand-off. Do not write the spec inside the chat interface."
  ].join("\n");
}

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
    const stageReadyFlag = validStage ? STAGE_READY_FLAGS[validStage] : undefined;
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
    const stageRequiresConfirmation = enableBridge && !!stageReadyFlag;
    const runStageImmediately = enableBridge && !!validStage && !stageRequiresConfirmation;

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

      let specPrompt: string | undefined;
      if (validStage === "spec") {
        const ideaDoc = await db.query.docs.findFirst({
          where: (table, { and, eq }) => and(eq(table.sessionId, sessionId), eq(table.name, "idea_one_pager.md")),
          columns: { content: true }
        });
        specPrompt = buildSpecAssistantPrompt(ideaDoc?.content ?? "");
      }

      const openAiInput: OpenAIResponseInput = [];
      if (validStage === "intake") {
        openAiInput.push({ role: "system", content: INTAKE_ASSISTANT_PROMPT, type: "message" });
      }
      if (validStage === "spec" && specPrompt) {
        openAiInput.push({ role: "system", content: specPrompt, type: "message" });
      }

      if (stageRequiresConfirmation && validStage && shouldTriggerStageRun(validStage, allMessages, stageReadyFlag)) {
        orchestratorPromise = startOrchestrator();
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
          const outbound = stripReadyFlag(segment, stageReadyFlag);
          if (!reply.raw.closed && outbound) {
            reply.raw.write(formatEvent("assistant.delta", outbound));
          }
        }
      }

      if (!assistantTranscript.trim()) {
        const fallbackSegments = extractOutputTextSegments(response);
        for (const segment of fallbackSegments) {
          assistantTranscript += segment;
          const outbound = stripReadyFlag(segment, stageReadyFlag);
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

function stripReadyFlag(text: string, flag?: string) {
  if (!flag) return text;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== flag);
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}

function shouldTriggerStageRun(stage: StageName, messages: ChatMessageRow[], readyFlag?: string) {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return false;
  const text = normalizeUserText(last.content);
  if (!text) return false;

  if (isStrongDraftCommand(stage, text)) {
    return true;
  }

  if (!readyFlag) return false;
  if (!AFFIRMATIVE_RESPONSE_PATTERN.test(text)) {
    return false;
  }
  return assistantRecentlyPrompted(messages.slice(0, -1), readyFlag);
}

function isStrongDraftCommand(stage: StageName, text: string) {
  if (!DRAFT_VERB_PATTERN.test(text)) return false;
  if (stage === "intake") {
    return ONE_PAGER_PATTERN.test(text);
  }
  if (stage === "spec") {
    return SPEC_PATTERN.test(text) || text.includes("spec md") || text.includes("spec doc");
  }
  return true;
}

function assistantRecentlyPrompted(messages: ChatMessageRow[], flag: string) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "assistant") {
      return msg.content?.includes(flag) ?? false;
    }
    if (msg.role === "user") {
      continue;
    }
  }
  return false;
}

function normalizeUserText(text?: string | null) {
  return (text ?? "").trim().toLowerCase();
}

const DRAFT_VERB_PATTERN = /(draft|generate|write|create|produce|compile|make)/i;
const ONE_PAGER_PATTERN = /(one[\s-]?pager|idea\s+one\s+pager|idea\s+doc|one\s+pager|idea\s+document|doc|document)/i;
const SPEC_PATTERN = /(spec\b|specification|spec doc|spec md)/i;
const AFFIRMATIVE_RESPONSE_PATTERN = /(\b(yes|yep|yeah|y|sure|ok|okay|sounds good|please do|do it|go ahead|absolutely|let's do it|please)\b)/i;

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
