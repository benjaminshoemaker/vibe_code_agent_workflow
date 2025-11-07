import { randomUUID } from "node:crypto";
import { db } from "./client";
import { chatMessages, docs, sessions } from "./schema";

async function seed() {
  const sessionId = randomUUID();

  await db.insert(sessions).values({
    sessionId,
    currentStage: "intake",
    approvedIntake: false,
    approvedOnePager: false,
    approvedSpec: false,
    approvedDesign: false,
    approvedPromptPlan: false,
    approvedAgents: false
  });

  await db.insert(docs).values([
    {
      sessionId,
      name: "idea.md",
      content: "# Example idea\n\n- Problem: ...\n",
      approved: false
    },
    {
      sessionId,
      name: "spec.md",
      content: "# Spec placeholder\n",
      approved: false
    }
  ]);

  await db.insert(chatMessages).values({
    sessionId,
    role: "assistant",
    content: "Seeded session ready. Continue through the stages when you are ready."
  });

  console.log(`Seed complete. Session ID: ${sessionId}`);
}

seed().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
