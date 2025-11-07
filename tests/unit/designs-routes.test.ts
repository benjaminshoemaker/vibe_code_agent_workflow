import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { NextRequestHandler } from "../../src/server";
import { createApp } from "../../src/server";
import { db } from "../../src/db/client";
import { designs } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { ZipFile } from "yazl";

vi.mock("../../src/services/orchestrator", () => ({
  orchestrator: {
    reingest: vi.fn().mockResolvedValue(undefined),
    refreshContext: vi.fn().mockResolvedValue(undefined),
    runStage: vi.fn()
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

describe("designs routes", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/api/designs/index" });
    expect(response.statusCode).toBe(401);

    const upload = await app.inject({
      method: "POST",
      url: "/api/designs/upload",
      headers: { "content-type": "application/zip" },
      payload: Buffer.from("invalid")
    });
    expect(upload.statusCode).toBe(401);
  });

  it("uploads a zip, replaces prior files, and lists them", async () => {
    const session = await createSession();
    const firstZip = await createZipBuffer([
      { path: "1-Landing.png", content: "first-screen" },
      { path: "./1-Landing.png", content: "normalized-second" },
      { path: "__MACOSX/._junk", content: "skip" }
    ]);

    const firstUpload = await app.inject({
      method: "POST",
      url: "/api/designs/upload",
      headers: { cookie: session.cookie, "content-type": "application/zip" },
      payload: firstZip
    });

    expect(firstUpload.statusCode).toBe(200);
    expect(firstUpload.json().files).toHaveLength(1);
    expect(orchestrator.reingest).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.sessionId, docName: "designs/index" })
    );

    const storedFirst = await db.query.designs.findMany({
      where: eq(designs.sessionId, session.sessionId)
    });
    expect(storedFirst).toHaveLength(1);
    expect(storedFirst[0]?.path).toBe("1-Landing.png");
    expect(storedFirst[0]?.size).toBe(Buffer.from("normalized-second").length);

    const secondZip = await createZipBuffer([{ path: "2-Detail.png", content: "detail" }]);
    const secondUpload = await app.inject({
      method: "POST",
      url: "/api/designs/upload",
      headers: { cookie: session.cookie, "content-type": "application/zip" },
      payload: secondZip
    });
    expect(secondUpload.statusCode).toBe(200);

    const storedSecond = await db.query.designs.findMany({
      where: eq(designs.sessionId, session.sessionId)
    });
    expect(storedSecond).toHaveLength(1);
    expect(storedSecond[0]?.path).toBe("2-Detail.png");

    const indexResponse = await app.inject({
      method: "GET",
      url: "/api/designs/index",
      headers: { cookie: session.cookie }
    });
    expect(indexResponse.statusCode).toBe(200);
    expect(indexResponse.json()).toEqual({
      files: [
        {
          path: "2-Detail.png",
          size: Buffer.from("detail").length,
          content_type: "image/png",
          sha256: storedSecond[0]?.sha256
        }
      ]
    });
  });

  it("rejects nested archives", async () => {
    const session = await createSession();
    const zip = await createZipBuffer([
      { path: "nested/archive.zip", content: "fake" },
      { path: "plain.txt", content: "ok" }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/designs/upload",
      headers: { cookie: session.cookie, "content-type": "application/zip" },
      payload: zip
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("NESTED_ARCHIVE");
  });

  it("enforces file count limit", async () => {
    const session = await createSession();
    const entries = Array.from({ length: 301 }, (_value, index) => ({
      path: `f-${index}.txt`,
      content: "x"
    }));
    const zip = await createZipBuffer(entries);

    const response = await app.inject({
      method: "POST",
      url: "/api/designs/upload",
      headers: { cookie: session.cookie, "content-type": "application/zip" },
      payload: zip
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("TOO_MANY_FILES");
  });
});

async function createSession() {
  const response = await app.inject({ method: "POST", url: "/api/session/init" });
  const { session_id } = response.json<{ session_id: string }>();
  return { cookie: response.headers["set-cookie"] as string, sessionId: session_id };
}

function createZipBuffer(entries: Array<{ path: string; content: string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const entry of entries) {
      zip.addBuffer(Buffer.from(entry.content), entry.path);
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}
