import { describe, expect, it } from "vitest";
import { parseSSEPayload } from "../../lib/stream";

describe("parseSSEPayload", () => {
  it("joins multiple data lines with newlines", () => {
    const payload = [
      "event: assistant.delta",
      "data: Line 1",
      "data: - Item A",
      "data: - Item B",
      ""
    ].join("\n");

    const parsed = parseSSEPayload(payload);
    expect(parsed).toBeDefined();
    expect(parsed?.eventName).toBe("assistant.delta");
    expect(parsed?.data).toBe("Line 1\n- Item A\n- Item B");
  });

  it("returns undefined when data lines are missing", () => {
    const payload = "event: assistant.delta\n\n";
    expect(parseSSEPayload(payload)).toBeUndefined();
  });
});
