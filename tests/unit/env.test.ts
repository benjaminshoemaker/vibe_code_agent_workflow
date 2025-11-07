import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env";

describe("env loader", () => {
  it("parses the minimum env and sets defaults", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      PORT: "4500",
      OPENAI_MODEL: "gpt-4o-mini"
    } as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(4500);
    expect(env.OPENAI_MODEL).toBe("gpt-4o-mini");
  });

  it("throws on invalid port", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "development",
        PORT: "oops"
      } as NodeJS.ProcessEnv)
    ).toThrow(/PORT/);
  });
});
