import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createApp, type NextRequestHandler } from "../../src/server";
import { db } from "../../src/db/client";
import { docs, designs, sessions } from "../../src/db/schema";
import { and, eq } from "drizzle-orm";
import yauzl, { type Entry, type ZipFile } from "yauzl";

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

describe("/api/export/zip", () => {
  it("streams a zip with docs, designs, and manifest.json", async () => {
    const { cookie, sessionId } = await createSession();

    // Seed doc contents
    await db
      .update(docs)
      .set({ content: "# Idea\nHello" })
      .where(and(eq(docs.sessionId, sessionId), eq(docs.name, "idea_one_pager.md" as any)));

    const img = Buffer.from([0, 1, 2, 3, 4, 5]);
    const sha = createHash("sha256").update(img).digest("hex");
    await db.insert(designs).values({
      sessionId,
      path: "1-Landing.png",
      size: img.length,
      contentType: "image/png",
      sha256: sha,
      data: img
    });

    const response = await app.inject({ method: "POST", url: "/api/export/zip", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");

    const body = response.rawPayload as Buffer;
    const files = await unzipEntries(body);

    // manifest present
    expect(files.has("manifest.json")).toBe(true);
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    expect(manifest.policy).toEqual({ replace_on_upload: true });
    expect(Array.isArray(manifest.docs)).toBe(true);
    expect(Array.isArray(manifest.designs)).toBe(true);

    // docs present
    expect(files.has("idea_one_pager.md")).toBe(true);
    expect(files.get("idea_one_pager.md")!.toString("utf8")).toContain("Hello");

    // design present under designs/
    expect(files.has("designs/1-Landing.png")).toBe(true);
    const designData = files.get("designs/1-Landing.png")!;
    const computed = createHash("sha256").update(designData).digest("hex");
    expect(computed).toBe(sha);
  });
});

async function createSession() {
  const response = await app.inject({ method: "POST", url: "/api/session/init" });
  const cookie = response.headers["set-cookie"] as string;
  const { session_id } = response.json<{ session_id: string }>();
  return { cookie, sessionId: session_id };
}

async function unzipEntries(buffer: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("zip open failed"));
        return;
      }
      const out = new Map<string, Buffer>();
      zipfile.readEntry();
      zipfile.on("entry", (entry: Entry) => {
        readEntry(zipfile, entry)
          .then((data) => {
            out.set(entry.fileName, data);
            zipfile.readEntry();
          })
          .catch(reject);
      });
      zipfile.on("end", () => resolve(out));
      zipfile.on("error", reject);
    });
  });
}

function readEntry(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("stream open failed"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c as Buffer));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}
