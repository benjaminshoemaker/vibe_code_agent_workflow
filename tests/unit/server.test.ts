import { describe, expect, it } from "vitest";
import { createApp, type NextRequestHandler } from "../../src/server";

const noopNextHandler: NextRequestHandler = async (_req, res) => {
  res.statusCode = 404;
  res.end();
};

describe("server routes", () => {
  it("returns ok for /api/health", async () => {
    const app = createApp({ nextHandler: noopNextHandler, dev: true });
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");

    await app.close();
  });

  it("applies security headers to Next.js responses", async () => {
    const nextHandler: NextRequestHandler = async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end("<html>ok</html>");
    };

    const app = createApp({ nextHandler, dev: true });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(response.headers["strict-transport-security"]).toMatch(/max-age/);
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    await app.close();
  });
});
