# Idea → Agent-Ready One-Pager

## Problem
Early founders hand AI coding tools specs that are underspecified or inconsistent. Work stalls, gets mis-implemented, and rework mounts. The fix is a guided process that converts an idea into five validated, internally consistent docs plus a clean design spec in about 30 minutes.

## Audience
Solo founders building a first MVP who are non- or semi-technical but comfortable running a CLI and basic tests, and want structure to get from raw idea to agent-ready artifacts.

## Ideal Customer
Pre-seed or seed founder without a full-time engineering team who plans to use AI agents or contract developers and needs crisp, validated inputs.

## Platform
Web app (desktop-first, mobile responsive). Two-pane layout using ChatKit (chat UI). Right rail: chat. Left rail: collapsible documents with live preview and version notes.

## Product summary
A chat-guided workflow that converts an initial idea into five agent-ready Markdown outputs. The stage engine validates required fields, keeps chat and documents in sync, and only advances when exit criteria are met. Users can edit and approve each document inline. Final outputs export as a Zip or a GitHub PR branch.

## Core Flow
1. Start a new or resume a prior session. Right: chat. Left: doc list.
2. Idea intake → chat synthesizes and writes `idea.md`.
3. One-pager synthesis → chat proposes `idea_one_pager.md` for edit and approval.
4. Dev Spec → chat elicits scope, interfaces, data, risks, success metrics → writes `spec.md`.
5. Design import → founder creates wireframes from a chat-generated prompt; uploads ZIP file to the app for incorporation.
6. Prompt Plan → chat generates `prompt_plan.md` with agent steps, commands, expected outputs, manual steps, and per-prompt todo checkboxes for progress tracking.
7. Export → download a Zip of all Markdown files; autosave enables resume.
8. `AGENTS.md` → chat writes agent guidelines for executing the plan.

## MVP Scope
- Two-pane UI with live doc preview.
- Stage engine with validation: advance only when required outputs are complete; auto-skip if info already exists.
- Generators for five Markdown docs: `idea.md`, `idea_one_pager.md`, `spec.md`, `prompt_plan.md`, `AGENTS.md`.
- Export: one-click Zip and per-doc copy.
- Session persistence: anonymous session ID, autosave/resume, lightweight history, 30-day idle purge.
- Inline edit + approve per doc; chat re-ingests edits before continuing.
- Design asset ingestion via in-app ZIP upload.

## Non-Goals (v1)
- No in-app code generation or repo mutation.
- No GitHub OAuth or PR creation.
- No multi-user collaboration or realtime co-editing.

## Outcome
A raw idea becomes five validated, internally consistent docs plus a design spec that an AI coding agent can execute with minimal friction.

## Definition of done

Exported directory containing `idea.md`, `idea_one_pager.md`, `spec.md`, `prompt_plan.md`, `AGENTS.md`, and the design files under `/designs/` internally consistent and passing stage validations.
