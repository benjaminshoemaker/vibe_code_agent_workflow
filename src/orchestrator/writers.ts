import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  chatMessages,
  designs,
  docs,
  type ChatRole,
  type DocName,
  type StageName
} from "../db/schema";
import type { StageDriverRunArgs, StageDriverResult } from "./types";

type StageWriter = (args: StageDriverRunArgs) => Promise<StageDriverResult>;

type SectionMap = Record<string, string>;

const seedIdea = (() => {
  try {
    const filePath = path.resolve(process.cwd(), "initial_idea.md");
    return readFileSync(filePath, "utf8");
  } catch {
    return "The founder is still refining the idea. Use this session to capture the essentials.";
  }
})();

const agentResponsibilityBlock = [
  "- After completing any coding, refactor, or test step, **immediately update the corresponding TODO checklist item in `prompt_plan.md`**.",
  "- Use the same Markdown checkbox format (`- [x]`) to mark completion.",
  "- When creating new tasks or subtasks, add them directly under the appropriate section anchor in `prompt_plan.md`.",
  "- Always commit changes to `prompt_plan.md` alongside the code and tests that fulfill them.",
  "- Do not consider work “done” until the matching checklist item is checked and all related tests are green.",
  "- When a stage (plan step) is complete with green tests, update the README “Release notes” section with any user-facing impact.",
  "- Even when automated coverage exists, always suggest a feasible manual test path so the human can exercise the feature end-to-end.",
  "- After a plan step is finished, document its completion state with a short checklist so the human can copy/paste it into a commit."
].join("\n");

export const stageWriters: Record<StageName, StageWriter> = {
  intake: runIntakeStage,
  one_pager: runOnePagerStage,
  spec: runSpecStage,
  design: runDesignStage,
  prompt_plan: runPromptPlanStage,
  agents: runAgentsStage,
  export: async ({ stage, emit }) => {
    emitNeedsMore(emit, stage, "EXPORT_NOT_IMPLEMENTED");
    return { status: "needs_more", reason: "EXPORT_NOT_IMPLEMENTED" };
  }
};

async function runIntakeStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const source = await gatherIdeaSource(args.sessionId);
  const content = buildIntakeDoc(source, args.sessionId);
  await writeDoc(args.sessionId, "idea.md", content);
  emitDocUpdated(args.emit, "idea.md", content);
  emitDelta(args.emit, "Documented intake notes into idea.md.");
  return ready();
}

async function runOnePagerStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const ideaDoc = await readDoc(args.sessionId, "idea.md");
  if (!hasContent(ideaDoc)) {
    return failNeedsMore(args, "one_pager", "MISSING_INTAKE_DOC");
  }

  const sections = extractSections(ideaDoc ?? "");
  const content = buildOnePagerDoc(sections);
  await writeDoc(args.sessionId, "idea_one_pager.md", content);
  emitDocUpdated(args.emit, "idea_one_pager.md", content);
  emitDelta(args.emit, "Summarized intake sections into idea_one_pager.md.");
  return ready();
}

async function runSpecStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const onePager = await readDoc(args.sessionId, "idea_one_pager.md");
  if (!hasContent(onePager)) {
    return failNeedsMore(args, "spec", "MISSING_ONE_PAGER");
  }

  const sections = extractSections(onePager ?? "");
  const content = buildSpecDoc(sections);
  await writeDoc(args.sessionId, "spec.md", content);
  emitDocUpdated(args.emit, "spec.md", content);
  emitDelta(args.emit, "Compiled one_pager insights into spec.md.");
  return ready();
}

async function runDesignStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const specDoc = await readDoc(args.sessionId, "spec.md");
  if (!hasContent(specDoc)) {
    return failNeedsMore(args, "design", "MISSING_SPEC");
  }

  const sections = extractSections(specDoc ?? "");
  const content = buildDesignPrompt(sections);
  await writeDoc(args.sessionId, "prompt_plan.md", content);
  emitDocUpdated(args.emit, "prompt_plan.md", content);
  emitDelta(args.emit, "Drafted design prompt inside prompt_plan.md.");
  return ready();
}

async function runPromptPlanStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const specDoc = await readDoc(args.sessionId, "spec.md");
  if (!hasContent(specDoc)) {
    return failNeedsMore(args, "prompt_plan", "MISSING_SPEC");
  }

  const currentPlan = await readDoc(args.sessionId, "prompt_plan.md");
  const designPrompt = extractSection(currentPlan ?? "", "Design Prompt");
  const designFiles = await fetchDesignIndex(args.sessionId);
  const content = buildPromptPlanDoc(specDoc ?? "", designPrompt, designFiles);
  await writeDoc(args.sessionId, "prompt_plan.md", content);
  emitDocUpdated(args.emit, "prompt_plan.md", content);
  emitDelta(args.emit, "Outlined stage-by-stage prompt plan.");
  return ready();
}

