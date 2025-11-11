import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { initSession } from "./utils/session";

async function putDoc(page: any, name: string, content: string) {
  const status = await page.evaluate(async ({ name, content }: { name: string; content: string }) => {
    const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    return r.status;
  }, { name, content });
  expect(status).toBe(200);
}

async function approve(page: any, stage: string) {
  const status = await page.evaluate(async (stage: string) => {
    const r = await fetch(`/api/stages/${stage}/approve`, { method: "POST", credentials: "include" });
    return r.status;
  }, stage);
  expect(status).toBe(200);
}

test("Export UI shows manifest and downloads zip", async ({ page }) => {
  await initSession(page);
  await page.goto("/");

  // Seed minimal valid docs to reach export
  await putDoc(
    page,
    "idea_one_pager.md",
    [
      "## Problem",
      "x",
      "## Audience",
      "x",
      "## Platform",
      "x",
      "## Core Flow",
      "x",
      "## MVP Features",
      "x"
    ].join("\n")
  );
  await approve(page, "intake");

  await putDoc(
    page,
    "spec.md",
    [
      "# Functional Spec",
      "This spec references Problem and Audience.",
      "## Definition of Done",
      "- Items completed"
    ].join("\n\n")
  );
  await approve(page, "spec");
  // Design: upload a ZIP and approve
  {
    const zipPath = path.resolve("designs/Design_Images.zip");
    const zip = await fs.readFile(zipPath);
    const res = await page.request.post("/api/designs/upload", {
      headers: { "Content-Type": "application/zip" },
      data: zip
    });
    expect(res.status()).toBe(200);
  }
  await approve(page, "design");

  // Prompt Plan: ensure non-empty then approve
  await putDoc(page, "prompt_plan.md", "# Prompt Plan\n- [ ] Task");
  await approve(page, "prompt_plan");

  // Agents: include required section then approve
  await putDoc(page, "AGENTS.md", "## Agent responsibility\n- Keep TODOs in sync.");
  await approve(page, "agents");
// Enter app shell on Export stage
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');
  await expect(page.getByRole("heading", { name: "Stage: Export" })).toBeVisible();

  // Manifest preview should load
  const manifest = page.getByTestId("export-manifest-json");
  await expect(manifest).toContainText("generated_at");
  await expect(manifest).toContainText("docs");
  await expect(manifest).toContainText("policy");

  // Download via button
  const [ download ] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download-button").click()
  ]);
  const outDir = path.resolve("test-results");
  await fs.mkdir(outDir, { recursive: true });
  const target = path.join(outDir, "export-ui.zip");
  await download.saveAs(target);
  const stat = await fs.stat(target);
  expect(stat.size).toBeGreaterThan(0);
});
