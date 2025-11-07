import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Entry, ZipFile } from "yauzl";
import yauzl from "yauzl";
import { lookup as lookupMime } from "mime-types";
import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { designs } from "../../db/schema";
import { SESSION_COOKIE_NAME, setSessionCookie } from "../../utils/session-cookie";
import { orchestrator } from "../../services/orchestrator";

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 300;
const BLOCKED_PREFIXES = ["__MACOSX/", "._"];

type ExtractedDesign = {
  path: string;
  size: number;
  data: Buffer;
  contentType: string;
  sha256: string;
};

class DesignUploadError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 422) {
    super(message);
    this.statusCode = statusCode;
  }
}

const designsRoutes: FastifyPluginCallback = (app, _opts, done) => {
  if (!app.hasContentTypeParser("application/zip")) {
    app.addContentTypeParser("application/zip", { parseAs: "buffer" }, (_req, body, parseDone) => {
      parseDone(null, body as Buffer);
    });
  }

  app.get("/api/designs/index", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    const rows = await db.query.designs.findMany({
      where: eq(designs.sessionId, sessionId),
      columns: { path: true, size: true, contentType: true, sha256: true }
    });

    setSessionCookie(reply, sessionId);
    return reply.send({
      files: rows.map((row) => ({
        path: row.path,
        size: row.size,
        content_type: row.contentType,
        sha256: row.sha256
      }))
    });
  });

  app.post("/api/designs/upload", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ error: "SESSION_NOT_FOUND" });
    }

    if (request.headers["content-type"] !== "application/zip") {
      return reply.code(415).send({ error: "UNSUPPORTED_MEDIA_TYPE" });
    }

    const body = request.body;
    if (!body || !Buffer.isBuffer(body)) {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }

    if (body.length === 0) {
      return reply.code(400).send({ error: "EMPTY_UPLOAD" });
    }

    if (body.length > MAX_ZIP_BYTES) {
      return reply.code(413).send({ error: "ZIP_TOO_LARGE" });
    }

    let extracted: ExtractedDesign[];
    try {
      extracted = await extractDesignFiles(body);
    } catch (error) {
      if (error instanceof DesignUploadError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error({ err: error }, "Failed to extract design ZIP");
      return reply.code(422).send({ error: "ZIP_EXTRACTION_FAILED" });
    }

    if (extracted.length === 0) {
      return reply.code(422).send({ error: "NO_VALID_DESIGNS" });
    }

    await db.transaction(async (tx) => {
      await tx.delete(designs).where(eq(designs.sessionId, sessionId));
      await tx.insert(designs).values(
        extracted.map((file) => ({
          sessionId,
          path: file.path,
          size: file.size,
          contentType: file.contentType,
          sha256: file.sha256,
          data: file.data
        }))
      );
    });

    setSessionCookie(reply, sessionId);
    await orchestrator.reingest({ sessionId, docName: "designs/index" });

    return reply.send({
      files: extracted.map((file) => ({
        path: file.path,
        size: file.size,
        content_type: file.contentType,
        sha256: file.sha256
      }))
    });
  });

  done();
};

async function extractDesignFiles(buffer: Buffer): Promise<ExtractedDesign[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new DesignUploadError("INVALID_ZIP"));
        return;
      }

      const files = new Map<string, ExtractedDesign>();
      let processed = 0;

      zipfile.once("error", (zipError) => {
        zipfile.close();
        reject(zipError);
      });

      zipfile.once("end", () => {
        resolve([...files.values()]);
      });

      const handleEntry = async (entry: Entry) => {
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          throw new DesignUploadError("ENCRYPTED_ARCHIVE");
        }

        if (entry.fileName.endsWith("/")) {
          return;
        }

        const normalizedPath = normalizeDesignPath(entry.fileName);
        if (!normalizedPath) {
          return;
        }

        if (normalizedPath.toLowerCase().endsWith(".zip")) {
          throw new DesignUploadError("NESTED_ARCHIVE");
        }

        const data = await readEntry(zipfile, entry);
        processed += 1;
        if (processed > MAX_FILES) {
          throw new DesignUploadError("TOO_MANY_FILES");
        }

        files.set(normalizedPath, {
          path: normalizedPath,
          size: data.length,
          data,
          contentType: detectContentType(normalizedPath),
          sha256: createHash("sha256").update(data).digest("hex")
        });
      };

      const readNext = () => {
        zipfile.readEntry();
      };

      zipfile.on("entry", (entry) => {
        handleEntry(entry).then(readNext, (entryError) => {
          zipfile.close();
          reject(entryError);
        });
      });

      readNext();
    });
  });
}

function detectContentType(path: string) {
  return (lookupMime(path) as string | false) || "application/octet-stream";
}

function normalizeDesignPath(input: string) {
  const replaced = input.replace(/\\/g, "/");
  if (!replaced || replaced.endsWith("/")) {
    return null;
  }

  if (BLOCKED_PREFIXES.some((prefix) => replaced.startsWith(prefix)) || replaced.split("/").some((part) => part.startsWith("._"))) {
    return null;
  }

  const normalized = posix
    .normalize("/" + replaced)
    .replace(/^\//, "")
    .trim();

  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) {
    throw new DesignUploadError("INVALID_PATH");
  }

  return normalized;
}

function readEntry(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new DesignUploadError("ZIP_STREAM_ERROR"));
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => {
        chunks.push(chunk as Buffer);
      });
      stream.once("error", reject);
      stream.once("end", () => {
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

export default fp(designsRoutes, { name: "designs-routes" });
