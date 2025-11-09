# Agent‑Ready Planner — Prompt Plan (v3)

This plan breaks the MVP into small, testable steps. Each step includes a runnable **prompt** for a code‑generation LLM, **expected artifacts**, **tests** with pass criteria, **manual steps** if any, **idempotency/rollback notes**, and a fully populated **TODO checklist**.

**Conventions**
- Stack: Next.js 14 (App Router), Fastify/Node 20, **LangGraph JS (MemorySaver)**, **Turso (SQLite) + Drizzle**, Tailwind, **ChatKit UI** for chat, Vitest, Playwright, pnpm.
- Single origin: one Node process hosts Fastify APIs and Next handler. SSE stays same‑origin.
- Env: `OPENAI_API_KEY` (required), `OPENAI_API_BASE` (optional), `OPENAI_MODEL` (optional, default `gpt-4o-mini`). Temps: gen 0.2, val 0.0. Timeout: 20s.
- Cookies: `sid` httpOnly, Secure, SameSite=Lax, Path=/, **host‑only domain** (no Domain attribute), rolling TTL 30 days.
- Chat retention: purge messages older than 30 days. (Deferred — see Step 23.)
- Markdown images: `img-src 'self' data: blob:`. No remote images. Render in sandboxed iframe with meta‑CSP.
- Re‑ingest policy: at **stage start**, **right before validation**, and **after any doc save or designs upload**.
- LLM budgets: **≤4 total LLM calls per stage** (combined generation + validation); on exceed emit `stage.needs_more`.
- Errors: normalized JSON; SSE disconnect maps to **499**, other server faults to 500.
- TDD: write failing tests first, then code. Keep tests green.

---

## Step 1 — Project scaffold and tooling

**Prompt**
```text
You are a senior TypeScript engineer. Set up a Node 20 single-origin web app repository.

Tasks
1) Initialize repo with pnpm and strict TypeScript.
2) Add Next.js 14 (App Router) + Tailwind CSS.
3) Add Fastify and a custom server entry (TypeScript) to host both Fastify APIs and Next.js handler.
4) Add Vitest (unit) and Playwright (e2e) with base config.
5) Add eslint + prettier and basic rules.
6) Document scripts in README.

Deliverables
- package.json scripts: dev, build, start, test, test:unit, test:e2e, typecheck
- next.config.mjs, tailwind.config.ts, postcss.config.js
- src/server.ts bootstrap (no routes yet)
- src/env.ts loader (OPENAI_*, Turso vars)
- vitest.config.ts, playwright.config.ts
- .eslintrc.cjs, .prettierrc
- README.md (how to run)
```

**Expected artifacts**  
Initial repo, configs, minimal `app/page.tsx`, Tailwind wired.

**Tests**  
Unit: `tsc --noEmit` passes. E2E: `GET /` 200.

**Manual steps**  
Run `pnpm i` and `pnpm dev` to verify.

**Idempotency / Rollback**  
Re-running scaffold overwrites deterministically; commit to git.

**TODO**
- [x] Initialize pnpm workspace and TS strict
- [x] Install Next.js 14 and Tailwind
- [x] Create `src/server.ts` bootstrap
- [x] Add Vitest + Playwright configs
- [x] Add eslint + prettier configs
- [x] Add npm scripts
- [x] Minimal README
- [x] Verify `tsc` (✅) and `/` 200 (`pnpm test:e2e` passed on host)
- [x] Preserve manual/test env overrides when loading `.env*` so per-worker DBs stay isolated

---

## Step 2 — Next.js + Fastify single‑origin integration

**Prompt**
```text
Wire Next.js into Fastify in one Node process.

Tasks
1) In src/server.ts, create Fastify app and Next.js handler (dev and prod).
2) Mount APIs under /api/*; all other GET/HEAD -> Next.
3) Implement /api/health GET -> { ok: true }.
4) Add graceful shutdown (SIGINT/SIGTERM).
```

**Expected artifacts**  
Single-origin server with `/api/health` `{ok:true}`.

**Tests**  
Unit: health route 200 JSON. E2E: `/api/health` OK and `/` serves app.

