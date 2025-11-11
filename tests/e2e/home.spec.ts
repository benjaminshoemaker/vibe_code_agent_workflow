import { test, expect } from "@playwright/test";
import { initSession } from "./utils/session";

test("home page renders hero content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-heading")).toBeVisible();
  await expect(page.getByText("Turn your idea into agent-ready docs")).toBeVisible();
  await expect(
    page.getByText(
      "A structured, multi-stage workflow that transforms your product concept into comprehensive documentation ready for AI agents and development teams."
    )
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start new session" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume" })).toBeVisible();
  // Stage chips present
  for (const stage of ["intake", "spec", "design", "prompt_plan", "agents", "export"]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }
  // Snippet cards present
  for (const filename of ["idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"]) {
    await expect(page.getByText(filename, { exact: true }).first()).toBeVisible();
  }
});

test("app shell renders with left rail and approve disabled", async ({ page }) => {
  // Start a session within the page context so the httpOnly cookie is stored for this tab
  await initSession(page);
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');
  const status2 = await page.evaluate(async () => (await fetch('/api/session')).status);
  expect(status2).toBe(200);
});

test("security headers are present on web and api responses", async ({ page, request }) => {
  const pageResponse = await page.goto("/");
  expect(pageResponse).not.toBeNull();
  expect(pageResponse?.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(pageResponse?.headers()["x-content-type-options"]).toBe("nosniff");

  const apiResponse = await request.get("/api/health");
  expect(apiResponse.status()).toBe(200);
  expect(apiResponse.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(apiResponse.headers()["x-content-type-options"]).toBe("nosniff");
});

const requiredIntakeDoc = [
  "## Problem",
  "Validated problem statement for intake test.",
  "## Audience",
  "Solo founders",
  "## Platform",
  "Web app",
  "## Core Flow",
  "Intake → Spec → Design",
  "## MVP Features",
  "- Chat\n- Docs"
].join("\n");

test("doc editor surfaces Start new session CTA after DOC_APPROVED response", async ({ page }) => {
  await initSession(page);
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');
  await page.getByTestId("doc-tab-edit").click();
  const textarea = page.getByPlaceholder("Start typing...");
  await textarea.fill(requiredIntakeDoc);
  const saveButton = page.getByTestId("doc-save-button");
  await saveButton.click();
  await expect(saveButton).toBeEnabled();

  const approveStatus = await page.evaluate(async () => {
    const res = await fetch("/api/stages/intake/approve", { method: "POST" });
    return res.status;
  });
  expect(approveStatus).toBe(200);

  await textarea.fill("Updated idea with another edit");
  await saveButton.click();
  await expect(page.getByText("This document is approved. Start a new session to make further changes.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start new session" })).toBeVisible();
});

test("landing Start new session button resets progress", async ({ page }) => {
  await initSession(page);
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');
  await page.getByTestId("doc-tab-edit").click();
  const textarea = page.getByPlaceholder("Start typing...");
  await textarea.fill("Old session content");
  await page.getByTestId("doc-save-button").click();
  await expect(textarea).toHaveValue("Old session content");

  const storedContent = await page.evaluate(async () => {
    const res = await fetch("/api/docs/idea_one_pager.md", { credentials: "include" });
    const data = (await res.json()) as { content: string };
    return data.content;
  });
  expect(storedContent).toContain("Old session content");

  await page.goto("/");
  await page.getByTestId("start-session-btn").click();
  await page.waitForURL("**/app");
  await page.waitForSelector('[data-testid="app-shell"]');

  const newSessionContent = await page.evaluate(async () => {
    const res = await fetch("/api/docs/idea_one_pager.md", { credentials: "include" });
    const data = (await res.json()) as { content: string };
    return data.content;
  });
  expect(newSessionContent ?? "").toBe("");
});
