import { test, expect } from "@playwright/test";
import { initSession } from "./utils/session";

test("chatkit UI streams events and updates UI state", async ({ page }) => {
  let docRequestCount = 0;
  await page.route("**/api/docs/idea.md", async (route) => {
    docRequestCount += 1;
    if (docRequestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ content: "Updated content from SSE" })
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/chat", async (route) => {
    const body = [
      "event: assistant.delta",
      "data: Response from orchestrator",
      "",
      "event: doc.updated",
      "data: idea.md",
      "",
      "event: stage.ready",
      "data: intake",
      "",
      'event: stage.needs_more',
      'data: {"stage":"intake","reason":"LLM budget reached"}',
      "",
      ""
    ].join("\n");
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body
    });
  });

  await initSession(page);
  await page.goto("/app");
  await page.waitForSelector('[data-testid="app-shell"]');

  const editor = page.locator(".cs-message-input__content-editor");
  await editor.click();
  await editor.fill("Ping the doc");
  await page.locator(".cs-button--send").click();

  const list = page.getByTestId("chat-message-list");
  await expect(list.getByText("Ping the doc")).toBeVisible();
  await expect(list.getByText("Response from orchestrator")).toBeVisible();
  await expect(list.getByText("You", { exact: true })).toBeVisible();
  await expect(list.getByText("Assistant", { exact: true })).toBeVisible();
  await expect(page.getByTestId("chat-notice")).toContainText("LLM budget reached");
  await page.getByTestId("doc-tab-edit").click();
  await expect(page.getByPlaceholder("Start typing...")).toHaveValue(/Updated content from SSE/);
  await expect(page.getByRole("button", { name: "Approve Stage" })).toBeEnabled();
});
