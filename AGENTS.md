# AGENTS.md

## Overview
This repo turns a raw idea into five agent‑ready Markdown docs plus a design bundle, with gated stages and human approval.

**Stage flow:** `intake → one_pager → spec → design → prompt_plan → agents → export`

## Repository docs
- `idea.md` — Captures Problem, Audience, Platform, Core Flow, MVP Features; Non‑Goals optional. Produced in the **intake** stage.  
- `idea_one_pager.md` — One‑pager derived from `idea.md`; presence checks for Problem, Audience, Platform, Core Flow, MVP Features. Produced in **one_pager**.  
- `spec.md` — Minimal functional and technical specification consistent with prior docs, including a concise **Definition of Done**. Produced in **spec**.  
- `prompt_plan.md` — Agent‑Ready Planner with per‑step prompts, expected artifacts, tests, rollback notes, idempotency notes, and a TODO checklist using Markdown checkboxes. This file drives the agent workflow.  
- `AGENTS.md` — This file. Must include the **Agent responsibility** section below for the **agents** stage validator to pass.  

## `/designs/` folder
Design exports uploaded as a ZIP. 
When generating or using `prompt_plan.md`, reference assets by their indexed path (for example, `1-Landing.png`).
Strip macOS metadata directories (`__MACOSX/`) and `._*` resource-fork files from every ZIP so only real image/PDF assets are stored.

---

### Agent responsibility
- After completing any coding, refactor, or test step, **immediately update the corresponding TODO checklist item in `prompt_plan.md`**.  
- Use the same Markdown checkbox format (`- [x]`) to mark completion.  
- When creating new tasks or subtasks, add them directly under the appropriate section anchor in `prompt_plan.md`.  
- Always commit changes to `prompt_plan.md` alongside the code and tests that fulfill them.  
- Do not consider work “done” until the matching checklist item is checked and all related tests are green.
- When a stage (plan step) is complete with green tests, update the README “Release notes” section with any user-facing impact (or explicitly state “No user-facing changes” if applicable).

## Guardrails for agents
- Make the smallest change that passes tests and improves the code.
- Do not introduce new public APIs without updating `spec.md` and relevant tests.
- Do not duplicate templates or files to work around issues. Fix the original.
- If a file cannot be opened or content is missing, say so explicitly and stop. Do not guess.
- Respect privacy and logging policy: do not log secrets, prompts, completions, or PII.
- Whenever new functionality becomes manually testable in the running app, prompt the human right away so they can try it.

---

## Testing policy (non‑negotiable)
- Tests **MUST** cover the functionality being implemented.
- **NEVER** ignore the output of the system or the tests — logs and messages often contain **CRITICAL** information.
- **TEST OUTPUT MUST BE PRISTINE TO PASS.**
- If logs are **supposed** to contain errors, capture and test it.
- **NO EXCEPTIONS POLICY:** Under no circumstances should you mark any test type as "not applicable". Every project, regardless of size or complexity, **MUST** have unit tests, integration tests, **AND** end‑to‑end tests. If you believe a test type doesn't apply, you need the human to say exactly **"I AUTHORIZE YOU TO SKIP WRITING TESTS THIS TIME"**.

### TDD (how we work)
- Write tests **before** implementation.
- Only write enough code to make the failing test pass.
- Refactor continuously while keeping tests green.

**TDD cycle**
1. Write a failing test that defines a desired function or improvement.  
2. Run the test to confirm it fails as expected.  
3. Write minimal code to make the test pass.  
4. Run the test to confirm success.  
5. Refactor while keeping tests green.  
6. Repeat for each new feature or bugfix.

---

## Important checks
- **NEVER** disable functionality to hide a failure. Fix root cause.  
- **NEVER** create duplicate templates/files. Fix the original.  
- **NEVER** claim something is “working” when any functionality is disabled or broken.  
- If you can’t open a file or access something requested, say so. Do not assume contents.  
- **ALWAYS** identify and fix the root cause of template/compilation errors.  
- If git is initialized, ensure a `.gitignore` exists and contains at least:
  ```
  .env
  .env.local
  .env.*
  ```
  Ask the human whether additional patterns should be added, and suggest any that you think are important given the project. 

## When to ask for human input
Ask the human if any of the following is true:
- A test type appears “not applicable”. Use the exact phrase request: **"I AUTHORIZE YOU TO SKIP WRITING TESTS THIS TIME"**.  
- Required anchors conflict or are missing from upstream docs.  
- You need new environment variables or secrets.  
- An external dependency or major architectural change is required.
- Design files are missing, unsupported, oversized, or require renaming/re‑export from the design tool.