async function runAgentsStage(args: StageDriverRunArgs): Promise<StageDriverResult> {
  const planDoc = await readDoc(args.sessionId, "prompt_plan.md");
  if (!hasContent(planDoc)) {
    return failNeedsMore(args, "agents", "MISSING_PROMPT_PLAN");
  }

  const ideaDoc = await readDoc(args.sessionId, "idea.md");
  const onePager = await readDoc(args.sessionId, "idea_one_pager.md");
  const specDoc = await readDoc(args.sessionId, "spec.md");
  const content = buildAgentsDoc({
    idea: ideaDoc ?? "",
    onePager: onePager ?? "",
    spec: specDoc ?? "",
    promptPlan: planDoc ?? ""
  });
  await writeDoc(args.sessionId, "AGENTS.md", content);
  emitDocUpdated(args.emit, "AGENTS.md", content);
  emitDelta(args.emit, "Produced AGENTS.md with hand-off instructions.");
  return ready();
}

async function gatherIdeaSource(sessionId: string) {
  const latestUser = await db.query.chatMessages.findFirst({
    where: and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.role, "user" as ChatRole)),
    orderBy: [desc(chatMessages.createdAt)]
  });

  return latestUser?.content ?? seedIdea;
}

async function fetchDesignIndex(sessionId: string) {
  const files = await db.query.designs.findMany({
    where: eq(designs.sessionId, sessionId),
    columns: { path: true, size: true, contentType: true }
  });
  if (files.length === 0) {
    return ["No design ZIP uploaded yet. The design prompt documents expectations for the next upload."];
  }
  return files.map((file) => `${file.path} (${file.size} bytes, ${file.contentType})`);
}

function buildIntakeDoc(source: string, sessionId: string) {
  const condensed = condense(source);
  const sectionText = (label: string) =>
    `${condensed} (${label.toLowerCase()} focus for session ${sessionId}).`;

  const sections = [
    ["Problem", sectionText("Problem")],
    ["Audience", sectionText("Audience")],
    ["Platform", "Primary experience runs on the web with responsive behavior for mobile devices."],
    ["Core Flow", sectionText("Core Flow")],
    ["MVP Features", "Chat-guided plan, inline docs, and a resumable export pipeline."],
    ["Non-Goals", "Anything outside the seven-stage workflow is deferred for later releases."]
  ];

  const parts = [
    "# Idea Overview",
    `Session: ${sessionId}`,
    "",
    "## Summary",
    condensed,
    "",
    ...sections.flatMap(([title, body]) => [`## ${title}`, body])
  ];

  return parts.join("\n");
}

function buildOnePagerDoc(sections: SectionMap) {
  const parts = [
    "# Idea One-Pager",
    renderSection("Problem", sections.Problem),
    renderSection("Audience", sections.Audience),
    renderSection("Platform", sections.Platform),
    renderSection("Core Flow", sections["Core Flow"]),
    renderSection("MVP Features", sections["MVP Features"]),
    "## Outcome",
    "The staged workflow results in a validated spec, prompt plan, and AGENTS.md hand-off."
  ];
  return parts.join("\n\n");
}

function buildSpecDoc(onePagerSections: SectionMap) {
  const summaryLines = onePagerSections
    ? Object.entries(onePagerSections)
        .map(([key, value]) => `- **${key}:** ${condense(value)}`)
        .join("\n")
    : "- Details from the one-pager will be refined with the operator.";

  const definitionOfDone = [
    "- Intake, one-pager, and spec docs are approved.",
    "- Design prompt is ready for the human designer.",
    "- Prompt plan enumerates TODOs with passing tests.",
    "- AGENTS.md references the required “Agent responsibility” section."
  ].join("\n");

  return [
    "# Functional Spec",
    "## Summary",
    summaryLines,
    "## Requirements",
    "- Provide a left-rail of docs, chat on the right, and an Approve button per stage.",
    "- Persist sessions, docs, and design uploads in Turso/SQLite via Drizzle.",
    "- Enforce CSP + sandbox for Markdown preview and design assets.",
    "## Definition of Done",
    definitionOfDone
  ].join("\n\n");
}

function buildDesignPrompt(specSections: SectionMap) {
  const summary = specSections.Summary ?? "The spec outlines how the agent-ready planner behaves.";
  return [
    "# Prompt Plan",
    "## Design Prompt",
    `${condense(summary)} Ensure the UI matches the staged workflow: docs on the left, chat + editor tabs on the right.`,
    "- Create hero, workflow strip, doc cards, and chat/editor layout references.",
    "- Provide states for disabled/enabled Approve buttons and doc locks.",
    "- Include at least one mobile viewport for the landing hero.",
    "",
    "## Planner Placeholder",
    "_The detailed prompt plan will be generated during the prompt_plan stage._"
  ].join("\n\n");
}

