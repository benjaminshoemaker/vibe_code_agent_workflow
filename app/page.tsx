export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mx-auto max-w-3xl space-y-6">
        <p className="text-sm uppercase tracking-[0.4em] text-brand-300">Agent-ready planner</p>
        <h1
          data-testid="hero-heading"
          className="text-4xl font-semibold tracking-tight text-white sm:text-5xl"
        >
          Single-origin Next.js + Fastify starter for agent-driven delivery.
        </h1>
        <p className="text-base text-slate-300">
          Node 20 runtime, Tailwind UI, Fastify APIs, strict TypeScript, and batteries-included
          testing with Vitest + Playwright. Extend it to orchestrate documents, stage approvals, and
          chat flows.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 text-sm text-slate-400 sm:flex-row">
          <span className="rounded-full border border-slate-800 px-4 py-1">
            pnpm · Next.js App Router · Tailwind
          </span>
          <span className="rounded-full border border-slate-800 px-4 py-1">
            Fastify APIs · Vitest · Playwright
          </span>
        </div>
      </div>
    </main>
  );
}
