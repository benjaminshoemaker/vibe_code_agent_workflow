import { test, expect } from "@playwright/test";

test("home page renders hero content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-heading")).toBeVisible();
  await expect(page.getByText(/Agent-ready planner/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Start new session" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume" })).toBeVisible();
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
