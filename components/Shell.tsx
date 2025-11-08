"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChatPanel from "./ChatPanel";
import MarkdownEditor from "./MarkdownEditor";
import MarkdownPreview from "./MarkdownPreview";

type StageSlug = "intake" | "one_pager" | "spec" | "design" | "prompt_plan" | "agents" | "export";

type SessionResponse = {
  current_stage: StageSlug;
  approved: Record<string, boolean>;
  docs: string[];
  designs_count: number;
};

type DocName = "idea.md" | "idea_one_pager.md" | "spec.md" | "prompt_plan.md" | "AGENTS.md";

const stageMeta: Array<{ slug: StageSlug; label: string }> = [
  { slug: "intake", label: "Intake" },
  { slug: "one_pager", label: "One-Pager" },
  { slug: "spec", label: "Spec" },
  { slug: "design", label: "Design" },
  { slug: "prompt_plan", label: "Prompt Plan" },
  { slug: "agents", label: "Agents" },
  { slug: "export", label: "Export" }
];

const docStageMap: Record<DocName, StageSlug> = {
  "idea.md": "intake",
  "idea_one_pager.md": "one_pager",
  "spec.md": "spec",
  "prompt_plan.md": "prompt_plan",
  "AGENTS.md": "agents"
};

const stageOrder = stageMeta.map((stage) => stage.slug);

function docsForStage(stage: StageSlug, available: string[]): DocName[] {
  const names = stageDocOrder.find((s) => s.stage === stage)?.docs ?? [];
  return names.filter((name) => available.includes(name)) as DocName[];
}

