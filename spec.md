# Agent‑Ready Planner — v1 Technical Specification (`spec.md`)

## 1. Overview
**Goal.** Turn a raw idea into five agent‑ready Markdown docs plus a design bundle, with gated stages and human approval.

**Audience.** Solo founders planning to use AI coding agents or contractors.

**Stage graph.** `intake → one_pager → spec → design → prompt_plan → agents → export`

**Agents.**
- **AI Orchestrator** (in‑app): validates stage gates, proposes patches, writes section updates.
- **Developer/Agent** (external): executes `prompt_plan.md` outside the app.

**Non‑goals (v1).** No repo writes, no PRs, no OAuth, no in‑app codegen, no multi‑user collaboration, no analytics.

---

## 2. Architecture

### 2.1 Stack
- **Web:** Next.js 14 (App Router), Tailwind CSS, ChatKit UI for chat.
- **API:** Fastify on Node 20. Single origin with the Web in one container/process.
- **Orchestration:** LangGraph JS (`MemorySaver`).
- **DB:** Turso (SQLite). Drizzle ORM.
- **Storage:** Turso BLOBs for `/designs/` assets.
- **Tooling:** pnpm, Vitest, Playwright.

### 2.2 Deployment topology
- **Single origin**. Next.js and Fastify served together. SSE stays same‑origin. Cookie `sid` is first‑party.

### 2.3 Runtime components
- **Next.js UI:** two‑pane app; landing page; SSE client for chat; left rail shows current + prior docs.
- **Fastify API:** session, chat, docs, stages, designs, export, health.
- **Orchestrator service:** LangGraph graph per session; generation and validation calls to OpenAI.

---

## 3. Data model

### 3.1 Tables (Drizzle schema)
```ts
// sessions
session_id TEXT PRIMARY KEY,
current_stage TEXT CHECK(current_stage IN ('intake','one_pager','spec','design','prompt_plan','agents','export')) NOT NULL,
approved_intake INTEGER DEFAULT 0,
approved_one_pager INTEGER DEFAULT 0,
approved_spec INTEGER DEFAULT 0,
approved_design INTEGER DEFAULT 0,
approved_prompt_plan INTEGER DEFAULT 0,
approved_agents INTEGER DEFAULT 0,
created_at DATETIME NOT NULL,
last_activity DATETIME NOT NULL

// docs
session_id TEXT NOT NULL,
name TEXT NOT NULL,              // 'idea.md' | 'idea_one_pager.md' | 'spec.md' | 'prompt_plan.md' | 'AGENTS.md'
content TEXT NOT NULL,
approved INTEGER DEFAULT 0,
updated_at DATETIME NOT NULL,
UNIQUE(session_id, name)

// chat_messages
id INTEGER PRIMARY KEY AUTOINCREMENT,
session_id TEXT NOT NULL,
stage TEXT,                      // nullable; for correlation
role TEXT CHECK(role IN ('user','assistant','orchestrator')) NOT NULL,
content TEXT NOT NULL,
created_at DATETIME NOT NULL,
INDEX(session_id, created_at)

// designs (BLOB)
session_id TEXT NOT NULL,
path TEXT NOT NULL,              // e.g. '1-Landing.png'
size INTEGER NOT NULL,
content_type TEXT NOT NULL,      // strict, no sniff
sha256 TEXT NOT NULL,
data BLOB NOT NULL,
PRIMARY KEY(session_id, path)
```

### 3.2 Session model
- **Cookie:** `sid` httpOnly, Secure, SameSite=Lax, Path=/, host‑only domain, rolling TTL 30 days.
- **Persistence:** autosave after each chat, doc save, ZIP upload. Chat retained 30 days.

### 3.3 Documents
- Names: `idea.md`, `idea_one_pager.md`, `spec.md`, `prompt_plan.md`, `AGENTS.md`.
- No versioning. Overwrite on save. `approved` flag per doc.

---

## 4. APIs

### 4.1 Endpoints
- `POST /api/session/init` → sets `sid`; returns `{session_id}`.
- `GET /api/session` → `{current_stage, approved: {intake,...}, docs: string[], designs_count: number}`.
- `POST /api/chat` (SSE) body `{message: string, stage: string}`  
  **Events:**  
  `assistant.delta` (string), `doc.updated` ({name, size}), `stage.needs_more` (reason), `stage.ready` (stage).
- `GET /api/docs/:name` → `{name, content, approved}`.
- `PUT /api/docs/:name` body `{content}` → `{ok:true}`.  
  **If doc approved:** return `409 {error: "DOC_APPROVED"}` with UI prompting “Start new session.”
