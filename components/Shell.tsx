"use client";
import { useEffect, useMemo, useState } from "react";
import ChatPanel from "./ChatPanel";

type SessionResponse = {
  current_stage: "intake" | "one_pager" | "spec" | "design" | "prompt_plan" | "agents" | "export";
  approved: Record<string, boolean>;
  docs: string[];
  designs_count: number;
};

type DocName = "idea.md" | "idea_one_pager.md" | "spec.md" | "prompt_plan.md" | "AGENTS.md";

const stageDocOrder: Array<{ stage: SessionResponse["current_stage"]; docs: DocName[] }> = [
  { stage: "intake", docs: ["idea.md"] },
  { stage: "one_pager", docs: ["idea.md", "idea_one_pager.md"] },
  { stage: "spec", docs: ["idea.md", "idea_one_pager.md", "spec.md"] },
  { stage: "design", docs: ["idea.md", "idea_one_pager.md", "spec.md"] },
  {
    stage: "prompt_plan",
    docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md"]
  },
  {
    stage: "agents",
    docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"]
  },
  {
    stage: "export",
    docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"]
  }
];

function docsForStage(stage: SessionResponse["current_stage"], available: string[]): DocName[] {
  const target = stageDocOrder.find((s) => s.stage === stage);
  const names = target ? target.docs : [];
  return names.filter((n) => available.includes(n)) as DocName[];
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function markdownToHtml(md: string) {
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2];
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }
    out.push(raw);
  }
  // group paragraphs by blank lines
  const joined = out.join("\n");
  const paragraphs = joined.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`);
  return paragraphs.join("\n");
}

export default function Shell() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocName | null>(null);
  const [docContent, setDocContent] = useState<string>("");
  const [tab, setTab] = useState<"edit" | "preview" | "chat">("edit");
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    void fetch("/api/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: SessionResponse) => {
        setSession(json);
        const allowed = docsForStage(json.current_stage, json.docs);
        setSelectedDoc(allowed[allowed.length - 1] ?? null);
      })
      .catch(() => {
        // ignore; page may render a call-to-action instead
      });
  }, []);

  useEffect(() => {
    if (!selectedDoc) return;
    void fetch(`/api/docs/${encodeURIComponent(selectedDoc)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: { content: string }) => setDocContent(json.content ?? ""))
      .catch(() => setDocContent(""));
  }, [selectedDoc]);

  const allowedDocs = useMemo(
    () => (session ? docsForStage(session.current_stage, session.docs) : []),
    [session]
  );

  const stageStatus: "Draft" | "Ready" | "Approved" = useMemo(() => {
    if (!session) return "Draft";
    const approvedKey =
      session.current_stage === "one_pager"
        ? "one_pager"
        : (session.current_stage as keyof SessionResponse["approved"]);
    // If approved for this stage
    if (session.approved[approvedKey as string]) return "Approved";
    // Without SSE wiring, treat as Draft by default
    return "Draft";
  }, [session]);

  async function handleCopy(name: DocName) {
    const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, { credentials: "include" });
    if (!r.ok) return;
    const { content } = (await r.json()) as { content: string };
    await navigator.clipboard.writeText(content ?? "");
  }

  function download(name: DocName) {
    const blob = new Blob([docContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveDoc() {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(selectedDoc)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: docContent })
      });
      if (res.status === 409) {
        setLocked(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function approveStage() {
    if (!session) return;
    await fetch(`/api/stages/${session.current_stage}/approve`, {
      method: "POST",
      credentials: "include"
    });
    // Refresh session to pick up stage change
    const r = await fetch("/api/session", { credentials: "include" });
    if (r.ok) setSession(await r.json());
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-center text-slate-600">
        <p>Initialize a session from the home page to start.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] gap-6 p-6" data-testid="app-shell">
      {/* Left rail */}
      <aside className="w-[320px] shrink-0">
        <header className="mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
            Documents
          </h2>
        </header>
        <ul className="space-y-2">
          {allowedDocs.map((name) => (
            <li key={name} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <button
                  className="truncate text-left text-sm font-medium text-slate-900 hover:underline"
                  onClick={() => {
                    setSelectedDoc(name);
                    setTab("edit");
                  }}
                >
                  {name}
                </button>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <button className="hover:underline" onClick={() => setSelectedDoc(name)}>
                    Edit
                  </button>
                  <span>•</span>
                  <button className="hover:underline" onClick={() => handleCopy(name)}>
                    Copy
                  </button>
                  <span>•</span>
                  <button className="hover:underline" onClick={() => download(name)}>
                    Download
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Right pane */}
      <section className="flex min-h-[70vh] flex-1 flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Agent-Ready Planner</h1>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              {stageStatus}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              Session: active
            </span>
          </div>

          <button
            disabled={stageStatus === "Draft"}
            onClick={approveStage}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            title={stageStatus === "Draft" ? "Disabled until stage is ready" : "Approve stage"}
          >
            Approve
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          <button
            onClick={() => setTab("preview")}
            className={`px-3 py-2 text-sm ${tab === "preview" ? "border-b-2 border-blue-600 font-medium" : "text-slate-600"}`}
          >
            Preview
          </button>
          <button
            onClick={() => setTab("edit")}
            className={`px-3 py-2 text-sm ${tab === "edit" ? "border-b-2 border-blue-600 font-medium" : "text-slate-600"}`}
          >
            Edit
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`px-3 py-2 text-sm ${tab === "chat" ? "border-b-2 border-blue-600 font-medium" : "text-slate-600"}`}
          >
            Chat
          </button>
          <div className="ml-auto text-xs text-slate-500">Stage: {session.current_stage}</div>
        </div>

        {/* Content */}
        <div className={tab === "edit" ? "flex flex-1 flex-col gap-3" : "hidden"}>
          {locked && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This document is approved. Start a new session to make further changes.
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {selectedDoc ?? "(no document selected)"}
            </h3>
            <textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              className="h-64 w-full resize-vertical rounded border border-slate-300 p-3 font-mono text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Start typing..."
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={saveDoc}
                disabled={saving}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>

        <div className={tab === "preview" ? "block" : "hidden"}>
          <div className="rounded-xl border border-slate-200 bg-white p-0 shadow-sm">
            <iframe
              title="Preview"
              className="h-[60vh] w-full rounded-xl"
              sandbox=""
              srcDoc={`<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; object-src 'none'\"><style>html,body{background:#fff;color:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;line-height:1.6;margin:0;padding:24px;}h1,h2,h3,h4,h5,h6{margin:1em 0 0.5em;}p{margin:0 0 0.8em;}</style></head><body>${markdownToHtml(
                docContent || "(empty)"
              )}</body></html>`}
            />
          </div>
        </div>

        <div className={tab === "chat" ? "block" : "hidden"}>
          <ChatPanel stage={session.current_stage} />
        </div>
      </section>
    </div>
  );
}
