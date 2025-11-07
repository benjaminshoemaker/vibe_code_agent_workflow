import { describe, expect, it, vi } from "vitest";

const responsesCreateMock = vi.fn();

function mockOpenAI() {
  responsesCreateMock.mockReset();
  class OpenAIStub {
    responses = { create: responsesCreateMock };
  }
  vi.doMock("openai", () => ({ default: OpenAIStub }));
}

async function loadOpenAI(overrides?: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  mockOpenAI();
  vi.doMock("../../src/env", () => ({
    env: {
      NODE_ENV: "test",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: overrides?.OPENAI_MODEL,
      OPENAI_API_BASE: overrides?.OPENAI_API_BASE
    }
  }));

  return import("../../src/libs/openai");
}

describe("OpenAI client helpers", () => {
  it("uses default model and generation settings", async () => {
    const { generateResponse } = await loadOpenAI();

    await generateResponse({ input: "hello" });

    expect(responsesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini", temperature: 0.2, input: "hello" }),
      expect.objectContaining({ timeout: 20_000 })
    );
  });

  it("respects OPENAI_MODEL override and validation temperature", async () => {
    const { validateResponse } = await loadOpenAI({ OPENAI_MODEL: "gpt-4o" });

    await validateResponse({ input: "ping" });

    expect(responsesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o", temperature: 0 }),
      expect.any(Object)
    );
  });
});