- `POST /api/stages/:stage/approve` → runs validator; returns `{ok:true}` or `{ok:false, reasons: string[]}`.
- `POST /api/designs/upload` `Content-Type: application/zip` →  
  Validates constraints, purges `/designs/`, extracts, stores BLOBs, computes sha256.  
  Response: `{files:[{path,size,content_type,sha256}], replaced: true}`.
- `GET /api/designs/index` → `{files:[{path,size,content_type,sha256}]}`.
- `POST /api/export/zip` → binary Zip download.
- `GET /api/health` → `{ok:true}`.

### 4.2 Rate limits (per `sid`)
- `/api/chat`: 5/min, 60/hour, 1 concurrent stream.
- `/api/designs/upload`: 3/hour.
- `/api/export/zip`: 10/hour.

### 4.3 Errors (common)
- `400` invalid input, `401` no session, `409` approved/locked, `413` too large, `415` unsupported media type, `422` validator failed, `429` rate limit, `500` server.

---

## 5. Orchestration

### 5.1 LLM config
- Provider: OpenAI.
- Model: `gpt-4o-mini` for generation and validation.
- Responses API. Temperature: gen 0.2, val 0.0. Timeout 20s. Max 4 LLM calls per stage then `stage.needs_more`.

### 5.2 Re‑ingest policy
- Re‑ingest all current docs and `/designs/` index at **stage start**, **right before validation**, and **after any doc save or designs upload**.  
- Do **not** auto re‑ingest on every chat turn.

### 5.3 Stage rules (global)
- Human **Approve** required to advance.  
- Edits after approval are **not accepted** in the same session: UI allows typing but `PUT` returns 409. User starts a new session to continue.  
- Events emitted: `stage.needs_more`, `stage.ready`, `doc.updated`, `assistant.delta`.

### 5.4 Nodes

**intake**
- **Input:** initial idea text.
- **Prompt:** collects Problem, Audience, Platform, Core Flow, MVP Features, optional Non‑Goals; one question at a time; outputs `idea.md`.
- **Exit gate:** `idea.md` non‑empty and coherent.
- **Failure:** ask targeted follow‑ups (≤4 calls), then `stage.needs_more`.

**one_pager**
- **Input:** `idea.md`.
- **Prompt:** iterative Q&A; outputs `idea_one_pager.md`. No elevator pitch required.
- **Exit gate:** presence‑only for Problem, Audience, Platform, Core Flow, MVP Features; optional Non‑Goals, Outcome; coherence check.
- **Failure:** orchestrator proposes a one‑line patch; re‑validate.

**spec**
- **Input:** `idea_one_pager.md`.
- **Flow:** Q&A then compile; outputs `spec.md` including a concise **Definition of Done** section.
- **Exit gate:** non‑empty and coherent with prior docs (minimal gate).

**design**
- **Input:** `spec.md`.
- **Prompt:** produce `design_prompt.md` (not exported).  
- **User action:** upload a ZIP of design exports. **Required** for advance.
- **Exit gate:** ZIP validated and ingested; `/designs/` index non‑empty.

**prompt_plan**
- **Input:** `spec.md` + `/designs/` index.
- **Prompt:** outputs `prompt_plan.md` with per‑step prompts and inline TODO checkboxes.
- **Exit gate:** file exists (presence‑only) + human approval.

**agents**
- **Input:** `prompt_plan.md`, `spec.md`, `idea.md`, `idea_one_pager.md`, `/designs/` index.
- **Prompt:** outputs `AGENTS.md`, includes required blocks verbatim.
- **Exit gate:** file exists, includes doc descriptions and required **Agent responsibility** section verbatim; coherence check.

**export**
- **Action:** build flat Zip bundle with docs + `/designs/` + `manifest.json`.

---

## 6. Design ingestion

### 6.1 Upload constraints
- Max ZIP 100 MB. Max 300 files. Reject password‑protected or nested archives.
- On upload: **replace** strategy. Purge existing `/designs/`, then extract all files.
- Compute `sha256` for each file; store BLOB with strict `content_type`.
- Previews only for images/PDF. All other files list as downloadable attachments.
- Never render HTML/JS from designs.

### 6.2 API contract
```json
// GET /api/designs/index
{ "files": [ { "path": "1-Landing.png", "size": 12345, "content_type": "image/png", "sha256": "..." } ] }
```

---

## 7. Export

### 7.1 Layout (flat)
```
idea.md
idea_one_pager.md
spec.md
prompt_plan.md
AGENTS.md
manifest.json
/designs/...
```

