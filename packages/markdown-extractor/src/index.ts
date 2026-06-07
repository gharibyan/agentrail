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
const BLOCK_CONTENT_PATTERN = /<(h[1-6]|p|div|section|article|main|ul|ol|li|table)\b/i;
const CTA_LINE_PATTERN = /^(Explore|Learn|Read|View|Open|Start|Try|Sign up|Get started)\b/i;

type JsonValue = null | string | number | boolean | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

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
  const structuredDataMarkdown = structuredDataToMarkdown(html, canonicalUrl);
  const contentHtml = selectMainContent(cleaned);
  const contentMarkdown = htmlToMarkdown(contentHtml, canonicalUrl);
  const finalDescription = description || firstMeaningfulParagraph(contentMarkdown);

  const sections = [
    `# ${title}`,
    "",
    `Canonical URL: ${canonicalUrl}`,
    `Last generated: ${generatedAt}`,
    "Source: public HTML",
    "",
    "## Description",
    finalDescription || "No description found."
  ];

  if (structuredDataMarkdown) {
    sections.push("", "## Structured Data", structuredDataMarkdown);
  }

  sections.push(
    "",
    "## Content",
    contentMarkdown || "No extractable content found."
  );

  return sections.join("\n").trimEnd() + "\n";
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
  let working = removeDroppedBlocks(removeComments(removeNonContent(html)));

  working = working.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, tableToMarkdown);
  working = working.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match: string, attrs: string, label: string) => {
    return anchorToMarkdown(attrs, label, baseUrl);
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

function anchorToMarkdown(attrs: string, label: string, baseUrl: string): string {
  const href = readAttr(attrs, "href");
  if (BLOCK_CONTENT_PATTERN.test(label)) {
    const content = htmlToMarkdown(label, baseUrl);
    const linkLabel = blockLinkLabel(attrs, content);
    const contentWithoutCta = removeStandaloneLine(content, linkLabel);
    if (!href) {
      return `\n${contentWithoutCta}\n`;
    }
    return `\n${contentWithoutCta}\n\n[${linkLabel}](${absoluteUrl(href, baseUrl)})\n`;
  }

  const text = inlineText(label);
  if (!href || !text) {
    return text;
  }
  return `[${text}](${absoluteUrl(href, baseUrl)})`;
}

function blockLinkLabel(attrs: string, content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const cta = [...lines].reverse().find((line) => line.length <= 80 && CTA_LINE_PATTERN.test(line));
  return cta || cleanText(readAttr(attrs, "aria-label") ?? "Open page");
}

function removeStandaloneLine(content: string, lineToRemove: string): string {
  const target = cleanText(lineToRemove);
  return content
    .split("\n")
    .filter((line) => cleanText(line.replace(/^#+\s*/, "").replace(/^-\s*/, "")) !== target)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function structuredDataToMarkdown(html: string, baseUrl: string): string {
  const sections = extractJsonLdNodes(html)
    .map((node) => formatStructuredNode(node, baseUrl))
    .filter((section): section is string => Boolean(section));

  return [...new Set(sections)].join("\n\n");
}

function extractJsonLdNodes(html: string): JsonObject[] {
  const nodes: JsonObject[] = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = script[1];
    if (readAttr(attrs, "type")?.toLowerCase() !== "application/ld+json") {
      continue;
    }

    const raw = script[2].trim();
    if (!raw) {
      continue;
    }

    try {
      visitJsonLd(JSON.parse(raw) as unknown, nodes);
    } catch {
      continue;
    }
  }
  return nodes;
}

function visitJsonLd(value: unknown, nodes: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitJsonLd(item, nodes);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }

  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    visitJsonLd(graph, nodes);
  }
  nodes.push(value);
}

function formatStructuredNode(node: JsonObject, baseUrl: string): string | null {
  const types = typeNames(node);
  if (types.includes("Organization")) {
    return formatOrganization(node, baseUrl);
  }
  if (types.includes("SoftwareApplication")) {
    return formatSoftwareApplication(node, baseUrl);
  }
  if (types.includes("WebPage")) {
    return formatWebPage(node, baseUrl);
  }
  if (types.includes("BreadcrumbList")) {
    return formatBreadcrumbList(node, baseUrl);
  }
  return null;
}

function formatOrganization(node: JsonObject, baseUrl: string): string {
  const lines = namedEntityLines(node, baseUrl);
  const sameAs = stringList(node, "sameAs").map((value) => safeAbsoluteUrl(value, baseUrl));
  if (sameAs.length > 0) {
    lines.push("Same as:", ...sameAs.map((value) => `- ${value}`));
  }
  return sectionMarkdown("Organization", lines);
}

function formatSoftwareApplication(node: JsonObject, baseUrl: string): string {
  const lines = namedEntityLines(node, baseUrl);
  const category = stringValue(node, "applicationCategory");
  const operatingSystem = stringValue(node, "operatingSystem");
  const features = stringList(node, "featureList");
  const offer = offerUrl(node, baseUrl);

  if (category) {
    lines.push(`Category: ${category}`);
  }
  if (operatingSystem) {
    lines.push(`Operating system: ${operatingSystem}`);
  }
  if (features.length > 0) {
    lines.push("Features:", ...features.map((feature) => `- ${feature}`));
  }
  if (offer) {
    lines.push(`Offer: ${offer}`);
  }

  return sectionMarkdown("SoftwareApplication", lines);
}

function formatWebPage(node: JsonObject, baseUrl: string): string {
  return sectionMarkdown("WebPage", namedEntityLines(node, baseUrl));
}

function formatBreadcrumbList(node: JsonObject, baseUrl: string): string {
  const items = objectList(node, "itemListElement")
    .map((item) => {
      const name = stringValue(item, "name");
      const url = breadcrumbItemUrl(item, baseUrl);
      if (!name && !url) {
        return "";
      }
      return `- ${[name, url].filter(Boolean).join(": ")}`;
    })
    .filter(Boolean);

  return items.length > 0 ? sectionMarkdown("Breadcrumbs", items) : "";
}

function namedEntityLines(node: JsonObject, baseUrl: string): string[] {
  const lines: string[] = [];
  const name = stringValue(node, "name");
  const url = stringValue(node, "url");
  const description = stringValue(node, "description");

  if (name) {
    lines.push(`Name: ${name}`);
  }
  if (url) {
    lines.push(`URL: ${safeAbsoluteUrl(url, baseUrl)}`);
  }
  if (description) {
    lines.push(`Description: ${description}`);
  }
  return lines;
}

function sectionMarkdown(title: string, lines: string[]): string {
  return lines.length > 0 ? [`### ${title}`, ...lines].join("\n") : "";
}

function offerUrl(node: JsonObject, baseUrl: string): string {
  const offers = node.offers;
  if (typeof offers === "string") {
    return safeAbsoluteUrl(offers, baseUrl);
  }
  if (isJsonObject(offers)) {
    const url = stringValue(offers, "url");
    return url ? safeAbsoluteUrl(url, baseUrl) : "";
  }
  return "";
}

function breadcrumbItemUrl(item: JsonObject, baseUrl: string): string {
  const itemValue = item.item;
  if (typeof itemValue === "string") {
    return safeAbsoluteUrl(itemValue, baseUrl);
  }
  if (isJsonObject(itemValue)) {
    const url = stringValue(itemValue, "url") || stringValue(itemValue, "@id");
    return url ? safeAbsoluteUrl(url, baseUrl) : "";
  }
  return "";
}

function typeNames(node: JsonObject): string[] {
  const value = node["@type"];
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function stringValue(node: JsonObject, key: string): string {
  const value = node[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanText(String(value));
  }
  return "";
}

function stringList(node: JsonObject, key: string): string[] {
  const value = node[key];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return cleanText(String(item));
        }
        if (isJsonObject(item)) {
          return stringValue(item, "name") || stringValue(item, "url");
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return [cleanText(value)];
  }
  return [];
}

function objectList(node: JsonObject, key: string): JsonObject[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeAbsoluteUrl(value: string, baseUrl: string): string {
  try {
    return absoluteUrl(value, baseUrl);
  } catch {
    return value;
  }
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