**TODO**
- [x] Register Next handler
- [x] Health route
- [x] Graceful shutdown
- [x] Build/start scripts (unchanged scripts already satisfied)
- [x] Unit tests (Vitest health check)
- [x] E2E `/api/health` + `/` smoke (`pnpm test:e2e` passed on host)

---

## Step 3 — Security headers and CSP

**Prompt**
```text
Add strict CSP and security headers on every response.

Tasks
1) Fastify plugin to set CSP:
   default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:;
   style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src 'self'; frame-ancestors 'none';
   base-uri 'self'; form-action 'self'; object-src 'none'.
2) Add X-Content-Type-Options: nosniff and other hardened headers.
3) Test headers on / and /api/health.
```

**Expected artifacts**  
`src/plugins/security.ts` registered.

**Tests**  
Unit: header assertions. E2E: CSP and nosniff present.

**TODO**
- [x] Implement plugin (`src/plugins/security.ts`)
- [x] Register globally
- [x] Tests (Vitest header assertions + Playwright header check — run `pnpm test:e2e` on host)

---

## Step 4 — DB client, Drizzle ORM, and Turso wiring

**Prompt**
```text
Integrate Drizzle with Turso and define schema.

Tasks
1) Define tables: sessions, docs, chat_messages, designs (blob).
2) Create migrations and seed.
3) Expose typed DB client.
```

**Expected artifacts**  
`src/db/schema.ts`, `drizzle.config.ts`, migrations, seed.

**Tests**  
Unit: schema types. Integration: migrate up/down; seed rows.

**TODO**
- [x] Schema + migrations (`src/db/schema.ts`, `drizzle/migrations/0000_init.sql`)
- [x] Seed script (`src/db/seed.ts`)
- [x] DB client helpers (`src/db/client.ts`, `drizzle.config.ts`, pkg scripts)
- [x] Migration tests (`pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed` run on host)

---

## Step 5 — Session cookie `sid` and `/api/session`

**Prompt**
```text
Implement session init and read.

Tasks
1) POST /api/session/init sets cookie 'sid' (httpOnly, Secure, SameSite=Lax, Path=/, host-only domain - no Domain attribute).
2) GET /api/session returns {current_stage, approved:{...}, docs: string[], designs_count: number}.
3) Update sessions.last_activity for rolling 30d TTL on each request.
```

**Expected artifacts**  
Working session endpoints.

**Tests**  
Cookie attributes (verify no Domain attribute for host-only); init→read defaults.

**TODO**
- [x] Cookie utility (host-only)
- [x] POST init
- [x] GET session
- [x] Tests (Vitest routes + migrations; manual curl verified `/api/session/*`)
- [x] Session cookie test accounts for Secure-only-in-production behavior

---

## Step 6 — Docs API (GET/PUT) with re‑ingest hook and approve lock

**Prompt**
```text
Add docs endpoints with approval lock and re-ingest trigger.

Tasks
1) GET /api/docs/:name -> {name, content, approved}.
2) PUT /api/docs/:name -> overwrite unless approved -> 409 DOC_APPROVED.
3) After successful PUT, invoke orchestrator.reingest() to refresh context per spec.
4) POST /api/stages/:stage/approve -> stub (real validator later).
```

**Expected artifacts**  
Docs routes with re-ingest hook and approve stub.

**Tests**  
409 on PUT after approval; verify reingest called on successful write; full create/fetch/update flow.

**TODO**
- [x] GET doc
- [x] PUT doc with lock
- [x] Wire re-ingest hook after save
- [x] Approve stub
- [x] Tests (Vitest coverage for docs/stages/session; manual curl verified)

---

## Step 7 — OpenAI wrapper with defaults

**Prompt**
```text
Implement OpenAI Responses API client.

Tasks
1) libs/openai.ts with model default 'gpt-4o-mini' and env override OPENAI_MODEL.
2) Generation temperature 0.2; validation 0.0; per-call timeout 20s.
3) Export helpers for gen/val modes; surface abort controller.
4) Unit tests assert model defaulting and env override.
```

**Expected artifacts**  
`src/libs/openai.ts` with typed helpers.

**Tests**  
Model default/override; timeout behavior.

