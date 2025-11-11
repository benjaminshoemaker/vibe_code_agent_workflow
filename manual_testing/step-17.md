# Step 17 — Stage writers and flow (Manual QA)

- [x] Tests: `pnpm test:unit`, `pnpm test:e2e` (Playwright server binds to `127.0.0.1:3100`)
- [x] `prompt_plan.md` TODOs for Step 17 checked
- [ ] Manual QA (pending human ✅)
- [x] Release notes updated (Step 17 row)
- Commit summary: `feat: add deterministic stage writers for docs`

## Prerequisites
- `pnpm i` completed; dev server runs at `http://localhost:3000`.
- CLI tools: `curl`, `jq`, and `pnpm tsx` (installed via dev deps).

## 1) Start dev server and new session
1. Terminal A: `pnpm dev`
2. Terminal B: initialize a clean session and save cookies:
   - `SESSION_ID=$(curl -s -X POST -c cookies.txt http://localhost:3000/api/session/init | jq -r '.session_id')`
   - Sanity check: `curl -s -b cookies.txt http://localhost:3000/api/session | jq` (expect `current_stage: "intake"`).

## 2) Run writers for Intake → One‑Pager → Spec
Run stages sequentially and log emitted events.

```
SESSION_ID=$SESSION_ID pnpm tsx --eval "
  import { runStage } from './src/services/orchestrator';
  (async () => {
    const id = process.env.SESSION_ID!;
    for (const stage of ['intake','spec'] as const) {
      const events: string[] = [];
      const res = await runStage({ sessionId: id, stage, onEvent: (e) => { console.log('[event]', e.event); events.push(e.event); } });
      console.log('[stage]', stage, 'status=', res.status, 'events=', events.join(','));
    }
  })();
"
```

Expected
- Each stage logs `status= ready` and events include `assistant.delta`, `doc.updated`, and `stage.ready`.

## 3) Verify persisted content (API)
Use the docs API to inspect content:

```
curl -s -b cookies.txt http://localhost:3000/api/docs/idea_one_pager.md | jq -r '.content' | sed -n '1,80p'
curl -s -b cookies.txt http://localhost:3000/api/docs/idea_one_pager.md | rg -n "^#|^## (Problem|Audience|Platform|Core Flow|MVP Features)"
curl -s -b cookies.txt http://localhost:3000/api/docs/spec.md | rg -n "^#|Definition of Done"
```

Expected
- `idea_one_pager.md` contains headings like `## Problem`, `## Audience`, etc.
- `idea_one_pager.md` contains the presence‑check sections.
- `spec.md` includes a `Definition of Done` section.

Note: The left rail in `/app` still shows only current‑stage docs (Step 18 advances stages).

## 4) Run writers for Design → Prompt Plan → Agents
```
SESSION_ID=$SESSION_ID pnpm tsx --eval "
  import { runStage } from './src/services/orchestrator';
  (async () => {
    const id = process.env.SESSION_ID!;
    for (const stage of ['design','prompt_plan','agents'] as const) {
      const events: string[] = [];
      const res = await runStage({ sessionId: id, stage, onEvent: (e) => { console.log('[event]', e.event); events.push(e.event); } });
      console.log('[stage]', stage, 'status=', res.status, 'events=', events.join(','));
    }
  })();
"
```

Verify outputs
```
curl -s -b cookies.txt http://localhost:3000/api/docs/prompt_plan.md | rg -n "^#|^## Design Prompt|^## Stage Progression|^## TODO|^- \[ \]"
curl -s -b cookies.txt http://localhost:3000/api/docs/AGENTS.md | rg -n "^#|Agent responsibility"
```

Expected
- `prompt_plan.md` includes Design Prompt, Stage Progression, Tests/TODOs with checkboxes.
- `AGENTS.md` contains the required "Agent responsibility" section.

## 5) Determinism check (idempotency)
Hash `spec.md`, run the writer again, hash again — hashes should match.

```
H1=$(curl -s -b cookies.txt http://localhost:3000/api/docs/spec.md | jq -r '.content' | shasum -a 256 | awk '{print $1}')
SESSION_ID=$SESSION_ID pnpm tsx --eval "import { runStage } from './src/services/orchestrator'; (async () => { const id=process.env.SESSION_ID!; await runStage({ sessionId:id, stage:'spec' }); })();"
H2=$(curl -s -b cookies.txt http://localhost:3000/api/docs/spec.md | jq -r '.content' | shasum -a 256 | awk '{print $1}')
echo "$H1 == $H2"
```

Expected
- Output: `true` (stable writer output).

## 6) Negative path (needs_more)
Blank a prerequisite and run a dependent stage to see `needs_more`.

```
curl -s -X PUT -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"content":""}' http://localhost:3000/api/docs/idea_one_pager.md | jq

SESSION_ID=$SESSION_ID pnpm tsx --eval "
  import { runStage } from './src/services/orchestrator';
  (async () => {
    const id = process.env.SESSION_ID!;
    const res = await runStage({ sessionId: id, stage: 'spec', onEvent: (e) => console.log('[event]', e.event, e) });
    console.log(JSON.stringify(res, null, 2));
  })();
"
```

Expected
- `status: "needs_more"` with reason like `MISSING_ONE_PAGER`; events include `stage.needs_more`.

## 7) UI spot‑checks (optional)
1. Open `http://localhost:3000/app?resume=1`.
2. Left rail shows documents for the current stage (Intake → `idea_one_pager.md`).
3. Select the doc and switch between Preview/Edit; content for `idea_one_pager.md` reflects writer output.

## Exit criteria
- Writers produce non‑empty docs for all stages and include required sections.
- Events (`assistant.delta`, `doc.updated`, `stage.ready`) are emitted during runs.
- Idempotent outputs on repeat runs.
- `needs_more` path triggers correctly when prerequisites are blanked.
