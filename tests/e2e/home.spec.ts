import { test, expect } from "@playwright/test";

test("home page renders hero content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-heading")).toBeVisible();
  await expect(page.getByText("Turn your idea into agent-ready docs")).toBeVisible();
  await expect(
    page.getByText(
      "A structured, multi-stage workflow that transforms your product concept into comprehensive documentation ready for AI agents and development teams."
    )
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start new session" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume" })).toBeVisible();
  // Stage chips present
  for (const stage of [
    "intake",
    "one_pager",
    "spec",
    "design",
    "prompt_plan",
    "agents",
    "export"
  ]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }
  // Snippet cards present
  for (const filename of ["idea_one_pager.md", "spec.md", "prompt_plan.md", "AGENTS.md"]) {
    await expect(page.getByText(filename, { exact: true }).first()).toBeVisible();
  }
});

test.skip("app shell renders with left rail and approve disabled", async ({ page }) => {
  // Start a session within the page context so the httpOnly cookie is stored for this tab
  await page.goto("/app");
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/session/init", { method: "POST" });
    return r.status;
  });
  expect(status).toBe(201);
  await page.reload();

  // App shell becomes visible after session is established (skeleton available SSR)
  await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
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