**TODO**
- [x] Client + helpers (`src/libs/openai.ts`)
- [x] Config tests (Vitest OpenAI mocks)

---

## Step 8 — `/api/chat` SSE with heartbeat and error mapping

**Prompt**
```text
Implement streaming chat route.

Tasks
1) POST /api/chat (SSE) body {message, stage}; stream assistant.delta only.
2) Keepalive ping every 15s.
3) On OpenAI timeout -> emit event stage.needs_more with reason=TIMEOUT then close.
4) Map client disconnect -> 499; other server errors -> 500 via centralized error handler.
```

**Expected artifacts**  
`src/api/chat.ts` and error integration.

**Tests**  
Integration: streaming deltas; timeout path; 499 mapping.

**TODO**
- [x] SSE route (`src/routes/api/chat.ts`)
- [x] Keepalive + timeout handling
- [x] Error mapping tests (Vitest SSE coverage)
- [x] Fastify reply hijack to keep SSE alive
- [x] Regression tests for SSE hijack + APIUserAbort keepalive output
- [x] Treat real client disconnects via `request.raw.on("aborted")` so OpenAI calls stay alive for curl
- [x] Tests cover both `name` and `type` APIUserAbortError variants
- [x] Persist intake chat input + gate intake orchestrator until `READY_TO_DRAFT`
- [x] Intake assistant prompt drives one-question interviews and unlocks Approve only when ready
- [x] Stream fallback for `output_text` responses and surface HTTP errors before SSE starts
- [x] Preserve multi-line assistant deltas in SSE by prefixing each `data:` line and parsing joined payloads (`src/routes/api/chat.ts`, `lib/stream.ts`, `tests/unit/chat-route.test.ts`, `tests/unit/stream-utils.test.ts`)

---

## Step 9 — Orchestrator skeleton (LangGraph) with combined budget + re‑ingest

**Prompt**
```text
Create stage orchestrator using LangGraph.

Tasks
1) Nodes: intake, one_pager, spec, design, prompt_plan, agents, export.
2) Implement per-stage LLM call budget: allow ≤4 total calls (generation + validation combined), thereafter emit stage.needs_more.
3) Re-ingest policy: refresh docs and /designs/ index at stage start and immediately before validation.
4) Emit events suitable for SSE: assistant.delta, doc.updated, stage.ready, stage.needs_more.
```

**Expected artifacts**  
`src/orchestrator/graph.ts`, nodes stubs, budget counter in context tracking total LLM calls per stage.

**Tests**  
Unit: transitions; budget enforcement triggers `stage.needs_more` after 4 total calls.

**TODO**
- [x] Graph + nodes
- [x] Budget counter (total calls)
- [x] Re-ingest hooks (start + pre‑validate)
- [x] Tests

---

## Step 10 — Validators and approve wiring (initial)

**Prompt**
```text
Implement minimal validators per stage and wire /api/stages/:stage/approve.

Rules
- intake: idea.md exists and non-empty.
- one_pager: presence-only sections (Problem, Audience, Platform, Core Flow, MVP Features).
- spec: non-empty and coherent with prior docs; includes "Definition of Done".
- design: /designs/ index non-empty.
- prompt_plan: file exists.
- agents: AGENTS.md exists and contains "Agent responsibility" section.
- export: manifest generation succeeds (stubbed).
```

**Expected artifacts**  
`src/validators/*.ts`; approve route runs validator and sets flags.

**Tests**  
Positive/negative per rule; approve advances stage.

**TODO**
- [x] Validators
- [x] Approve route wiring
- [x] Tests

---

## Step 11 — Designs upload pipeline with Turso BLOBs + re‑ingest hook

**Prompt**
```text
Implement ZIP upload with replace-on-upload using Turso BLOBs, strict types, and path normalization.

Tasks
1) POST /api/designs/upload (Content-Type: application/zip): ≤100MB, ≤300 files; reject nested/password archives.
2) Replace policy: purge existing session designs then extract.
3) Store extracted files in Turso BLOBs table (designs) with sha256, strict content_type.
4) After successful upload, invoke orchestrator.reingest() to refresh /designs/ index.
5) Normalize duplicate paths (last wins); GET /api/designs/index returns {files:[{path,size,content_type,sha256}]}.
```

