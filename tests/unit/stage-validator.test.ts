import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../src/db/client";
import {
  docs,
  designs,
  sessions,
  docNames,
  type DocName,
  type StageName
} from "../../src/db/schema";
import { validateStage } from "../../src/validators/stage-validator";

describe("stage validators", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = await createSession();
  });

  describe("intake", () => {
    it("fails when idea_one_pager.md is empty", async () => {
      const result = await validateStage(sessionId, "intake");
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain("idea_one_pager.md");
    });

    it("passes when idea_one_pager.md has content", async () => {
      await setDocContent(sessionId, "idea_one_pager.md", requiredSectionsContent());
      const result = await validateStage(sessionId, "intake");
      expect(result.ok).toBe(true);
    });
  });

  describe("spec", () => {
    it("fails when Definition of Done is missing", async () => {
      await setDocContent(sessionId, "spec.md", "# Spec\n\nDetails");
      const result = await validateStage(sessionId, "spec");
      expect(result.ok).toBe(false);
      expect(result.reasons.some((reason) => reason.includes("Definition of Done"))).toBe(true);
    });

    it("passes when spec references prior docs and has Definition of Done", async () => {
      await setDocContent(
        sessionId,
        "spec.md",
        "# Spec\n\nProblem alignment\n\n## Definition of Done\n- Checklist"
      );
      const result = await validateStage(sessionId, "spec");
      expect(result.ok).toBe(true);
    });
  });

  describe("design", () => {
    it("fails when no designs are uploaded", async () => {
      const result = await validateStage(sessionId, "design");
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain("designs");
    });

    it("passes once at least one design is present", async () => {
      await addDesign(sessionId);
      const result = await validateStage(sessionId, "design");
      expect(result.ok).toBe(true);
    });
  });

  describe("prompt_plan", () => {
    it("fails when prompt_plan.md is empty", async () => {
      const result = await validateStage(sessionId, "prompt_plan");
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain("prompt_plan.md");
    });

    it("passes when prompt_plan.md has content", async () => {
      await setDocContent(sessionId, "prompt_plan.md", "- [ ] Task");
      const result = await validateStage(sessionId, "prompt_plan");
      expect(result.ok).toBe(true);
    });
  });

  describe("agents", () => {
    it("fails when Agent responsibility section is missing", async () => {
      await setDocContent(sessionId, "AGENTS.md", "# Overview");
      const result = await validateStage(sessionId, "agents");
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain("Agent responsibility");
    });

    it("passes when Agent responsibility section exists", async () => {
      await setDocContent(sessionId, "AGENTS.md", "## Agent responsibility\n- Keep docs updated.");
      const result = await validateStage(sessionId, "agents");
      expect(result.ok).toBe(true);
    });
  });

  describe("export", () => {
    it("fails when any doc is empty", async () => {
      const result = await validateStage(sessionId, "export");
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain(".md");
    });

    it("passes after manifest inputs are populated", async () => {
      await populateAllDocs(sessionId);
      const result = await validateStage(sessionId, "export");
      expect(result.ok).toBe(true);
    });
  });
});

async function createSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    sessionId,
    currentStage: "intake",
    approvedIntake: false,
    approvedSpec: false,
    approvedDesign: false,
    approvedPromptPlan: false,
    approvedAgents: false,
    ...overrides
  });

  await db.insert(docs).values(
    docNames.map((name) => ({
      sessionId,
      name,
      content: "",
      approved: false
    }))
  );

  return sessionId;
}

async function setDocContent(sessionId: string, name: DocName, content: string) {
  await db
    .update(docs)
    .set({ content })
    .where(and(eq(docs.sessionId, sessionId), eq(docs.name, name)));
}

async function addDesign(sessionId: string) {
  await db.insert(designs).values({
    sessionId,
    path: "1-Landing.png",
    size: 123,
    contentType: "image/png",
    sha256: "abc123",
    data: Buffer.from("png")
  });
}

async function populateAllDocs(sessionId: string) {
  await setDocContent(sessionId, "idea_one_pager.md", requiredSectionsContent());
  await setDocContent(
    sessionId,
    "spec.md",
    "# Spec\n\nProblem alignment\n\n## Definition of Done\n- Checklist"
  );
  await setDocContent(sessionId, "prompt_plan.md", "- [ ] Step 1");
  await setDocContent(
    sessionId,
    "AGENTS.md",
    "## Agent responsibility\n- Keep docs updated.\n"
  );
}

function requiredSectionsContent() {
  return [
    "## Problem\nDetails",
    "## Audience\nDetails",
    "## Platform\nDetails",
    "## Core Flow\nDetails",
    "## MVP Features\n- Feature"
  ].join("\n\n");
}
