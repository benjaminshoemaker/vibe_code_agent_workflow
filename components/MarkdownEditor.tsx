"use client";

import type { ChangeEvent } from "react";

type MarkdownEditorProps = {
  value: string;
  saving: boolean;
  locked: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

export default function MarkdownEditor({ value, onChange, onSave, saving, locked }: MarkdownEditorProps) {
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  return (
    <div className="space-y-4">
      {locked ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>This document is approved. Start a new session to make further changes.</p>
          <a
            className="mt-3 inline-flex rounded-full border border-amber-300 bg-white px-4 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            Start new session
          </a>
        </div>
      ) : null}
      <textarea
        value={value}
        onChange={handleChange}
        disabled={locked}
        className="h-72 w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
        placeholder="Start typing..."
      />
      <div className="flex justify-end">
        <button
          data-testid="doc-save-button"
          onClick={onSave}
          disabled={saving || locked}
          className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
