# Agent-Ready Planner Scaffold

Single-origin Node 20 project that serves a Next.js 14 App Router UI and Fastify APIs from the same process. The stack ships with Tailwind CSS, strict TypeScript, Vitest, Playwright, ESLint, and Prettier so future stages can focus on product logic instead of wiring.

## Getting started

```bash
pnpm install
pnpm dev
```

The development server listens on `http://localhost:3000` by default. Update `.env.local` (ignored by git) to supply credentials such as `OPENAI_API_KEY`, `OPENAI_MODEL`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN`. The loader in `src/env.ts` validates these values.

### Required scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Runs the Fastify + Next.js server via `tsx` in watch mode. |
| `pnpm build` | Builds the Next.js app and emits `dist/server.js` for production. |
| `pnpm start` | Starts the compiled Fastify server against the `.next` build. |
| `pnpm typecheck` | Runs `tsc --noEmit` with strict settings. |
| `pnpm test` | Executes unit tests followed by Playwright e2e tests. |
| `pnpm test:unit` | Runs Vitest in CI-friendly `--run` mode. |
| `pnpm test:e2e` | Builds the app and runs Playwright against the production server. |

Additional helpers:

- `pnpm lint` — Next.js ESLint runner with Prettier alignment.
- `pnpm dlx playwright install` — Install Playwright browsers locally if they are missing.
- `pnpm db:prepare` — Creates `.tmp/dev.db` when working locally.
- `pnpm db:generate` / `pnpm db:migrate` — Run Drizzle Kit using the schema in `src/db/schema.ts`.
- `pnpm db:seed` — Inserts a sample session/doc set using the configured database.

## Project layout

- `app/` — Next.js App Router entry (`layout.tsx`, `page.tsx`, global styles).
- `src/server.ts` — Fastify bootstrap hosting both APIs and Next.js handler.
- `src/env.ts` — `zod`-based environment loader with defaults and validation helpers.
- `src/db/schema.ts` — Drizzle schema for Turso tables (sessions, docs, chat, designs).
- `src/db/client.ts` — Drizzle client that targets Turso or falls back to `file:./.tmp/dev.db`.
- `src/db/seed.ts` — Seed helper invoked via `pnpm db:seed`.
- `scripts/ensure-local-db.ts` — Utility invoked by database scripts to create the local SQLite file.
- `src/libs/openai.ts` — OpenAI Responses API helper (requires `OPENAI_API_KEY`).
- `tests/unit` & `tests/e2e` — Vitest + Playwright suites (home page smoke + env tests).
- `tailwind.config.ts`, `postcss.config.js` — Tailwind + PostCSS wiring for the UI.
- `vitest.config.ts`, `playwright.config.ts` — Base testing configuration.

## Release notes

| Step | User-facing notes |
| --- | --- |
| 1 — Project scaffold & tooling | Base repo is live; run `pnpm dev` to start the combined Fastify + Next.js dev server on `http://localhost:3000`. |
| 2 — Single-origin Fastify + Next | `/api/health` exposes a JSON `{ok:true}` heartbeat for uptime monitoring. |
| 3 — Security headers & CSP | All routes now emit strict CSP and hardened headers; no action required. |
| 4 — Drizzle/Turso integration | Local development automatically provisions `.tmp/dev.db`; Turso URLs can still be supplied via env vars. |
| 5 — Session cookie + `/api/session` | Use `POST /api/session/init` and `GET /api/session` to manage session cookies (host-only, rolling TTL). |
| 6 — Docs API + re-ingest hook | `/api/docs/:name` now supports GET/PUT so users can edit idea/spec files until they’re approved. |
| 7 — OpenAI wrapper | Internal Responses API helper added (no new endpoints). |
| 8 — `/api/chat` SSE | `/api/chat` streams Server-Sent Events; test with `curl -N -b cookies.txt http://localhost:3000/api/chat`. |
| 9 — LangGraph stage orchestrator | Back-end orchestrator graph landed; no new user-facing controls yet. |

## Deployment flow

1. `pnpm build` — generates `.next` and compiles `src/server.ts` to `dist/server.js`.
2. `pnpm start` — uses the compiled server to serve both Fastify APIs and the Next.js build.

Make sure to provide production secrets via environment variables before running `start`.

## Database workflow

- By default the Drizzle client connects to a local SQLite file at `.tmp/dev.db` and will automatically create the directory/file if they are missing. Provide `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN` if required) to target a real Turso instance.
- `pnpm db:generate` produces SQL migrations under `drizzle/migrations/`, while `pnpm db:migrate` applies them.
- `pnpm db:seed` inserts a demo session plus placeholder docs/chat rows to exercise the schema.
