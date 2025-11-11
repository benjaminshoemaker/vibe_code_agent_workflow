import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { docs, designs, docNames, type DocName, type StageName } from "../db/schema";

export type StageValidationResult = {
  ok: boolean;
  reasons: string[];
};

type StageValidator = (sessionId: string) => Promise<StageValidationResult>;

const onePagerSections = ["Problem", "Audience", "Platform", "Core Flow", "MVP Features"];

const stageValidators: Record<StageName, StageValidator> = {
  intake: validateIntake,
  spec: validateSpec,
  design: validateDesign,
  prompt_plan: validatePromptPlan,
  agents: validateAgents,
  export: validateExport
};

export async function validateStage(
  sessionId: string,
  stage: StageName
): Promise<StageValidationResult> {
  const validator = stageValidators[stage];
  if (!validator) {
    return fail(`Stage validator missing for ${stage}`);
  }
  return validator(sessionId);
}

async function validateIntake(sessionId: string): Promise<StageValidationResult> {
  const doc = await getDoc(sessionId, "idea_one_pager.md");
  if (!doc || !hasContent(doc.content)) {
    return fail("idea_one_pager.md is empty.");
  }

  const missing = onePagerSections.filter((section) => !hasSection(doc.content, section));
  if (missing.length > 0) {
    return fail(`Missing sections: ${missing.join(", ")}`);
  }

  return ok();
}

async function validateSpec(sessionId: string): Promise<StageValidationResult> {
  const doc = await getDoc(sessionId, "spec.md");
  if (!doc || !hasContent(doc.content)) {
    return fail("spec.md is empty.");
  }

  const reasons: string[] = [];
  if (!/definition\s+of\s+done/i.test(doc.content)) {
    reasons.push('spec.md must include a "Definition of Done" section.');
  }

  if (!onePagerSections.some((section) => new RegExp(section, "i").test(doc.content))) {
    reasons.push("spec.md must reference prior docs (Problem, Audience, Platform, Core Flow, MVP Features).");
  }

  return reasons.length > 0 ? { ok: false, reasons } : ok();
}

async function validateDesign(sessionId: string): Promise<StageValidationResult> {
  const design = await db.query.designs.findFirst({
    where: eq(designs.sessionId, sessionId),
    columns: { path: true }
  });

  if (!design) {
    return fail("Upload at least one design before approving the design stage (/designs/ index is empty).");
  }

  return ok();
}

async function validatePromptPlan(sessionId: string): Promise<StageValidationResult> {
  return requireDocContent(sessionId, "prompt_plan.md", "prompt_plan.md is empty.");
}

async function validateAgents(sessionId: string): Promise<StageValidationResult> {
  const doc = await getDoc(sessionId, "AGENTS.md");
  if (!doc || !hasContent(doc.content)) {
    return fail("AGENTS.md is empty.");
  }

  if (!/agent responsibility/i.test(doc.content)) {
    return fail('AGENTS.md must include the "Agent responsibility" section.');
  }

  return ok();
}

async function validateExport(sessionId: string): Promise<StageValidationResult> {
  const docRows = await db.query.docs.findMany({
    where: eq(docs.sessionId, sessionId)
  });
  const designRows = await db.query.designs.findMany({
    where: eq(designs.sessionId, sessionId)
  });

  const docMap = new Map(docRows.map((row) => [row.name, row]));
  const emptyDocs = docNames.filter((name) => {
    const row = docMap.get(name);
    return !row || !hasContent(row.content);
  });

  if (emptyDocs.length > 0) {
    return fail(`Docs missing content: ${emptyDocs.join(", ")}`);
  }

  try {
    generateManifestStub(docRows, designRows);
  } catch (error) {
    return fail("Failed to generate manifest.", error instanceof Error ? error.message : String(error));
  }

  return ok();
}

function generateManifestStub(
  docRows: Array<typeof docs.$inferSelect>,
  designRows: Array<typeof designs.$inferSelect>
) {
  return {
    generated_at: new Date().toISOString(),
    docs: docRows.map((doc) => ({
      name: doc.name,
      sha256: createHash("sha256").update(doc.content ?? "").digest("hex")
    })),
    designs: designRows.map((file) => ({
      path: file.path,
      size: file.size,
      content_type: file.contentType,
      sha256: file.sha256
    })),
    policy: { replace_on_upload: true }
  };
}

async function requireDocContent(
  sessionId: string,
  docName: DocName,
  message: string
): Promise<StageValidationResult> {
  const doc = await getDoc(sessionId, docName);
  if (!doc || !hasContent(doc.content)) {
    return fail(message);
  }
  return ok();
}

async function getDoc(sessionId: string, docName: DocName) {
  return db.query.docs.findFirst({
    where: (table) => and(eq(table.sessionId, sessionId), eq(table.name, docName))
  });
}

function hasContent(content: string | null | undefined) {
  return typeof content === "string" && content.trim().length > 0;
}

function hasSection(content: string, section: string) {
  const escaped = escapeRegExp(section);
  const patterns = [
    new RegExp(`^#{1,6}\\s*${escaped}\\b`, "mi"),
    new RegExp(`^\\s*[-*]\\s*(?:\\*\\*${escaped}\\*\\*|${escaped})\\s*:`, "mi"),
    new RegExp(`\\b${escaped}\\b`, "mi")
  ];
  return patterns.some((pattern) => pattern.test(content));
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ok(): StageValidationResult {
  return { ok: true, reasons: [] };
}

function fail(...reasons: string[]): StageValidationResult {
  return { ok: false, reasons };
}
