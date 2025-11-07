import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type NextRequestHandler } from "../../src/server";
import { CHAT_KEEPALIVE_MS } from "../../src/routes/api/chat";

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
        content: [{ type: "output_text", text }]
      }
    ]
  });
}

const mockOpenAIResponse = mockOpenAIResponseLegacy;

async function createSession(instance: FastifyInstance = app) {
  const init = await instance.inject({ method: "POST", url: "/api/session/init" });
  return init.headers["set-cookie"] as string;
}