const stageDocOrder: Array<{ stage: StageSlug; docs: DocName[] }> = [
  { stage: "intake", docs: ["idea.md"] },
  { stage: "one_pager", docs: ["idea.md", "idea_one_pager.md"] },
  { stage: "spec", docs: ["idea.md", "idea_one_pager.md", "spec.md"] },
  { stage: "design", docs: ["idea.md", "idea_one_pager.md", "spec.md"] },
  { stage: "prompt_plan", docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md"] },
  { stage: "agents", docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"] },
  { stage: "export", docs: ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"] }
];

type StageStatus = "Draft" | "Ready" | "Approved";

function stageStatusFor(
  slug: StageSlug,
  session: SessionResponse | null,
  readyOverrides?: Partial<Record<StageSlug, boolean>>
): StageStatus {
  if (session?.approved[slug]) return "Approved";
  if (readyOverrides?.[slug]) return "Ready";
  if (!session) return "Draft";
  const currentIndex = stageOrder.indexOf(session.current_stage);
  const stageIndex = stageOrder.indexOf(slug);
  if (stageIndex < currentIndex) return "Ready";
  return "Draft";
}

const badgeTone: Record<StageStatus, string> = {
  Draft: "bg-slate-100 text-slate-700",
  Ready: "bg-amber-50 text-amber-800",
  Approved: "bg-emerald-50 text-emerald-700"
};

export default function Shell() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<DocName | null>(null);
  const [docContent, setDocContent] = useState("");
  const [docView, setDocView] = useState<"preview" | "edit">("preview");
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [stageReadyOverrides, setStageReadyOverrides] = useState<Partial<Record<StageSlug, boolean>>>({});

  useEffect(() => {
    void fetch("/api/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: SessionResponse) => {
        setSession(json);
        const allowed = docsForStage(json.current_stage, json.docs);
        setSelectedDoc(allowed[allowed.length - 1] ?? null);
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchDoc = useCallback(
    (name: DocName) => {
      return fetch(`/api/docs/${encodeURIComponent(name)}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((json: { content: string }) => {
          if (selectedDoc === name) {
            setDocContent(json.content ?? "");
          }
        })
        .catch(() => {
          if (selectedDoc === name) {
            setDocContent("");
          }
        });
    },
    [selectedDoc]
  );

  useEffect(() => {
    if (!selectedDoc) {
      setDocContent("");
      return;
    }
    setLocked(false);
    setDocView("preview");
    void fetchDoc(selectedDoc);
  }, [fetchDoc, selectedDoc]);

  const allowedDocs = useMemo(
    () => (session ? docsForStage(session.current_stage, session.docs) : []),
    [session]
  );

  const currentStage = session?.current_stage ?? "intake";
  const stageLabel = stageMeta.find((meta) => meta.slug === currentStage)?.label ?? "Stage";

  useEffect(() => {
    setStageReadyOverrides((prev) => {
      if (!prev[currentStage]) return prev;
      const next = { ...prev };
      delete next[currentStage];
      return next;
    });
  }, [currentStage]);

  const stageStatus: StageStatus = useMemo(
    () => stageStatusFor(currentStage, session, stageReadyOverrides),
    [currentStage, session, stageReadyOverrides]
  );

  const docStage = selectedDoc ? docStageMap[selectedDoc] : null;
  const docLocked = locked || (docStage ? Boolean(session?.approved[docStage]) : false);

  async function handleCopy(name: DocName) {
    const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, { credentials: "include" });
    if (!r.ok) return;
    const { content } = (await r.json()) as { content: string };
    await navigator.clipboard.writeText(content ?? "");
  }

  async function downloadDoc(name: DocName) {
    const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, { credentials: "include" });
    if (!r.ok) return;
    const { content } = (await r.json()) as { content: string };
    const blob = new Blob([content ?? ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveDoc() {
    if (!selectedDoc || docLocked) return;
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
    const r = await fetch("/api/session", { credentials: "include" });
    if (r.ok) {
      const json = (await r.json()) as SessionResponse;
      setSession(json);
      const allowed = docsForStage(json.current_stage, json.docs);
      setSelectedDoc(allowed[allowed.length - 1] ?? null);
    }
  }

  const handleStageReady = useCallback((stageName: string) => {
    if (!stageName) return;
    if (stageMeta.some((meta) => meta.slug === stageName)) {
      setStageReadyOverrides((prev) => ({ ...prev, [stageName as StageSlug]: true }));
    }
  }, []);

  const handleDocUpdated = useCallback(
    (docName: string) => {
      if (!docName) return;
      if (docName === selectedDoc) {
        void fetchDoc(docName as DocName);
      }
    },
    [fetchDoc, selectedDoc]
  );

  if (!session) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-6 text-slate-600">
        <p>{loading ? "Loading workspace…" : "Initialize a session from the home page to start."}</p>
      </div>
    );
  }

  function docStatusFor(name: DocName): StageStatus {
    const stageSlug = docStageMap[name];
    return stageStatusFor(stageSlug, session, stageReadyOverrides);
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50" data-testid="app-shell">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full flex-wrap items-center gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
              AP
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Agent-Ready Planner</p>
              <p className="text-xs text-slate-500">Seven-stage guided workflow</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-wrap items-center justify-center gap-2 overflow-x-auto px-2">
            {stageMeta.map((stage, index) => {
              const status = stageStatusFor(stage.slug, session, stageReadyOverrides);
              const isCurrent = stage.slug === currentStage;
              return (
                <div
                  key={stage.slug}
                  className={`flex flex-none items-center justify-between rounded-full border px-4 py-2 text-sm font-medium ${
                    isCurrent ? "border-blue-400 bg-white shadow-sm" : "border-slate-200 bg-white"
                  } min-w-[135px]`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                        isCurrent ? "border-blue-300 text-blue-600" : "border-slate-200 text-slate-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate">{stage.label}</span>
                  </div>
                  <span className="ml-3 text-[11px] font-semibold text-slate-500">{status}</span>
                </div>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              sid cookie present
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600">
              U
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-[300px] border-r border-slate-200 bg-slate-50 px-6 py-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Documents</h2>
          <ul className="mt-4 space-y-3">
            {allowedDocs.map((name) => {
              const status = docStatusFor(name);
              const isSelected = selectedDoc === name;
              return (
                <li
                  key={name}
                  className={`rounded-2xl border p-4 text-sm shadow-sm ${
                    isSelected ? "border-blue-500 bg-white" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="truncate text-left font-semibold text-slate-900 hover:text-blue-600"
                      onClick={() => setSelectedDoc(name)}
                    >
                      {name}
                    </button>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeTone[status]}`}>{status}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs font-medium text-blue-600">
                    <button onClick={() => setSelectedDoc(name)} className="hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleCopy(name)} className="hover:underline">
                      Copy
                    </button>
                    <button onClick={() => downloadDoc(name)} className="hover:underline">
                      Download
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-xs text-slate-500">Only current and prior stage docs are visible.</p>
        </aside>

        <main className="flex flex-1 flex-col gap-6 bg-slate-50 px-8 py-8">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Stage: {stageLabel}</h1>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeTone[stageStatus]}`}>{stageStatus}</span>
                <button
                  disabled={stageStatus !== "Ready"}
                  onClick={approveStage}
                  className="rounded-lg bg-slate-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Approve Stage
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-4">
              <ChatPanel
                stage={session.current_stage}
                className=""
                onDocUpdated={handleDocUpdated}
                onStageReady={handleStageReady}
              />
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                💡 Ask one question at a time; stop when essentials are filled.
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Document</p>
                <h3 className="text-lg font-semibold text-slate-900">
                  {selectedDoc ?? "Select a document to start writing"}
                </h3>
              </div>
              {selectedDoc ? (
                <>
                  <div className="ml-auto flex items-center gap-2 rounded-full bg-slate-100 p-1 text-sm">
                    <button
                      onClick={() => setDocView("preview")}
                      data-testid="doc-tab-preview"
                      className={`rounded-full px-3 py-1 font-medium ${
                        docView === "preview" ? "bg-white shadow" : "text-slate-500"
                      }`}
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => setDocView("edit")}
                      data-testid="doc-tab-edit"
                      className={`rounded-full px-3 py-1 font-medium ${
                        docView === "edit" ? "bg-white shadow" : "text-slate-500"
                      }`}
                    >
                      Edit
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold text-blue-600">
                    <button onClick={() => handleCopy(selectedDoc)} className="hover:underline">
                      Copy
                    </button>
                    <span className="text-slate-300">•</span>
                    <button onClick={() => downloadDoc(selectedDoc)} className="hover:underline">
                      Download
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className="px-6 py-6">
              {!selectedDoc ? (
                <p className="text-sm text-slate-500">Choose a document from the left rail to view or edit.</p>
              ) : docView === "edit" ? (
                <>
                  <MarkdownEditor
                    value={docContent}
                    onChange={setDocContent}
                    onSave={saveDoc}
                    saving={saving}
                    locked={docLocked}
                  />
                </>
              ) : (
                <MarkdownPreview content={docContent || ""} className="p-6" />
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
