import { readFileSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  chatMessages,
  designs,
  docs,
  type ChatRole,
  type DocName,
  type StageName
} from "../db/schema";
import { generateResponse, type OpenAIResponseInput } from "../libs/openai";
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
  const conversation = await fetchIntakeConversation(args.sessionId);
  let content: string | undefined;

  if (conversation.length > 0) {
    content = await draftIdeaDocWithModel(conversation).catch(() => undefined);
  }

  if (!content) {
    const insights = gatherIntakeInsights(conversation);
    content = buildIntakeDoc(insights);
  }

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

type IntakeSection = "Problem" | "Audience" | "Platform" | "Core Flow" | "MVP Features" | "Non-Goals";

type IntakeInsights = {
  summary: string;
  sections: Record<IntakeSection, string>;
};

const intakeSectionOrder: IntakeSection[] = ["Problem", "Audience", "Platform", "Core Flow", "MVP Features", "Non-Goals"];

const defaultSectionCopy: Record<IntakeSection, string> = {
  Problem: "We still need to document the precise problem statement. Capture it during the next intake revision.",
  Audience: "Outline the primary users in the next conversation so downstream docs remain grounded.",
  Platform: "Primary experience runs on the web with responsive behavior for mobile devices.",
  "Core Flow": "Detail the end-to-end experience so engineering and design can reason about state transitions.",
  "MVP Features": "Focus on the smallest feature set that proves the concept across all seven stages.",
  "Non-Goals": "Anything outside the seven-stage workflow is deferred for later releases."
};

const assistantTopicMatchers: Array<{ section: IntakeSection; patterns: RegExp[] }> = [
  { section: "Problem", patterns: [/problem/i, /pain point/i, /core challenge/i] },
  { section: "Audience", patterns: [/audience/i, /ideal user/i, /target users?/i] },
  { section: "Platform", patterns: [/platform/i, /surface/i, /channels?/i] },
  { section: "Core Flow", patterns: [/core flow/i, /journey/i, /steps/i] },
  { section: "MVP Features", patterns: [/mvp/i, /must[-\s]?have/i, /features/i] },
  { section: "Non-Goals", patterns: [/non-?goals?/i, /out of scope/i, /deferr(ed|ing)/i] }
];

async function draftIdeaDocWithModel(conversation: typeof chatMessages.$inferSelect[]) {
  const transcript = formatTranscript(conversation);
  if (!transcript) return undefined;

  const input: OpenAIResponseInput = [
    {
      role: "system",
      type: "message",
      content: [
        "You are a founding product lead who turns intake interviews into clear planning docs.",
        "Produce Markdown for `idea.md` with these sections (in order):",
        "## Summary",
        "## Problem",
        "## Audience",
        "## Platform",
        "## Core Flow",
        "## MVP Features",
        "## Non-Goals",
        "",
        "Write in the third person, synthesizing insights instead of quoting users verbatim.",
        "If information is missing, write `TBD – what needs to be clarified` for that section.",
        "Compose this document such that we could start talking with product & engineering leadership about how this could be built.",
        "Tone: confident, concise, and actionable.",
        "Never mention chat logs, transcripts, or session IDs."
      ].join("\n")
    },
    {
      role: "user",
      type: "message",
      content: [
        "Here is the intake transcript (ordered chronologically).",
        "Summarize it into the required sections and output the complete Markdown document.",
        "",
        transcript
      ].join("\n")
    }
  ];

  const response = await generateResponse({ input });
  const doc = collectResponseText(response)?.trim();
  if (!doc) return undefined;
  return ensureIdeaSections(doc);
}

const contentTopicMatchers: Array<{ section: IntakeSection; pattern: RegExp }> = [
  { section: "Problem", pattern: /(problem|pain|challenge|struggle|issue)/i },
  { section: "Audience", pattern: /(user|audience|customer|founder|team|marketer|student|developer)s?/i },
  { section: "Platform", pattern: /(web app|mobile app|ios|android|slack|teams|cli|command line|browser extension|chrome extension|desktop app|pwa|responsive)/i },
  { section: "Core Flow", pattern: /(flow|journey|steps|process|workflow)/i },
  { section: "MVP Features", pattern: /(feature|capability|mvp|must-have|essentials|core module)/i },
  { section: "Non-Goals", pattern: /(non-goal|out of scope|later phase|defer|not focusing)/i }
];

async function fetchIntakeConversation(sessionId: string) {
  return db.query.chatMessages.findMany({
    where: and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.stage, "intake")),
    orderBy: [asc(chatMessages.createdAt)],
    limit: 200
  });
}

function gatherIntakeInsights(conversation: typeof chatMessages.$inferSelect[]): IntakeInsights {
  if (conversation.length === 0) {
    return {
      summary: seedIdea,
      sections: { ...defaultSectionCopy }
    };
  }
  return analyzeIntakeConversation(conversation);
}

function analyzeIntakeConversation(conversation: typeof chatMessages.$inferSelect[]): IntakeInsights {
  const sectionDrafts: Partial<Record<IntakeSection, string>> = {};
  const userNarrative: string[] = [];
  let pendingTopic: IntakeSection | null = null;

  for (const message of conversation) {
    if (message.role === "assistant") {
      const topic = detectTopicFromAssistant(message.content);
      if (topic) {
        pendingTopic = topic;
      }
      continue;
    }

    if (message.role !== "user") continue;

    const cleaned = normalizeAnswer(message.content);
    if (!cleaned) continue;
    userNarrative.push(cleaned);

    const topic = pendingTopic ?? detectTopicFromContent(cleaned, sectionDrafts);
    if (topic) {
      sectionDrafts[topic] = appendSectionParagraph(sectionDrafts[topic], cleaned);
      pendingTopic = null;
    }
  }

  const combinedNarrative = userNarrative.join(" ");
  const summary = selectSummary(userNarrative) ?? seedIdea;
  const sections = applySectionFallbacks(sectionDrafts, combinedNarrative);

  return { summary, sections };
}

