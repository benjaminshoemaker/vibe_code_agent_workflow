import { describe, it, expect, vi } from "vitest";
import { buildManifest, sha256String } from "../../src/utils/export";

describe("export manifest", () => {
  it("is deterministic regardless of input order", () => {
    const docsA = [
      { name: "spec.md", content: "Spec" },
      { name: "idea.md", content: "Idea" }
    ];
    const docsB = [...docsA].reverse();

    const designsA = [
      { path: "B.png", size: 2, contentType: "image/png", sha256: "b", data: Buffer.from([1, 2]) },
      { path: "A.png", size: 1, contentType: "image/png", sha256: "a", data: Buffer.from([1]) }
    ];
    const designsB = [...designsA].reverse();

    const m1 = buildManifest(docsA, designsA);
    const m2 = buildManifest(docsB, designsB);

    // Ignore generated_at when comparing
    expect({ ...m1, generated_at: "t" }).toEqual({ ...m2, generated_at: "t" });

    // Verify sha256 computed for docs matches helper
    expect(m1.docs.find((d) => d.name === "idea.md")!.sha256).toBe(sha256String("Idea"));
  });
});

