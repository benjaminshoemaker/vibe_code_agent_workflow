import { test, expect } from "@playwright/test";
import path from "node:path";
import { initSession } from "./utils/session";

async function putDoc(page: any, name: string, content: string) {
  const res = await page.evaluate(async ({ name, content }: { name: string; content: string }) => {
    const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    return r.status;
  }, { name, content });
  expect(res).toBe(200);
}

async function approve(page: any, stage: string) {
  const status = await page.evaluate(async (stage: string) => {
    const r = await fetch(`/api/stages/${stage}/approve`, { method: "POST", credentials: "include" });
    return r.status;
  }, stage);
  expect(status).toBe(200);
}

test("Design stage: upload ZIP, gate Approve until ready, then enable and advance", async ({ page }) => {
  await initSession(page);
  // Ensure relative fetch() has an origin
  await page.goto("/");

  // Prepare and approve prior stages to reach Design
  await putDoc(page, "idea.md", "# Idea\n\nProblem statement.");
  await approve(page, "intake");

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
  await approve(page, "one_pager");

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

  // Now on Design stage; open app shell
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');
  await expect(page.getByRole("heading", { name: "Stage: Design" })).toBeVisible();

  // Approve should be disabled until ready AND designs present
  const approveBtn = page.getByRole("button", { name: "Approve Stage" });
  await expect(approveBtn).toBeDisabled();

  // Upload ZIP
  const zipPath = path.resolve("designs/Design_Images.zip");
  await page.setInputFiles('input[type="file"]', zipPath);
  await expect(page.getByText(/Upload replaced \d+ file\(s\)\./)).toBeVisible();
  // Designs table should list rows
  await expect(page.getByText("Design Assets")).toBeVisible();

  // Still disabled until stage.ready is emitted
  await expect(approveBtn).toBeDisabled();

  // Emit stage.ready for design to enable Approve
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('chat.debug', { detail: { type: 'stage.ready', data: 'design' }}));
  });

  await expect(approveBtn).toBeEnabled();
  await approveBtn.click();

  // Should advance to Prompt Plan stage
  await expect(page.getByRole("heading", { name: "Stage: Prompt Plan" })).toBeVisible();
});
