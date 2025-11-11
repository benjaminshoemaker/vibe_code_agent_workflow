Create a desktop-first, grayscale wireframe for a two-pane web app called **Agent-Ready Planner**. Use 1440×1024 frames with 12-column grid (80px margins, 24px gutters). Auto-layout everywhere. No color, icons optional, system font. Label everything clearly. Connect frames with arrows to show navigation.

GLOBAL COMPONENTS
- App Header: product name left, stage progress center (6 steps: Intake, Spec, Design, Prompt Plan, Agents, Export) with status chips [Draft | Ready | Approved], user session chip right.
- App Shell: Left Rail (320px) + Right Pane (fill). Left rail shows docs for **current and prior stages only**. Each doc item: name, status chip, and controls [Edit | Copy | Download]. Stage-level **Approve** button at top of right pane. Toast area bottom-right. Modal component “Confirm Approve”.
- Chat Panel (right pane): messages stack with role badges [User | Assistant | Orchestrator], input box with Send. Small “Stage: <name>” label above thread.
- Doc Viewer/Editor (right pane): tabbed header with “Preview | Edit”. Preview renders Markdown (assume raw HTML may appear). Edit is monospace text area.
- Designs Upload: ZIP dropzone, file table [path | size | content_type | sha256], banner “Replace on upload”.
- Export Summary: manifest preview, “Download Zip” primary.

FRAMES TO GENERATE (name frames exactly)
1-Landing
- Hero: H1 “Turn your idea into agent-ready docs”, subhead, primary CTA “Start new session”, secondary “Resume session”.
- “How it works” strip with the 7 stages in order.
- 4 feature bullets: “Two-pane UI”, “Gated stages”, “Design ingestion (ZIP)”, “Zip export”.
- Static sample output cards (read-only snippets) for idea_one_pager.md, spec.md, prompt_plan.md, AGENTS.md.
- Footer with privacy note.

2-App-Intake
- Header + Stage progress (Intake highlighted).
- Left Rail docs: [idea_one_pager.md (Draft)] only. Controls visible.
- Right Pane: split vertically → top: Chat, bottom: Doc Viewer (idea_one_pager.md). Approve button disabled until “Ready” badge appears. Small helper text: “Ask one question at a time; stop when essentials are filled.”

3-App-Intake-Ready
- Progress highlights Intake with a READY badge once the assistant emits `READY_TO_DRAFT`.
- Left Rail docs: [idea_one_pager.md (Draft)] (same doc, but showing readiness state).
- Right Pane: Chat + Doc Viewer showing idea_one_pager.md. Approve button enabled when coherent.

4-App-Spec
- Progress highlights Spec.
- Left Rail docs: [idea_one_pager.md (Approved), spec.md (Draft)].
- Right Pane: Doc Viewer default to Edit with a placeholder DoD checklist section. Banner: “Edits after approval will not affect this session; use Start new session.”

5-App-Design
- Progress highlights Design.
- Left Rail docs unchanged plus “/designs/ (0 files)”.
- Right Pane: ZIP dropzone, file table (empty state), note: “Design stage is required.” After upload state: populated table and image thumbnails grid; non-image files listed as attachments. Banner: “New upload will replace all files.”

6-App-PromptPlan
- Progress highlights Prompt Plan.
- Left Rail docs: + prompt_plan.md (Draft) and “/designs/ (N files)”.
- Right Pane: Doc Viewer showing a sample step with TODO checkboxes and a Tests block. Small note: “Checkboxes are inline in prompt_plan.md only.”

7-App-Agents
- Progress highlights Agents.
- Left Rail docs: + AGENTS.md (Draft).
- Right Pane: Doc Viewer showing required sections including the **Agent responsibility** block verbatim. Approve button present.

8-App-Export
- Progress highlights Export.
- Left Rail docs: all docs marked Approved; “/designs/ (N files)”.
- Right Pane: Export Summary card with manifest.json snippet and “Download Zip” primary CTA. Note: “Flat ZIP layout.”

INTERACTIONS & STATES
- Wire arrows: 1-Landing → 2-App-Intake (Start), 1-Landing → 2-App-Intake (Resume), linear flow 2→3→4→5→6→7→8.
- Disabled states: Approve disabled until validator sets Ready. In Design, Prompt Plan and Agents blocked until a ZIP is uploaded.
- Toast examples: “Saved”, “Upload replaced 23 files”, “Stage approved”.
- Modal “Confirm Approve” with primary/secondary actions.

NAMING & EXPORT
- Name layers semantically (e.g., “Left-Rail/Doc-Item-Approved”).
- Export each frame as PNG @1x using the frame names above (e.g., `1-Landing.png`, `2-App-Intake.png`, …).
- Also export a single PDF of all frames for preview.

CONSTRAINTS
- Keep everything low-fi: rectangles, lines, grayscale text. No imagery beyond small thumbnails in Design.
- Use consistent spacing (8/12/16/24). Headings: H1 28, H2 20, body 14.
- Ensure left rail is clearly scrollable; right pane has tabbed Preview/Edit.
- Include a tiny “sid cookie present” indicator chip in header for realism.

Goal: produce a clear, connected wireframe flow that a developer can implement with Next.js 14 + Tailwind. Focus on layout, labels, and states, not visual polish.
