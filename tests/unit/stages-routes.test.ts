import { describe, expect, it, beforeAll, afterAll } from "vitest";
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

describe("stage routes", () => {
  it("rejects invalid stage names", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/stages/unknown/approve"
    });
    expect(response.statusCode).toBe(401);
  });

  it("stubs approval with reasons", async () => {
    const init = await app.inject({ method: "POST", url: "/api/session/init" });
    const cookie = init.headers["set-cookie"] as string;

    const response = await app.inject({
      method: "POST",
      url: "/api/stages/spec/approve",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, reasons: ["Validator not implemented yet"] });
  });
});
