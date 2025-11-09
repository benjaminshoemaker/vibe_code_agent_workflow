"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DesignFile = {
  path: string;
  size: number;
  content_type: string;
  sha256: string;
};

type Props = {
  onIndexUpdate?: (count: number) => void;
  className?: string;
};

export default function DesignStage({ onIndexUpdate, className }: Props) {
  const [files, setFiles] = useState<DesignFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const onIndexUpdateRef = useRef<Props["onIndexUpdate"] | null>(null);
  const prevCountRef = useRef<number | null>(null);

  useEffect(() => {
    onIndexUpdateRef.current = onIndexUpdate ?? null;
  }, [onIndexUpdate]);

  async function fetchIndex() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/designs/index", { credentials: "include" });
      if (!r.ok) throw new Error(`index ${r.status}`);
      const json = (await r.json()) as {
        files: Array<{ path: string; size: number; content_type: string; sha256: string }>;
      };
      const list = json.files ?? [];
      setFiles(list);
      const count = list.length;
      if (prevCountRef.current !== count) {
        prevCountRef.current = count;
        onIndexUpdateRef.current?.(count);
      }
    } catch (e: any) {
      setError("Failed to load designs index.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchIndex();
    // run only on mount; updates are triggered explicitly after uploads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const file = fileList[0];
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setError("Please select a .zip archive.");
        return;
      }
      setError(null);
      setNotice(null);
      setUploading(true);
      try {
        const r = await fetch("/api/designs/upload", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/zip" },
          body: file
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(text || `upload ${r.status}`);
        }
        const json = (await r.json()) as { files: DesignFile[] };
        setNotice(`Upload replaced ${json.files.length} file(s).`);
        await fetchIndex();
      } catch (e: any) {
        setError("Upload failed. Ensure a valid ZIP (≤100MB, no nested or encrypted archives).");
      } finally {
        setUploading(false);
      }
    },
    []
  );

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      el.classList.add("ring-2", "ring-blue-300");
    };
    const onDragLeave = () => el.classList.remove("ring-2", "ring-blue-300");
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      el.classList.remove("ring-2", "ring-blue-300");
      const dt = e.dataTransfer;
      void handleFiles(dt?.files || null);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  return (
    <div className={className ?? ""}>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        New upload will replace all files.
      </div>

      <div
        ref={dropRef}
        className="mt-4 flex min-h-[140px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-center"
      >
        <p className="text-sm text-slate-600">Drag & drop a .zip here, or</p>
        <label className="mt-2 inline-flex cursor-pointer items-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(e) => void handleFiles(e.target.files)}
            disabled={uploading}
          />
          {uploading ? "Uploading…" : "Choose ZIP"}
        </label>
        <p className="mt-2 text-xs text-slate-500">Max 100MB, ≤300 files. No nested/encrypted archives.</p>
      </div>

      {notice ? (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Design Assets</h3>
          {loading ? <span className="text-xs text-slate-500">Loading…</span> : null}
        </div>
        <div className="p-4">
          {files.length === 0 ? (
            <p className="text-sm text-slate-500">No design ZIP uploaded yet. Upload to unblock this stage.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Content Type</th>
                    <th className="px-3 py-2 font-medium">sha256</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.path} className="border-t border-slate-100">
                      <td className="px-3 py-2 align-top">{renderTypeIcon(f.content_type)}</td>
                      <td className="px-3 py-2 align-top font-mono">{f.path}</td>
                      <td className="px-3 py-2 align-top text-slate-600">{formatBytes(f.size)}</td>
                      <td className="px-3 py-2 align-top text-slate-600">{f.content_type}</td>
                      <td className="px-3 py-2 align-top text-slate-600 break-all">{f.sha256}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">
                Image thumbnails and PDF previews will render once content serving is enabled.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderTypeIcon(contentType: string) {
  if (contentType.startsWith("image/")) {
    return <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">IMG</span>;
  }
  if (contentType === "application/pdf") {
    return <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">PDF</span>;
  }
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">FILE</span>;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return `${value} ${sizes[i]}`;
}
