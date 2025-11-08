import { test, expect } from "@playwright/test";
import { initSession } from "./utils/session";

test("chatkit UI sends messages and renders roles", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: "event: assistant.delta\ndata: Response from orchestrator\n\n"
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
});
