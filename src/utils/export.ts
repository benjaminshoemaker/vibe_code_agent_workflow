import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import yazl from "yazl";

type DocRow = { name: string; content: string };
type DesignRow = { path: string; size: number; contentType: string; sha256: string; data: Buffer };

export type ExportManifest = {
  generated_at: string;
  docs: Array<{ name: string; sha256: string }>;
  designs: Array<{ path: string; size: number; content_type: string; sha256: string }>;
  policy: { replace_on_upload: true };
};

export function buildManifest(docs: DocRow[], designs: DesignRow[]): ExportManifest {
  const docList = [...docs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((doc) => ({ name: doc.name, sha256: sha256String(doc.content ?? "") }));

  const designList = [...designs]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((d) => ({ path: d.path, size: d.size, content_type: d.contentType, sha256: d.sha256 }));

  return {
    generated_at: new Date().toISOString(),
    docs: docList,
    designs: designList,
    policy: { replace_on_upload: true }
  };
}

export function createZipStream(params: {
  docs: DocRow[];
  designs: DesignRow[];
  manifest: ExportManifest;
}): { stream: Readable; finalize: () => void } {
  const zip = new yazl.ZipFile();

  // Docs at top-level
  for (const doc of [...params.docs].sort((a, b) => a.name.localeCompare(b.name))) {
    const buffer = Buffer.from(doc.content ?? "", "utf8");
    zip.addBuffer(buffer, doc.name, { mtime: new Date(0) });
  }

  // Designs under /designs/
  for (const file of [...params.designs].sort((a, b) => a.path.localeCompare(b.path))) {
    zip.addBuffer(file.data, `designs/${file.path}`, { mtime: new Date(0) });
  }

  // Manifest
  const manifestBuf = Buffer.from(JSON.stringify(params.manifest, null, 2), "utf8");
  zip.addBuffer(manifestBuf, "manifest.json", { mtime: new Date(0) });

  const stream = zip.outputStream as unknown as Readable;
  const finalize = () => zip.end();
  return { stream, finalize };
}

export function sha256String(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

