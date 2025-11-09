import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { createApp, type NextRequestHandler } from "../../src/server";
import { CHAT_KEEPALIVE_MS } from "../../src/routes/api/chat";
import { db } from "../../src/db/client";
import { chatMessages } from "../../src/db/schema";

vi.mock("../../src/libs/openai", () => {
  const generateResponse = vi.fn();
  const createAbortController = () => new AbortController();
  return { generateResponse, createAbortController };
});

const { generateResponse } = await import("../../src/libs/openai");

const noopNextHandler: NextRequestHandler = async (_req, res) => {
  res.statusCode = 404;
  res.end();
};

const app = createApp({ nextHandler: noopNextHandler, dev: true });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("/api/chat SSE", () => {
  it("streams assistant delta events (legacy shape)", async () => {
    mockOpenAIResponseLegacy("Hello agent");
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Hi", stage: "intake" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: assistant.delta");
    expect(response.body).toContain("Hello agent");
  });

  it("streams assistant delta events (Responses API shape)", async () => {
    mockOpenAIResponseNewShape("Hello agent 2");
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Hi", stage: "intake" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: assistant.delta");
    expect(response.body).toContain("Hello agent 2");
  });

  it("emits stage.needs_more on OpenAI timeout", async () => {
    (generateResponse as Mock).mockRejectedValueOnce({ status: 408 });
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Hi", stage: "spec" }
    });

    expect(response.body).toContain("event: stage.needs_more");
    expect(response.body).toContain("TIMEOUT");
  });

  it("sends keepalive pings while waiting", async () => {
    vi.useFakeTimers();
    (generateResponse as Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ output: [] }), CHAT_KEEPALIVE_MS * 2);
        })
    );

    const cookie = await createSession();
    const pending = app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Hold", stage: "design" }
    });

    await vi.advanceTimersByTimeAsync(CHAT_KEEPALIVE_MS + 10);
    await vi.advanceTimersByTimeAsync(CHAT_KEEPALIVE_MS * 2);
    const response = await pending;
    expect(response.body).toContain(":keepalive");
    vi.useRealTimers();
  });

  it("silently handles APIUserAbortError by name", async () => {
    (generateResponse as Mock).mockRejectedValueOnce({ name: "APIUserAbortError" });
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "cancel", stage: "design" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(":keepalive\n\n");
  });

  it("silently handles APIUserAbortError by type", async () => {
    (generateResponse as Mock).mockRejectedValueOnce({ type: "APIUserAbortError" });
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "cancel", stage: "design" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(":keepalive\n\n");
  });

  it("limits one concurrent chat stream per sid", async () => {
    const cookie = await createSession();
    // Extract sid from Set-Cookie header to pre-acquire chat lock
    const sid = extractSessionId(cookie as string);
    // Manually acquire lock to simulate an active stream
    expect(app.rateLimiter.acquireChat(sid)).toBe(true);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "again", stage: "intake" }
    });
    expect(blocked.statusCode).toBe(429);

    // Release lock for hygiene
    app.rateLimiter.releaseChat(sid);
  });

  it("persists intake user messages before streaming", async () => {
    mockOpenAIResponseLegacy("Tell me more about the audience.");
    const cookie = await createSession();
    const sessionId = extractSessionId(cookie as string);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "It helps indie hackers plan faster.", stage: "intake" }
    });

    const latestMessage = await db.query.chatMessages.findFirst({
      where: (table) => and(eq(table.sessionId, sessionId), eq(table.role, "user")),
      orderBy: [desc(chatMessages.createdAt)]
    });

    expect(latestMessage?.content).toBe("It helps indie hackers plan faster.");
    expect(latestMessage?.stage).toBe("intake");
  });

  it("falls back to output_text when the Responses payload omits message content", async () => {
    mockOpenAIResponseOutputText("What problem does it solve?");
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "New habit tracker", stage: "intake" }
    });

    expect(response.body).toContain("event: assistant.delta");
    expect(response.body).toContain("What problem does it solve?");
  });

  it("prefixes SSE data lines for multi-line assistant text", async () => {
    mockOpenAIResponseLegacy("For the MVP, we can consider features like:\n- Warm intros\n- Founder scorecards");
    const cookie = await createSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Tell me the MVP features", stage: "intake" }
    });

    expect(response.body).toContain("data: For the MVP, we can consider features like:");
    expect(response.body).toContain("data: - Warm intros");
    expect(response.body).toContain("data: - Founder scorecards");
  });

  it("allows longer intake interviews before the per-minute limit triggers", async () => {
    const cookie = await createSession();

    for (let i = 0; i < 30; i += 1) {
      mockOpenAIResponseLegacy(`Reply ${i}`);
      const ok = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { cookie },
        payload: { message: `Message ${i}`, stage: "intake" }
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "limit hit", stage: "intake" }
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toContain("RATE_LIMIT_EXCEEDED");
  });
});

