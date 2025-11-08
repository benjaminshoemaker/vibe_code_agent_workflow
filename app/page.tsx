import Link from "next/link";
import type { Route } from "next";
import StartSessionButton from "../components/StartSessionButton";

const STAGES = [
  "intake",
  "one_pager",
  "spec",
  "design",
  "prompt_plan",
  "agents",
  "export"
] as const;

const SNIPPETS: Array<{ title: string; filename: string; content: string }> = [
  {
    title: "Idea One Pager",
    filename: "idea_one_pager.md",
    content: `## Problem
Founders lose hours wiring each agent stage by hand.

## Audience
Senior engineers and PMs who shepherd agent workflows.

## Core Flow
Collect docs → validate → approve → export bundle.`
  },
  {
    title: "Spec Overview",
    filename: "spec.md",
    content: `### Functional Requirements
1. Enforce stage validators before advancing.
2. Persist docs + /designs/ index to Turso.
3. Emit Definition of Done for each stage.`
  },
  {
    title: "Prompt Plan",
    filename: "prompt_plan.md",
    content: `- [ ] Validate docs + designs for current stage
- [ ] Stream chat + doc updates to the operator
- [ ] Emit release note + checklist when approved`
  },
  {
    title: "AGENTS.md",
    filename: "AGENTS.md",
    content: `## Agent responsibility
- Keep TODOs synced with prompt_plan.md
- Suggest manual tests even if automation passes
- Never leak secrets, prompts, or PII`
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white px-6 py-16 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <section className="text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Agent-ready planner</p>
          <h1
            data-testid="hero-heading"
            className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl"
          >
            Turn your idea into agent-ready docs
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600">
            A structured, multi-stage workflow that transforms your product concept into comprehensive
            documentation ready for AI agents and development teams.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <StartSessionButton />
            <Link
              href={"/app?resume=1" as Route}
              className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
            >
              Resume
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
            How it works
          </h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-7">
            {STAGES.map((stage) => (
              <div
                key={stage}
                className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center"
              >
                <p className="text-xs uppercase tracking-wide text-slate-600">{stage}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Doc snippets</h2>
            <p className="text-sm text-slate-400">Read-only samples from each exported file.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {SNIPPETS.map((snippet) => (
              <article
                key={snippet.filename}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <header className="mb-4 space-y-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {snippet.filename}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900">{snippet.title}</h3>
                </header>
                <pre className="max-h-56 whitespace-pre-wrap break-words text-sm text-slate-700">
                  {snippet.content}
                </pre>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Security note</h2>
          <p className="mt-3">
            All uploads stay in your session’s Turso database. No third-party logging, no clipboard
            snooping, and no data leaves the stack without your explicit export. Rotate credentials
            via .env.local, and run pnpm test before every deploy to keep stages honest.
          </p>
        </section>
      </div>
    </main>
  );
}
