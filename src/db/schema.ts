import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  blob
} from "drizzle-orm/sqlite-core";

export const stageNames = [
  "intake",
  "one_pager",
  "spec",
  "design",
  "prompt_plan",
  "agents",
  "export"
] as const;
export type StageName = (typeof stageNames)[number];

export const docNames = ["idea.md", "idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"] as const;
export type DocName = (typeof docNames)[number];

export const chatRoles = ["user", "assistant", "orchestrator"] as const;
export type ChatRole = (typeof chatRoles)[number];

const stageEnum = { enum: stageNames };
const docEnum = { enum: docNames };
const chatRoleEnum = { enum: chatRoles };

export const sessions = sqliteTable(
  "sessions",
  {
    sessionId: text("session_id").primaryKey(),
    currentStage: text("current_stage", stageEnum).notNull(),
    approvedIntake: integer("approved_intake", { mode: "boolean" }).default(false).notNull(),
    approvedOnePager: integer("approved_one_pager", { mode: "boolean" }).default(false).notNull(),
    approvedSpec: integer("approved_spec", { mode: "boolean" }).default(false).notNull(),
    approvedDesign: integer("approved_design", { mode: "boolean" }).default(false).notNull(),
    approvedPromptPlan: integer("approved_prompt_plan", { mode: "boolean" }).default(false).notNull(),
    approvedAgents: integer("approved_agents", { mode: "boolean" }).default(false).notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .default(sql`(strftime('%s','now') * 1000)`)
      .notNull(),
    lastActivity: integer("last_activity", { mode: "number" })
      .default(sql`(strftime('%s','now') * 1000)`)
      .notNull()
  },
  (table) => ({
    stageIndex: index("sessions_stage_idx").on(table.currentStage),
    activityIndex: index("sessions_activity_idx").on(table.lastActivity)
  })
);

export const docs = sqliteTable(
  "docs",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    name: text("name", docEnum).notNull(),
    content: text("content").notNull(),
    approved: integer("approved", { mode: "boolean" }).default(false).notNull(),
    updatedAt: integer("updated_at", { mode: "number" })
      .default(sql`(strftime('%s','now') * 1000)`)
      .notNull()
  },
  (table) => ({
    uniqDoc: uniqueIndex("docs_session_name_idx").on(table.sessionId, table.name)
  })
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    stage: text("stage", stageEnum),
    role: text("role", chatRoleEnum).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "number" })
      .default(sql`(strftime('%s','now') * 1000)`)
      .notNull()
  },
  (table) => ({
    sessionIndex: index("chat_session_idx").on(table.sessionId),
    sessionStageIndex: index("chat_session_stage_idx").on(table.sessionId, table.stage)
  })
);

export const designs = sqliteTable(
  "designs",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    data: blob("data", { mode: "buffer" }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.path] }),
    shaIndex: index("designs_sha_idx").on(table.sha256)
  })
);