function buildPromptPlanDoc(specContent: string, designPrompt?: string, designFiles?: string[]) {
  const summary = condense(specContent).slice(0, 360);
  const designSection = designPrompt
    ? `## Design Prompt\n${designPrompt}`
    : "## Design Prompt\nDesign requirements will be refined with the designer.";

  const designIndexSection = ["## Design Assets", ...(designFiles ?? []).map((file) => `- ${file}`)].join("\n");
  const plan = [
    "1. Intake → capture Problem, Audience, Platform, Core Flow, MVP Features.",
    "2. One-Pager → summarize intake sections for quick review.",
    "3. Spec → record requirements and Definition of Done.",
    "4. Design → output prompts + collect the uploaded ZIP.",
    "5. Prompt Plan → expand TODOs, tests, and rollback notes.",
    "6. Agents → publish AGENTS.md with responsibilities."
  ].join("\n");

  const todos = ["- [ ] Validate docs", "- [ ] Upload/refresh design ZIP", "- [ ] Approve each stage"].join("\n");

  return [
    "# Prompt Plan",
    designSection,
    designIndexSection,
    "## Stage Progression",
    plan,
    "## Tests",
    "- Confirm prompt_plan.md and AGENTS.md are non-empty.",
    "- Verify landing page + app shell pass staged approvals.",
    "- Validate `/api/docs/:name` rejects edits after approval.",
    "## TODO",
    todos
  ].join("\n\n");
}

function buildAgentsDoc(docsContent: { idea: string; onePager: string; spec: string; promptPlan: string }) {
  const docSummaries = [
    ["idea.md", docsContent.idea],
    ["idea_one_pager.md", docsContent.onePager],
    ["spec.md", docsContent.spec],
    ["prompt_plan.md", docsContent.promptPlan]
  ]
    .map(([name, content]) => `- \`${name}\` — ${summarizeForAgents(content)}`)
    .join("\n");

  const overview = condense(docsContent.spec || docsContent.promptPlan || docsContent.onePager);
  const checklist = ["- [ ] Review prompt_plan.md TODOs", "- [ ] Upload designs if required", "- [ ] Run pnpm test"].join(
    "\n"
  );

  return [
    "# AGENTS",
    "## Overview",
    `${overview}. This document hands the project to an AI coding agent with all guardrails intact.`,
    "## Documents",
    docSummaries,
    "## Agent responsibility",
    agentResponsibilityBlock,
    "## Manual Checklist",
    checklist
  ].join("\n\n");
}

function summarizeForAgents(content: string) {
  if (!hasContent(content)) {
    return "awaiting author input.";
  }
  return `${condense(content).slice(0, 160)}...`;
}

async function readDoc(sessionId: string, name: DocName) {
  const row = await db.query.docs.findFirst({
    where: (table) => and(eq(table.sessionId, sessionId), eq(table.name, name))
  });
  return row?.content ?? "";
}

async function writeDoc(sessionId: string, name: DocName, content: string) {
  await db
    .update(docs)
    .set({ content, updatedAt: Date.now() })
    .where(and(eq(docs.sessionId, sessionId), eq(docs.name, name)));
}

function extractSections(content: string) {
  const map: SectionMap = {};
  const headingRegex = /^#{1,6}\s+(.+?)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content))) {
    const title = match[1].trim();
    const start = match.index + match[0].length;
    const nextMatchIndex = content.slice(start).search(/^#{1,6}\s+/m);
    const end = nextMatchIndex === -1 ? content.length : start + nextMatchIndex;
    map[title] = content.slice(start, end).trim();
  }
  return map;
}

function extractSection(content: string, name: string) {
  const sections = extractSections(content);
  if (sections[name]) {
    return sections[name];
  }
  const escaped = escapeRegExp(name);
  const bulletRegex = new RegExp(`^\\s*[-*]\\s*(?:\\*\\*${escaped}\\*\\*|${escaped})\\s*:\\s*(.+)$`, "gim");
  const bulletMatch = bulletRegex.exec(content);
  return bulletMatch ? bulletMatch[1].trim() : undefined;
}

function renderSection(title: string, body?: string) {
  if (body && body.trim().length > 0) {
    return `## ${title}\n${body.trim()}`;
  }
  return `## ${title}\nDetails for ${title.toLowerCase()} will be refined with the operator.`;
}

function condense(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hasContent(content?: string | null) {
  return typeof content === "string" && content.trim().length > 0;
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emitDocUpdated(
  emit: StageDriverRunArgs["emit"],
  name: DocName,
  content: string
) {
  emit({
    event: "doc.updated",
    data: { name, size: Buffer.byteLength(content, "utf8") }
  });
}

function emitDelta(emit: StageDriverRunArgs["emit"], message: string) {
  emit({ event: "assistant.delta", data: message });
}

function emitNeedsMore(
  emit: StageDriverRunArgs["emit"],
  stage: StageName,
  reason: string
) {
  emit({ event: "stage.needs_more", data: { stage, reason } });
}

function ready(): StageDriverResult {
  return { status: "ready" };
}

function failNeedsMore(
  args: StageDriverRunArgs,
  stage: StageName,
  reason: string
): StageDriverResult {
  emitNeedsMore(args.emit, stage, reason);
  return { status: "needs_more", reason };
}
