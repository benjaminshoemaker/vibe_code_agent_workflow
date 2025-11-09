"use client";

import { useEffect, useMemo, useState } from "react";

type Manifest = {
  generated_at: string;
  docs: Array<{ name: string; sha256: string }>;
  designs: Array<{ path: string; size: number; content_type: string; sha256: string }>;
  policy: { replace_on_upload: true };
};

export default function ExportPanel() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/export/manifest", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: Manifest) => {
        if (alive) setManifest(json);
      })
      .catch(() => {
        if (alive) setError("Failed to load export manifest.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const manifestText = useMemo(() => (manifest ? JSON.stringify(manifest, null, 2) : ""), [manifest]);

  async function downloadZip() {
    setDownloading(true);
    try {
      const r = await fetch("/api/export/zip", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Export Bundle</h3>
        <button
          data-testid="export-download-button"
          onClick={downloadZip}
          disabled={downloading}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {downloading ? "Preparing…" : "Download Zip"}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Manifest preview</p>
        </div>
        <div className="max-h-64 overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : manifest ? (
            <pre data-testid="export-manifest-json" className="whitespace-pre-wrap break-words text-xs text-slate-800">
              {manifestText}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">No manifest available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