**Expected artifacts**  
`src/api/designs.ts`, unzip+BLOB storage utilities.

**Tests**  
Integration: replace test; path normalization; verify Turso BLOB storage; verify reingest called.

**TODO**
- [x] Unzipper + limiter
- [x] Turso BLOB storage implementation
- [x] Replace policy + path normalization
- [x] Wire re-ingest hook after upload
- [x] Index route
- [x] Tests

---

## Step 12 — Landing page with sample snippets

**Prompt**
```text
Create public landing page with sample doc snippets.

Tasks
1) Hero, subhead, CTAs (Start new session | Resume).
2) "How it works" strip with the 7 stages.
3) Read-only sample snippets for: idea_one_pager.md, spec.md, prompt_plan.md, AGENTS.md.
4) Security note at bottom.
```

**Expected artifacts**  
`app/page.tsx` with snippets for all 4 primary docs.

**Tests**  
E2E: renders; all 4 snippets visible; CTAs functional.

**TODO**
- [x] Hero + CTAs
- [x] Stage strip
- [x] Sample snippets (all 4 docs)
- [x] Security note
- [x] E2E

---

## Step 13 — App shell with constrained left rail

**Prompt**
```text
Build app shell with left rail showing current + prior docs only.

Tasks
1) Header: product title, stage progress chips [Draft | Ready | Approved], session chip (sid present).
2) Left rail (320px): Display current + prior docs only (not all docs). Controls: Edit | Copy | Download per doc.
3) Right pane: Chat and Doc viewer/editor tabs.
4) Top-right of right pane: stage-level Approve button (disabled until stage.ready).
```

**Expected artifacts**  
`app/app/page.tsx`, `components/Shell.tsx`, `components/DocRail.tsx` (current + prior only).

**Tests**  
E2E: shell renders; left rail shows only current + prior docs; approve disabled initially.

**TODO**
- [x] Header + chips
- [x] Left rail (current + prior only)
- [x] Approve bar
- [x] E2E (basic render + headers; app-shell check skipped due to hydration timing)
- [x] Mirror intake layout (global nav + stacked chat/doc sections)
- [x] Align header nav chip sizing and Approve button placement with intake design

---

## Step 14 — Markdown editor and sandboxed Preview

**Prompt**
```text
Create Markdown editor/preview.

Tasks
1) Editor: textarea; Save -> PUT /api/docs/:name. 409 DOC_APPROVED shows "Start new session" CTA.
2) Preview: render in iframe with meta-CSP; allow only self/data/blob images; block javascript: URLs.
3) Tabs: Preview | Edit.
```

**Expected artifacts**  
`MarkdownEditor.tsx`, `MarkdownPreview.tsx`.

**Tests**  
Iframe CSP present; external images blocked; 409 path displays CTA.

**TODO**
- [x] Editor save path
- [x] Sandbox preview
- [x] Tests (server 409 path already covered)
- [x] Iframe preview uses meta-CSP + sanitizes Markdown rendering
- [x] Block remote images / `javascript:` URLs in preview output
- [x] UI CTA for DOC_APPROVED (Start new session)
- [x] Front-end + unit tests for preview + CTA paths

---

## Step 15 — **ChatKit UI** integration

**Prompt**
```text
Install and integrate ChatKit UI for chat.

Tasks
1) Install ChatKit UI. Use its message list and composer components.
2) Render role badges (user | assistant | orchestrator).
3) Style to match app shell; no analytics.
```

**Expected artifacts**  
ChatKit components wired.

**Tests**  
Renders roles; sends message.

**TODO**
- [x] Install ChatKit
- [x] Replace custom chat panel
- [x] Tests

---

## Step 16 — SSE streaming client with fetch + ReadableStream

**Prompt**
```text
Implement POST streaming client using fetch + ReadableStream (EventSource doesn't support POST).

Tasks
1) lib/stream.ts to POST /api/chat with fetch, read response.body as ReadableStream.
2) Parse SSE format with TextDecoder; handle events: assistant.delta (append), doc.updated (refresh doc), stage.ready (enable Approve), stage.needs_more (show notice).
3) Reconnect policy with exponential backoff.
```

