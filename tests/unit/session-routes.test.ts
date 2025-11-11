import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp, type NextRequestHandler } from "../../src/server";
import { db } from "../../src/db/client";
import { chatMessages, designs, docs, sessions } from "../../src/db/schema";
import { SESSION_COOKIE_NAME } from "../../src/utils/session-cookie";
import { env } from "../../src/env";

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

beforeEach(async () => {
  await db.delete(designs);
  await db.delete(chatMessages);
  await db.delete(docs);
  await db.delete(sessions);
});

describe("session routes", () => {
  it("creates a session and sets a secure host-only cookie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/session/init"
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { session_id: string };
    expect(body.session_id).toMatch(/[a-f0-9-]{36}/);

    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    if (env.NODE_ENV === "production") {
      expect(setCookie).toContain("Secure");
    } else {
      expect(setCookie).not.toContain("Secure");
    }
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");

    const sessionRow = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, body.session_id)
    });
    expect(sessionRow).toBeTruthy();
  });

  it("reads a session and refreshes TTL + last_activity", async () => {
    const initResponse = await app.inject({
      method: "POST",
      url: "/api/session/init"
    });
    const { session_id } = initResponse.json() as { session_id: string };
    const cookie = initResponse.headers["set-cookie"]!;

    const before = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, session_id),
      columns: { lastActivity: true }
    });
    expect(before).toBeTruthy();

    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: {
        cookie
      }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.current_stage).toBe("intake");
    expect(payload.docs).toHaveLength(4);
    expect(payload.designs_count).toBe(0);
    expect(payload.approved).toMatchObject({
      intake: false,
      spec: false,
      design: false,
      prompt_plan: false,
      agents: false
    });
    expect(response.headers["set-cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);

    const after = await db.query.sessions.findFirst({
      where: eq(sessions.sessionId, session_id),
      columns: { lastActivity: true }
    });
    expect(after!.lastActivity).toBeGreaterThanOrEqual(before!.lastActivity);
  });

  it("rejects missing or unknown sessions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/session"
    });
    expect(response.statusCode).toBe(401);
  });
});
