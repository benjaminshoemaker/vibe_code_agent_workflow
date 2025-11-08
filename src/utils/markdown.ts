const BLOCK_TAG_PATTERN =
  /^(?:<\/?(?:article|aside|blockquote|div|figure|figcaption|footer|header|main|nav|p|pre|section|table|thead|tbody|tr|th|td|ul|ol|li|h[1-6]|iframe|code|details|summary|hr|br))/i;

export const MARKDOWN_IFRAME_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function renderMarkdownToHtml(markdown: string): string {
  const html = basicMarkdownToHtml(markdown ?? "");
  return sanitizeHtml(html);
}

export function buildPreviewDocument(html: string): string {
  const content = html && html.trim().length > 0 ? html : '<p class="md-preview-empty">(empty)</p>';
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8"/>',
    `<meta http-equiv="Content-Security-Policy" content="${MARKDOWN_IFRAME_CSP}">`,
    "<style>",
    "body{font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;background:#fff;color:#0f172a;font-size:14px;line-height:1.6;}",
    "h1,h2,h3,h4,h5,h6{margin-top:1.5em;margin-bottom:0.6em;}",
    "p{margin:0 0 1em 0;}",
    "img{max-width:100%;height:auto;border-radius:0.75rem;}",
    ".md-preview-warning{border:1px solid #fbbf24;background:#fffbeb;color:#92400e;padding:12px;border-radius:12px;font-size:13px;margin:12px 0;}",
    ".md-preview-warning-link{color:#92400e;text-decoration:underline;}",
    ".md-preview-empty{color:#94a3b8;font-style:italic;}",
    "</style>",
    "</head>",
    `<body>${content}</body>`,
    "</html>"
  ].join("");
}

function basicMarkdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const processed: string[] = [];

  for (const raw of lines) {
    const headingMatch = raw.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      processed.push(`<h${level}>${transformInline(headingMatch[2].trim())}</h${level}>`);
      continue;
    }
    processed.push(transformInline(raw));
  }

  return processed
    .join("\n")
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      if (BLOCK_TAG_PATTERN.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function transformInline(input: string): string {
  if (!input) return "";
  let result = input;

  result = result.replace(/!\[([^\]]*?)\]\(((?:[^()]|\([^)]*\))+)(?:\s+"([^"]*?)")?\)/g, (_match, alt = "", url = "", title = "") => {
    const safeSrc = escapeAttribute(url.trim());
    const attrs = [`src="${safeSrc}"`, `alt="${escapeAttribute(alt)}"`];
    if (title) attrs.push(`title="${escapeAttribute(title)}"`);
    return `<img ${attrs.join(" ")} />`;
  });

  result = result.replace(/\[([^\]]+)\]\(((?:[^()]|\([^)]*\))+)(?:\s+"([^"]*?)")?\)/g, (_match, label = "", href = "", title = "") => {
    const safeHref = escapeAttribute(href.trim());
    const attrs = [`href="${safeHref}"`];
    if (title) attrs.push(`title="${escapeAttribute(title)}"`);
    return `<a ${attrs.join(" ")}>${label}</a>`;
  });

  return result;
}

function sanitizeHtml(html: string): string {
  let output = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  output = removeEventHandlers(output);
  output = sanitizeImages(output);
  output = sanitizeLinks(output);
  return output;
}

function removeEventHandlers(html: string): string {
  return html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
}

function sanitizeImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = getAttribute(tag, "src");
    if (!src) {
      return tag;
    }
    if (isAllowedImageSrc(src)) {
      return stripSrcSet(tag);
    }
    const escapedSrc = escapeAttribute(src);
    return `<div class="md-preview-warning" data-blocked-src="${escapedSrc}">Remote image blocked: ${escapedSrc}</div>`;
  });
}

function sanitizeLinks(html: string): string {
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = getAttribute(tag, "href");
    if (!href) {
      return tag;
    }
    if (/^\s*javascript:/i.test(href)) {
      const escapedHref = escapeAttribute(href);
      let safeTag = tag.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, 'href="#"');
      if (!/data-blocked-href/i.test(safeTag)) {
        safeTag = safeTag.replace("<a", `<a data-blocked-href="${escapedHref}" aria-disabled="true" class="md-preview-warning-link"`);
      }
      return safeTag;
    }
    return tag;
  });
}

function stripSrcSet(tag: string): string {
  return tag.replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function isAllowedImageSrc(src: string): boolean {
  const trimmed = src.trim();
  return (
    /^data:/i.test(trimmed) ||
    /^blob:/i.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("#") ||
    (!trimmed.includes(":") && !trimmed.startsWith("//"))
  );
}

function getAttribute(tag: string, name: string): string | null {
  const regex = new RegExp(`${name}\\s*=\\s*("(.*?)"|'(.*?)'|([^\\s"'>]+))`, "i");
  const match = tag.match(regex);
  if (!match) {
    return null;
  }
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