### 7.2 Manifest
```json
{
  "generated_at": "ISO-8601 UTC timestamp",
  "docs": [
    {"name":"idea.md","sha256":"..."},
    {"name":"idea_one_pager.md","sha256":"..."},
    {"name":"spec.md","sha256":"..."},
    {"name":"prompt_plan.md","sha256":"..."},
    {"name":"AGENTS.md","sha256":"..."}
  ],
  "designs": [
    {"path":"1-Landing.png","size":12345,"content_type":"image/png","sha256":"..."}
  ],
  "policy": { "replace_on_upload": true }
}
```

---

## 8. UI/UX

### 8.1 Landing
- Hero, subhead, CTAs: **Start new session**, **Resume**.  
- “How it works” strip with the 7 stages.  
- Read‑only sample snippets of the four primary docs.  
- Security note.

### 8.2 App shell
- Header: product title, stage progress chips `[Draft | Ready | Approved]`, session chip (sid present).
- Left rail (320px): **current + prior** docs only. Controls: **Edit**, **Copy**, **Download** per doc. Stage‑level **Approve** button at top right pane.
- Right pane: Chat (role badges), Doc viewer/editor tabs: **Preview** (Markdown render) and **Edit** (monospace).

### 8.3 States
- Approve disabled until validator emits `stage.ready`.
- After stage approval, docs stay editable in UI but saves return 409 with CTA “Start new session.”
- Design stage UI: ZIP dropzone; table `[path | size | content_type | sha256]`; “Replace on upload” banner; thumbnails for images, attachments for others.
- Export UI: manifest preview and “Download Zip”.

---

## 9. Security

### 9.1 App CSP (headers)
```
default-src 'self';
script-src 'self';
connect-src 'self';
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
frame-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none'
```

### 9.2 Markdown rendering
- Allow raw HTML in Markdown. Render inside a sandboxed iframe with meta‑CSP:
```
default-src 'none';
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
script-src 'none';
connect-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```
- Block remote images not hosted by the app: `img-src 'self' data: blob:`.
- Disallow `javascript:` URLs.

### 9.3 Design ingestion
- Block HTML/JS from previews. Enforce strict `Content-Type`. Disable MIME sniffing.

### 9.4 Cookies
- `sid` httpOnly, Secure, SameSite=Lax, Path=/, host‑only, 30‑day rolling TTL.

---

## 10. Error handling

### 10.1 Chat/SSE
- On OpenAI timeout: abort stream, emit `stage.needs_more` with reason `TIMEOUT`, suggest retry.
- On stream error: close with `event: stage.needs_more` and 499/500 as appropriate.
- Rate limit violations emit `429` and a toast.

### 10.2 Validation
- Validator returns `{ok:false, reasons:[...]}` with human‑readable, one‑line reasons.
- Orchestrator may propose a one‑line patch for trivial fixes.

### 10.3 Designs upload
- Errors: `413` size, `422` nested/password archive, `415` bad types if archive not ZIP, duplicate paths normalized.
- On success: toast “Upload replaced N files.”

### 10.4 Docs
- `PUT` after approval → `409 DOC_APPROVED` with CTA.

---

## 11. Testing plan

### 11.1 Unit
- Validators: each stage passes expected presence/coherence rules.
- Linkers: `/designs/` index build and manifest generation.
- Security: Markdown renderer enforces CSP and sandbox; images constrained.

### 11.2 Integration
- Happy path `idea → one_pager → spec → design → prompt_plan → agents → export`.
- Seeded determinism: fixture idea yields stable outputs within token/time budgets.
- Design upload: replace policy, sha256 computed, index exposed.

### 11.3 E2E (Playwright)
- Strict mode flow with human Approve at each stage.
- Edit‑after‑approve: attempt to edit approved doc, receive 409 and “Start new session” CTA.
- Export produces flat Zip; manifest hashes match server‑computed sha256.

### 11.4 Budgets
- ≤ 4 LLM calls per stage before `stage.needs_more`.
- OpenAI call timeout 20s; UI shows retry affordance on timeout.

---

## 12. Interfaces (internal contracts)

### 12.1 SSE event shapes
```ts
type AssistantDelta = { event: "assistant.delta"; data: string };
type DocUpdated    = { event: "doc.updated"; data: { name: string; size: number } };
type StageNeedsMore= { event: "stage.needs_more"; data: { stage: string; reason: string } };
type StageReady    = { event: "stage.ready"; data: { stage: string } };
```

### 12.2 Designs index shape
```ts
type DesignFile = { path: string; size: number; content_type: string; sha256: string };
type DesignsIndex = { files: DesignFile[] };
```

### 12.3 Manifest shape
See §7.2.

---

## 

