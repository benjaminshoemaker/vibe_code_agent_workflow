import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../src/db/client";
import { docs } from "../../src/db/schema";
import { createApp, type NextRequestHandler } from "../../src/server";

vi.mock("../../src/services/orchestrator", () => ({
  orchestrator: {
    reingest: vi.fn().mockResolvedValue(undefined)
  }
}));

const { orchestrator } = await import("../../src/services/orchestrator");

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

describe("docs routes", () => {
  it("returns doc content", async () => {
    const session = await createSession();

    const response = await app.inject({
      method: "GET",
      url: "/api/docs/idea.md",
      headers: { cookie: session.cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "idea.md", approved: false });
  });

  it("prevents editing approved docs", async () => {
    const session = await createSession();
    await db
      .update(docs)
      .set({ approved: true })
      .where(eq(docs.sessionId, session.sessionId));

    const response = await app.inject({
      method: "PUT",
      url: "/api/docs/idea.md",
      headers: { cookie: session.cookie },
      payload: { content: "Updated" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("DOC_APPROVED");
  });

  it("updates doc content and triggers reingest", async () => {
    const session = await createSession();

    const response = await app.inject({
      method: "PUT",
      url: "/api/docs/idea.md",
      headers: { cookie: session.cookie },
      payload: { content: "New content" }
    });

    expect(response.statusCode).toBe(200);
    const updatedDoc = await db.query.docs.findFirst({
      where: (table, { and }) =>
        and(eq(table.sessionId, session.sessionId), eq(table.name, "idea.md"))
    });
    expect(updatedDoc?.content).toBe("New content");
    expect(orchestrator.reingest).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.sessionId, docName: "idea.md" })
    );
  });
});

async function createSession() {
  const response = await app.inject({ method: "POST", url: "/api/session/init" });
  const { session_id } = response.json<{ session_id: string }>();
  return { cookie: response.headers["set-cookie"] as string, sessionId: session_id };
}
