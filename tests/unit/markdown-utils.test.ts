import { describe, expect, it } from "vitest";
import { buildPreviewDocument, MARKDOWN_IFRAME_CSP, renderMarkdownToHtml } from "../../src/utils/markdown";

describe("renderMarkdownToHtml", () => {
  it("blocks remote image sources", () => {
    const html = renderMarkdownToHtml("![remote](https://evil.example/img.png)");
    expect(html).toContain("Remote image blocked");
    expect(html).toContain("data-blocked-src=\"https://evil.example/img.png\"");
    expect(html).not.toContain("<img");
  });

  it("allows relative image sources", () => {
    const html = renderMarkdownToHtml("![local](/assets/img.png)");
    expect(html).toContain("<img");
    expect(html).toContain("src=\"/assets/img.png\"");
  });

  it("strips javascript: links", () => {
    const html = renderMarkdownToHtml("[hack](javascript:alert(1))");
    expect(html).not.toMatch(/\shref="javascript:/i);
    expect(html).toContain("data-blocked-href=\"javascript:alert(1)\"");
  });
});

describe("buildPreviewDocument", () => {
  it("injects meta CSP", () => {
    const doc = buildPreviewDocument("<p>Hello</p>");
    expect(doc).toContain(MARKDOWN_IFRAME_CSP);
    expect(doc).toContain("<meta http-equiv=\"Content-Security-Policy\"");
  });
});