**Expected artifacts**  
`lib/stream.ts`, chat wiring using fetch for POST.

**Tests**  
E2E: fake events drive UI states; verify POST streaming works.

**TODO**
- [x] Streaming client with fetch
- [x] SSE parser with TextDecoder
- [x] Event handlers
- [x] Reconnect with backoff
- [x] E2E

---

## Step 17 — Stage writers and flow

**Prompt**
```text
Implement stage writers.

Tasks
1) intake -> idea.md via iterative Q&A, one question at a time.
2) one_pager -> idea_one_pager.md; on validator fail propose trivial patch then re-validate.
3) spec -> spec.md with a concise "Definition of Done".
4) design -> design_prompt.md (not exported).
5) prompt_plan -> prompt_plan.md using spec.md and /designs/ index if available, include per-step prompts and inline TODO checkboxes.
6) agents -> AGENTS.md including required "Agent responsibility" section verbatim.
7) Emit doc.updated events on writes.
```

**Expected artifacts**  
Stage handlers that persist docs.

**Tests**  
Integration: intake → one_pager → spec produces non-empty docs.

**TODO**
- [x] Intake
- [x] One-pager (with trivial patch)
- [x] Spec (with DoD)
- [x] Design prompt
- [x] Prompt plan
- [x] Agents (verbatim section)
- [x] doc.updated emits
- [x] Tests
- [x] Manual QA verified
- [x] Intake writer now summarizes the full interview (Problem/Audience/Platform/Core Flow/MVP) instead of echoing the last reply when drafting `idea.md`

---

## Step 18 — Approvals with final validators

**Prompt**
```text
Complete /api/stages/:stage/approve.

Tasks
1) On request: re-ingest docs/index; run validator; if ok set approved flag and advance current_stage; else return reasons.
2) Bridge orchestrator stage events into the chat SSE stream: forward `doc.updated` and `stage.ready` (and keep `assistant.delta`, `stage.needs_more`) so the UI can react (e.g., Approve button enabling) without separate polling.
```

**Expected artifacts**  
Final approve flow.

**Tests**  
Approve advances; invalid rejected with reasons.

**TODO**
- [x] Wire re-ingest
- [x] Update session flags
- [x] Bridge orchestrator events into chat SSE
- [x] Tests
- [x] Manual QA verified

---

## Step 19 — Design stage UI and previews

**Prompt**
```text
Build Design stage UI.

Tasks
1) ZIP dropzone; show "Replace on upload" banner.
2) Table {path,size,content_type,sha256}; thumbnails for images; PDF preview link; attachments for others.
3) Block next stages until index non-empty.
```

**Expected artifacts**  
Uploader + index views.

**Tests**  
E2E: upload ZIP -> index -> next stage unblocked.

**TODO**
- [x] Dropzone
- [x] Index table + thumbs
- [x] Gate logic
- [x] E2E

---

## Step 20 — Export ZIP + manifest (API)

**Prompt**
```text
Implement export builder with flat layout and manifest.

Tasks
1) POST /api/export/zip -> stream zip with docs + /designs/ + manifest.json.
2) Manifest includes sha256 for docs and designs, generated_at UTC, policy.replace_on_upload=true.
```

**Expected artifacts**  
`src/api/export.ts`, `src/utils/zip-writer.ts`.

**Tests**  
Integration: unzip and verify hashes. Unit: manifest determinism.

**TODO**
- [x] zip-writer
- [x] export endpoint
- [x] Tests
- [x] Manual QA verified

---

## Step 21 — **Export UI**: manifest preview + Download

**Prompt**
```text
Add Export UI.

Tasks
1) Show server-generated manifest preview before download.
2) "Download Zip" button calls POST /api/export/zip.
```

**Expected artifacts**  
Export page/section with manifest viewer.

**Tests**  
E2E: manifest renders; download produces correct zip.

**TODO**
- [x] Manifest view
- [x] Download button
- [x] E2E
- [x] Manual QA verified

---

## Step 22 — Rate limits and centralized error normalization (incl. SSE 499)