describe("intake readiness gating", () => {
  it("defers orchestrator bridge until READY_TO_DRAFT appears", async () => {
    mockOpenAIResponseLegacy("What problem does it solve?");
    const cookie = await createSession();
    const originalEnv = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "development");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { cookie },
        payload: { message: "Scheduling assistant.", stage: "intake" }
      });

      expect(response.body).not.toContain("event: stage.ready");
      expect(response.body).not.toContain("event: doc.updated");
    } finally {
      Reflect.set(process.env, "NODE_ENV", originalEnv);
    }
  });

  it("runs intake orchestrator and updates idea.md once READY_TO_DRAFT is emitted", async () => {
    mockOpenAIResponseLegacy("Great, I can draft now.\nREADY_TO_DRAFT");
    const cookie = await createSession();
    const sessionId = extractSessionId(cookie as string);
    const originalEnv = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "development");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { cookie },
        payload: { message: "A co-pilot for planning climate hackathons.", stage: "intake" }
      });

      expect(response.body).toContain("event: doc.updated");
      expect(response.body).toContain("event: stage.ready");
      expect(response.body).toContain("READY_TO_DRAFT");
    } finally {
      Reflect.set(process.env, "NODE_ENV", originalEnv);
    }

    const ideaDoc = await db.query.docs.findFirst({
      where: (table) => and(eq(table.sessionId, sessionId), eq(table.name, "idea.md"))
    });

    expect(ideaDoc?.content).toContain("climate hackathons");
  });
});

describe("stream lifecycle", () => {
  it("hijacks the reply before streaming SSE data", async () => {
    const serverApp = createApp({ nextHandler: noopNextHandler, dev: true });
    let hijacked = false;

    serverApp.addHook("onRequest", (_req, reply, done) => {
      const originalHijack = reply.hijack;
      reply.hijack = function hijackWrapper(this: typeof reply) {
        hijacked = true;
        return originalHijack.apply(this);
      };
      done();
    });

    await serverApp.ready();
    mockOpenAIResponse("stream ready");
    const cookie = await createSession(serverApp);

    await serverApp.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie },
      payload: { message: "Hi", stage: "intake" }
    });

    expect(hijacked).toBe(true);
    await serverApp.close();
  });
});

function mockOpenAIResponseLegacy(text: string) {
  (generateResponse as Mock).mockResolvedValueOnce({
    output: [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "output_text", text }]
        }
      }
    ]
  });
}

function mockOpenAIResponseNewShape(text: string) {
  (generateResponse as Mock).mockResolvedValueOnce({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }]
      }
    ]
  });
}

const mockOpenAIResponse = mockOpenAIResponseLegacy;

function mockOpenAIResponseOutputText(text: string) {
  (generateResponse as Mock).mockResolvedValueOnce({
    output: [],
    output_text: [text]
  });
}

async function createSession(instance: FastifyInstance = app) {
  const init = await instance.inject({ method: "POST", url: "/api/session/init" });
  return init.headers["set-cookie"] as string;
}

function extractSessionId(cookie: string) {
  const match = /sid=([^;]+)/.exec(cookie);
  expect(match).not.toBeNull();
  return match![1];
}
