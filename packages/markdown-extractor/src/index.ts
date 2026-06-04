const NON_CONTENT_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe"
];

const BLOCK_DROP_TAGS = ["nav", "footer", "aside"];

export interface ExtractMarkdownInput {
  html: string;
  url: string;
  generatedAt?: string;
}

export function extractMarkdown({ html, url, generatedAt = new Date().toISOString() }: ExtractMarkdownInput): string {
  if (!html || typeof html !== "string") {
    throw new TypeError("extractMarkdown requires an HTML string");
  }
  if (!url) {
    throw new TypeError("extractMarkdown requires a source URL");
  }

  const cleaned = removeComments(removeNonContent(html));
  const canonicalUrl = canonicalizeUrl(readCanonicalUrl(cleaned) ?? url);
  const title = readTitle(cleaned) || titleFromUrl(canonicalUrl);
  const description = readMetaDescription(cleaned);
  const contentHtml = selectMainContent(cleaned);
  const contentMarkdown = htmlToMarkdown(contentHtml, canonicalUrl);
  const finalDescription = description || firstMeaningfulParagraph(contentMarkdown);

  return [
    `# ${title}`,
    "",
    `Canonical URL: ${canonicalUrl}`,
    `Last generated: ${generatedAt}`,
    "Source: public HTML",
    "",
    "## Description",
    finalDescription || "No description found.",
    "",
    "## Content",
    contentMarkdown || "No extractable content found."
  ].join("\n").trimEnd() + "\n";
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
  let working = removeDroppedBlocks(removeComments(removeNonContent(html)));

  working = working.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, tableToMarkdown);
  working = working.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match: string, attrs: string, label: string) => {
    const href = readAttr(attrs, "href");
    const text = inlineText(label);
    if (!href || !text) {
      return text;
    }
    return `[${text}](${absoluteUrl(href, baseUrl)})`;
  });
  working = working.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match: string, level: string, value: string) => {
    return `\n${"#".repeat(Number(level))} ${inlineText(value)}\n\n`;
  });
  working = working.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match: string, value: string) => {
    return `\n- ${inlineText(value)}\n`;
  });
  working = working.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match: string, value: string) => {
    return `\n${inlineText(value)}\n\n`;
  });
  working = working.replace(/<br\s*\/?>/gi, "\n");
  working = working.replace(/<\/(div|section|article|main|ul|ol|tr)>/gi, "\n");
  working = working.replace(/<(div|section|article|main|ul|ol|tbody|thead|tr)\b[^>]*>/gi, "\n");

  return normalizeMarkdown(stripTags(working));
}

function tableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => {
      return [...row[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => inlineText(cell[2]));
    })
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "\n";
  }

  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const copy = [...row];
    while (copy.length < width) {
      copy.push("");
    }
    return copy;
  });

  const [header, ...body] = normalizedRows;
  const separator = header.map(() => "---");
  return `\n${[header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
}

function removeNonContent(html: string): string {
  let output = html;
  for (const tag of NON_CONTENT_TAGS) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  return output;
}

function removeDroppedBlocks(html: string): string {
  let output = html;
  for (const tag of BLOCK_DROP_TAGS) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  return output;
}

function removeComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function selectMainContent(html: string): string {
  return (
    firstTag(html, "main") ??
    firstTag(html, "article") ??
    firstRoleMain(html) ??
    firstTag(html, "body") ??
    html
  );
}

function firstTag(html: string, tagName: string): string | null {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ?? null;
}

function firstRoleMain(html: string): string | null {
  const match = html.match(/<([a-z0-9-]+)\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/i);
  return match?.[2] ?? null;
}

function readTitle(html: string): string {
  return cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
}

function readMetaDescription(html: string): string {
  for (const meta of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = meta[1];
    if (readAttr(attrs, "name")?.toLowerCase() === "description") {
      return cleanText(readAttr(attrs, "content") ?? "");
    }
  }
  return "";
}

function readCanonicalUrl(html: string): string | null {
  for (const link of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = link[1];
    if ((readAttr(attrs, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
      return readAttr(attrs, "href");
    }
  }
  return null;
}

function readAttr(attrs: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return attrs.match(pattern)?.[2] ?? null;
}

function inlineText(html: string): string {
  return cleanText(stripTags(html));
}

function cleanText(value: string): string {
  return decodeEntities(stripTags(String(value))).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return String(value).replace(/<[^>]+>/g, "");
}

function normalizeMarkdown(value: string): string {
  return decodeEntities(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(value: string): string {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function canonicalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function absoluteUrl(value: string, baseUrl: string): string {
  const parsed = new URL(value, baseUrl);
  parsed.hash = "";
  return parsed.toString();
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  const segment = parsed.pathname.split("/").filter(Boolean).pop();
  if (!segment) {
    return parsed.hostname;
  }
  return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstMeaningfulParagraph(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("- ") && !line.startsWith("|")) ?? "";
}