function normalizeAnswer(text: string) {
  return text.replace(/^[>\s-]+/g, "").replace(/\s+/g, " ").trim();
}

function detectTopicFromAssistant(content: string): IntakeSection | null {
  const lower = content.toLowerCase();
  for (const matcher of assistantTopicMatchers) {
    if (matcher.patterns.some((pattern) => pattern.test(lower))) {
      return matcher.section;
    }
  }
  return null;
}

function detectTopicFromContent(
  content: string,
  drafts: Partial<Record<IntakeSection, string>>
): IntakeSection | null {
  for (const matcher of contentTopicMatchers) {
    if (!drafts[matcher.section] && matcher.pattern.test(content)) {
      return matcher.section;
    }
  }
  return null;
}

function appendSectionParagraph(existing: string | undefined, addition: string) {
  if (!existing) return addition;
  return `${existing}\n\n${addition}`;
}

function applySectionFallbacks(
  drafts: Partial<Record<IntakeSection, string>>,
  narrative: string
): Record<IntakeSection, string> {
  const resolved: Record<IntakeSection, string> = { ...defaultSectionCopy };
  for (const section of intakeSectionOrder) {
    const candidate = drafts[section]?.trim();
    if (candidate && candidate.length > 0) {
      resolved[section] = candidate;
      continue;
    }
    if (section === "Platform") {
      resolved.Platform = inferPlatformFromNarrative(narrative);
    }
  }
  return resolved;
}

function inferPlatformFromNarrative(narrative: string) {
  const text = narrative.toLowerCase();
  if (!text) return defaultSectionCopy.Platform;
  if (/(ios|android|native mobile)/.test(text)) {
    return "Native mobile apps on iOS and Android with shared onboarding and notifications.";
  }
  if (/(slack|teams|discord)/.test(text)) {
    return "Conversational surface delivered inside the team’s chat workspace (Slack/Teams).";
  }
  if (/(cli|command line|terminal)/.test(text)) {
    return "Command-line interface that ships as an installable CLI for automation-first teams.";
  }
  if (/(browser extension|chrome extension)/.test(text)) {
    return "Browser extension that augments the workflow directly inside the user’s current tab.";
  }
  if (/(desktop app|electron)/.test(text)) {
    return "Desktop application with offline-first sync across Mac and Windows.";
  }
  if (/(mobile web|responsive|pwa)/.test(text)) {
    return "Responsive web app that behaves well on mobile web/PWA contexts.";
  }
  return defaultSectionCopy.Platform;
}

function selectSummary(messages: string[]) {
  if (messages.length === 0) {
    return undefined;
  }
  const substantial = messages.find((entry) => entry.length >= 80);
  return substantial ?? messages[0];
}

function formatTranscript(conversation: typeof chatMessages.$inferSelect[]) {
  return conversation
    .slice(-50)
    .map((msg) => {
      const role = msg.role.toUpperCase();
      const content = msg.content.replace(/\s+/g, " ").trim();
      return `${role}: ${content}`;
    })
    .join("\n");
}

function collectResponseText(response: any) {
  const chunks: string[] = [];
  for (const output of response?.output ?? []) {
    if (output?.type === "message" && output?.message?.content) {
      for (const segment of output.message.content) {
        const text = extractTextField(segment);
        if (text) chunks.push(text);
      }
    } else if (output?.role === "assistant" && Array.isArray(output?.content)) {
      for (const segment of output.content) {
        const text = extractTextField(segment);
        if (text) chunks.push(text);
      }
    }
  }
  if (chunks.length === 0 && Array.isArray(response?.output_text)) {
    return response.output_text.filter((text: unknown) => typeof text === "string").join("\n");
  }
  return chunks.join("");
}

function extractTextField(segment: any) {
  if (!segment) return "";
  if (typeof segment === "string") return segment;
  if (typeof segment.text === "string") return segment.text;
  if (Array.isArray(segment.text)) {
    return segment.text.filter((part: unknown) => typeof part === "string").join("");
  }
  if (typeof segment.value === "string") return segment.value;
  return "";
}

function ensureIdeaSections(content: string) {
  let result = content.trim();
  if (!/^#\s+/m.test(result)) {
    result = `# Idea Overview\n\n${result}`;
  }
  const required = ["Summary", "Problem", "Audience", "Platform", "Core Flow", "MVP Features", "Non-Goals"];
  for (const heading of required) {
    const pattern = new RegExp(`^##\\s+${heading}\\b`, "im");
    if (!pattern.test(result)) {
      result = `${result.trim()}\n\n## ${heading}\nTBD – add more detail here.\n`;
    }
  }
  return result.trim() + "\n";
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

function buildIntakeDoc(insights: IntakeInsights) {
  const parts: string[] = [
    "# Idea Overview",
    "",
    "## Summary",
    insights.summary.trim() || seedIdea,
    ""
  ];

  for (const section of intakeSectionOrder) {
    const body = insights.sections[section]?.trim() || defaultSectionCopy[section];
    parts.push(`## ${section}`, body, "");
  }

  return parts.join("\n").trim() + "\n";
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
