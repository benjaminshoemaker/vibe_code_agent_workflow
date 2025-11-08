import type { Page } from "@playwright/test";

const defaultPort = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${defaultPort}`;

export async function initSession(page: Page) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/session/init");
  if (response.status() !== 201) {
    throw new Error(`Session init failed with status ${response.status()}`);
  }
  const { session_id } = (await response.json()) as { session_id: string };
  await page.context().addCookies([
    {
      name: "sid",
      value: session_id,
      url: baseUrl,
      sameSite: "Lax"
    }
  ]);
}
