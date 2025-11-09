import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { initSession } from "./utils/session";

test("happy path: intake → export with manifest-verified download", async ({ page }) => {
  await initSession(page);
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');

  const approveButton = page.getByRole("button", { name: "Approve Stage" });
  const editorTab = page.getByTestId("doc-tab-edit");
  const textarea = page.getByPlaceholder("Start typing...");

  // Stage 1 — Intake: author content via UI, gate on stage.ready
  await expect(approveButton).toBeDisabled();
  await editorTab.click();
  const ideaContent = await fs.readFile(path.resolve("tests/e2e/fixtures/idea.md"), "utf8");
  await textarea.fill(ideaContent);
  await page.getByTestId("doc-save-button").click();
  await expect(textarea).toHaveValue(ideaContent);
  await markStageReady(page, "intake");
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("heading", { name: "Stage: One-Pager" })).toBeVisible();

  // Stage 2 — One-Pager: seed required sections, ensure Approve waits for stage.ready
  await expect(approveButton).toBeDisabled();
  await seedDoc(
    page,
    "idea_one_pager.md",
    [
      "## Problem",
      "- Guided automation ensures the MVP captures essentials.",
      "## Audience",
      "- Solo founders shipping quickly.",
      "## Platform",
      "- Next.js app with Fastify APIs.",
      "## Core Flow",
      "- Intake → One-Pager → Spec.",
      "## MVP Features",
      "- Chat, docs, approvals."
    ].join("\n")
  );
  await markStageReady(page, "one_pager");
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("heading", { name: "Stage: Spec" })).toBeVisible();

  // Stage 3 — Spec: includes Definition of Done and prior doc references
  await expect(approveButton).toBeDisabled();
  await seedDoc(
    page,
    "spec.md",
    [
      "# Functional Spec",
      "This spec references the Problem and Audience from earlier stages.",
      "## Definition of Done",
      "- Intake, One-Pager, and Spec all approved.",
      "- Export ZIP builds with manifest."
    ].join("\n\n")
  );
  await markStageReady(page, "spec");
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("heading", { name: "Stage: Design" })).toBeVisible();

  // Stage 4 — Design: upload ZIP, require ready signal after assets exist
  await expect(approveButton).toBeDisabled();
  const zipPath = path.resolve("designs/Design_Images.zip");
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', zipPath);
  await expect(page.getByText(/Upload replaced \d+ file\(s\)\./)).toBeVisible();
  await markStageReady(page, "design");
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("heading", { name: "Stage: Prompt Plan" })).toBeVisible();

  // Stage 5 — Prompt Plan: approve via API to trigger 409 lock flow on edit
  await expect(approveButton).toBeDisabled();
  await seedDoc(
    page,
    "prompt_plan.md",
    [
      "# Prompt Plan",
      "- [ ] Intake scaffold",
      "- [ ] Approval gate wiring",
      "- [ ] Export manifest verification"
    ].join("\n")
  );
  await markStageReady(page, "prompt_plan");
  await expect(approveButton).toBeEnabled();
  const promptPlanStatus = await page.evaluate(async () => {
    const res = await fetch("/api/stages/prompt_plan/approve", {
      method: "POST",
      credentials: "include"
    });
    return res.status;
  });
  expect(promptPlanStatus).toBe(200);
  await editorTab.click();
  await textarea.fill("Editing after approval should trigger CTA.");
  await page.getByTestId("doc-save-button").click();
  await expect(
    page.getByText("This document is approved. Start a new session to make further changes.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start new session" })).toBeVisible();

  await page.reload();
  await page.waitForSelector('[data-testid="app-shell"]');
  await expect(page.getByRole("heading", { name: "Stage: Agents" })).toBeVisible();

  // Stage 6 — Agents: supply required section and approve via UI
  await expect(approveButton).toBeDisabled();
  await seedDoc(
    page,
    "AGENTS.md",
    [
      "# AGENTS.md",
      "## Overview",
      "Docs plus designs teach external agents how to work the repo.",
      "## Agent responsibility",
      "- Keep prompt_plan TODOs in sync with code edits."
    ].join("\n\n")
  );
  await markStageReady(page, "agents");
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByRole("heading", { name: "Stage: Export" })).toBeVisible();

  // Stage 7 — Export: manifest preview + download with verified payload
  const manifestPre = page.getByTestId("export-manifest-json");
  await expect(manifestPre).toContainText('"docs"');
  await expect(manifestPre).toContainText('"sha256"');

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download-button").click()
  ]);
  const outDir = path.resolve("test-results");
  await fs.mkdir(outDir, { recursive: true });
  const zipTarget = path.join(outDir, "happy-path.zip");
  await download.saveAs(zipTarget);

  const files = await unzipEntries(await fs.readFile(zipTarget));
  expect(files.has("manifest.json")).toBe(true);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));

  const docNames = ["AGENTS.md", "idea.md", "idea_one_pager.md", "prompt_plan.md", "spec.md"];
  for (const name of docNames) {
    const file = files.get(name);
    expect(file).toBeDefined();
    const hash = createHash("sha256").update(file ?? Buffer.alloc(0)).digest("hex");
    const entry = manifest.docs.find((doc: { name: string }) => doc.name === name);
    expect(entry?.sha256).toBe(hash);
  }

  expect(manifest.designs.length).toBeGreaterThan(0);
  for (const design of manifest.designs as Array<{ path: string; sha256: string }>) {
    const file = files.get(`designs/${design.path}`);
    expect(file).toBeDefined();
    const hash = createHash("sha256").update(file ?? Buffer.alloc(0)).digest("hex");
    expect(hash).toBe(design.sha256);
  }
});

async function seedDoc(page: Page, name: string, content: string) {
  const status = await page.evaluate(
    async ({ name, content }) => {
      const res = await fetch(`/api/docs/${encodeURIComponent(name)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      return res.status;
    },
    { name, content }
  );
  expect(status).toBe(200);
}

async function markStageReady(page: Page, stage: string) {
  await page.evaluate((slug) => {
    window.dispatchEvent(new CustomEvent("chat.debug", { detail: { type: "stage.ready", data: slug } }));
  }, stage);
}

async function unzipEntries(buffer: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("zip open failed"));
        return;
      }
      const files = new Map<string, Buffer>();
      const readNext = () => zipfile.readEntry();
      zipfile.once("error", reject);
      zipfile.on("entry", (entry: Entry) => {
        readEntry(zipfile, entry)
          .then((data) => {
            files.set(entry.fileName, data);
            readNext();
          })
          .catch(reject);
      });
      zipfile.once("end", () => resolve(files));
      readNext();
    });
  });
}

function readEntry(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("stream open failed"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
      stream.once("error", reject);
    });
  });
}
