"use client";

import { useMemo } from "react";
import { buildPreviewDocument, renderMarkdownToHtml } from "../src/utils/markdown";

type MarkdownPreviewProps = {
  content: string;
  className?: string;
};

export default function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const sanitizedHtml = useMemo(() => renderMarkdownToHtml(content ?? ""), [content]);
  const doc = useMemo(() => buildPreviewDocument(sanitizedHtml), [sanitizedHtml]);

  return (
    <div className={`rounded-2xl border border-slate-100 bg-slate-50 ${className ?? ""}`}>
      <iframe
        title="Markdown preview"
        sandbox="allow-same-origin"
        srcDoc={doc}
        referrerPolicy="no-referrer"
        className="h-96 w-full rounded-2xl bg-white"
      />
    </div>
  );
}
