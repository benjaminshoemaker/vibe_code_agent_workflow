# idea-problem-and-outcome
Non-technical and semi-technical founders hand AI coding tools underspecified or inconsistent specs, causing stalls, mis-implementation, and costly rework. When this works, a founder converts an idea into four validated, agent-ready docs and a clean design spec in about 30 minutes, reducing rework and unblocking delivery.

# idea-ideal-user
Solo founder building a first MVP, non- or semi-technical, comfortable running a CLI and tests, seeking structure to convert ideas into agent-ready artifacts.

# idea-primary-platform
Desktop-first web app using ChatKit for chat UI and LangGraph for orchestration. Rationale: faster typing, side-by-side doc previews, simple export.

# idea-core-outcome
Convert a raw idea into four validated, internally consistent Markdown docs & design spec that an AI coding agent can execute.

# idea-non-goals
* No in-app code generation or repo mutation.
* No GitHub OAuth or PR creation in v1.
* No multi-user collaboration or realtime co-editing.

# idea-core-user-flow
1. Open app → start new or resume session. Right: chat. Left: empty document list.  
2. Idea intake → chat synthesizes and writes `idea_one_pager.md` live in the left rail.  
3. Dev Spec → chat elicits scope, interfaces, data, risks, and success metrics; writes `spec.md`.  
4. Design import → user creates wireframes in a separate design app (MVP , a Figma Make prompt written by the chat) and drops them into `/designs` at the repo root, as well as uploads them into the app/chat so that they can be incorporated into the spec and prompt plan.
5. Prompt Plan → chat generates `prompt_plan.md` with agent steps, commands, expected outputs, and manual steps.  Prompt Plan should also contain, for each prompt, a set of todo checkboxes that the AI agents can check off that maintains progress tracking.
6. Export → user downloads a Zip of all Markdown files; session autosaves and can be resumed.
7. AGENTS.md → Chat generates an AGENTS.md file that captures the guidelines for the AI agents who will be working through this plan.  

# idea-mvp-scope
* Two-pane UI: chat on the right, collapsible docs on the left with live preview.  
* Stage engine with validation: advance only when required outputs are complete; auto-skip if info already present.  
* Generators for four Markdown docs: `idea_one_pager.md`, `spec.md`, `prompt_plan.md`, `AGENTS.md` using templates with incremental writes.  
* Export: one-click Zip including Markdown files; per-doc copy.  
* Session persistence: anonymous session ID; autosave and resume by session ID; lightweight version history; 30-day idle purge.  
* Inline edit + approve per doc; chat ingests edits before proceeding.  
* Design assets ingestion: user drops wireframes into `/designs/` at the repo root & into the chat to incorporate into the spec & plan. 