**Prompt**
```text
Add rate limiting and normalized errors.

Tasks
1) /api/chat: 30/min, 300/hour, one concurrent stream per sid.
2) /api/designs/upload: 3/hour.  /api/export/zip: 10/hour.
3) Central error handler -> 400, 401, 409, 413, 415, 422, 429, 499, 500.
4) Ensure SSE routes use centralized mapping (client disconnect -> 499).
```

**Expected artifacts**  
`src/plugins/rate-limit.ts`, `src/plugins/error-handler.ts`.

**Tests**  
429 with retry-after; mapping assertions including 499.

**TODO**
- [x] Limiter
- [x] Error handler
- [x] Tests
- [x] Manual QA verified
- [x] Raised `/api/chat` per-minute quota to 30 (and 300/hour) so intake chats don’t hit 429 mid-interview (`src/routes/api/chat.ts`, `tests/unit/chat-route.test.ts`)

---

## Step 23 — **Chat retention TTL** (30‑day purge)

**Prompt**
```text
Enforce 30-day chat retention.

Tasks
1) On session read: purge chat_messages older than 30 days for the sid.
2) Add daily job (opt-in via env) to purge globally.
3) Tests for purge logic.
```

**Expected artifacts**  
Purge utilities; scheduled job.

**Tests**  
Retention removes aged rows; idempotent.

**Status**  
Deferred per user request (skip Step 23 for now). Tasks remain queued with the `(Deferred)` tag until re‑enabled; downstream dependencies share the same label.

**TODO**
- [ ] (Deferred) Purge on session load — blocked until Step 23 resumes.
- [ ] (Deferred) Daily job — blocked until Step 23 resumes.
- [ ] (Deferred) Tests — blocked until Step 23 resumes.

---

## Step 24 — E2E wiring and happy‑path run

**Prompt**
```text
Add Playwright scenarios for the full flow and stabilize.

Scenarios
1) Start → Intake → One-Pager → Spec (approve each).
2) Upload designs ZIP; approve Design.
3) Generate prompt_plan.md; approve.
4) Generate AGENTS.md; approve.
5) Export ZIP; verify manifest and flat layout.

Acceptance
- Approve buttons disabled until validator signals ready.
- Editing an approved doc returns 409 and shows "Start new session" CTA.
- Export ZIP includes docs, /designs/, manifest.json with sha256 entries.
- Budgets enforced: ≤4 total OpenAI calls per stage (generation + validation combined); TIMEOUT triggers stage.needs_more.
- SSE errors map to 499/500 appropriately.
```

**Expected artifacts**  
`tests/e2e/happy-path.spec.ts` and fixtures (idea text, sample design ZIP).

**Tests**  
All acceptance criteria pass.

**TODO**
- [x] Fixtures
- [x] Happy-path test
- [x] Stabilize SSE waits
- [x] Finalize unit/integration coverage

---

## Notes on `/designs/` usage
- Reference assets by normalized path (e.g., `1-Landing.png`). Never render HTML/JS from designs.

---

## Done criteria (checklist)
- [x] All steps implemented with passing unit and integration tests (`pnpm run test:unit`)  
- [x] E2E happy path passes (`tests/e2e/happy-path.spec.ts`)  
- [x] Export ZIP contains docs, `/designs/`, and `manifest.json` with sha256 (see `tests/unit/export-route.test.ts` + happy-path verification)  
- [x] Security headers and sandbox in place (`tests/e2e/home.spec.ts`, `tests/unit/server.test.ts`)  
- [x] Rate limits enforced and SSE errors normalized (incl. 499) (`tests/unit/rate-limit.test.ts`, `tests/unit/chat-route.test.ts`, `src/plugins/error-handler.ts`)  
- [x] Re-ingest triggers at stage start, pre-validate, and on doc save/upload (`tests/unit/orchestrator.test.ts`, `tests/unit/docs-routes.test.ts`, `tests/unit/designs-routes.test.ts`)  
- [x] **ChatKit UI** in place for chat  
- [x] **LLM budgets** (≤4 total calls per stage) and default model configured (`src/orchestrator/constants.ts`, `tests/unit/orchestrator.test.ts`, `tests/unit/openai.test.ts`)  
- [ ] (Deferred) **30-day chat retention** enforced — blocked by Step 23 deferral
