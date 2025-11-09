import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp, type NextRequestHandler } from "../../src/server";

const noopNextHandler: NextRequestHandler = async (_req, res) => {
  res.statusCode = 404;
  res.end();
};

const app = createApp({ nextHandler: noopNextHandler, dev: true });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("rate limits", () => {
  it("returns 429 with Retry-After after exceeding export quota", async () => {
    const init = await app.inject({ method: "POST", url: "/api/session/init" });
    const cookie = init.headers["set-cookie"] as string;

    // 10 allowed per hour
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({ method: "POST", url: "/api/export/zip", headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({ method: "POST", url: "/api/export/zip", headers: { cookie } });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

