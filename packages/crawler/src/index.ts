import { extractMarkdown } from "../../markdown-extractor/src/index.js";

const ASSET_EXTENSION_PATTERN = /\.(avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?)$/i;

export interface DiscoverPageLinksInput {
  html: string;
  baseUrl: string;
}

export interface AgentRailStore {
  put(key: string, value: string): Promise<void>;
}

export type Fetcher = (input: string | Request) => Promise<Response>;

export interface CrawlPageInput {
  url: string;
  fetcher?: Fetcher;
  store: AgentRailStore;
  generatedAt?: string;
}

export interface CrawlResponseInput {
  url: string;
  response: Response;
  store: AgentRailStore;
  generatedAt?: string;
}

export interface ReadyCrawlRecord {
  status: "ready";
  url: string;
  generatedAt: string;
  markdown: string;
}

export interface FailedCrawlRecord {
  status: "failed";
  url: string;
  generatedAt: string;
  reason: string;
}

export type CrawlRecord = ReadyCrawlRecord | FailedCrawlRecord;

export function parseSitemapUrls(xml: string): string[] {
  return [...String(xml).matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(Boolean);
}

export function discoverPageLinks({ html, baseUrl }: DiscoverPageLinksInput): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();

  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1/gi)) {
    const href = decodeXml(match[2].trim());
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(href, base);
    } catch {
      continue;
    }

    if (parsed.origin !== base.origin || !["http:", "https:"].includes(parsed.protocol)) {
      continue;
    }

    parsed.hash = "";
    parsed.search = "";

    if (ASSET_EXTENSION_PATTERN.test(parsed.pathname)) {
      continue;
    }

    links.add(parsed.toString());
  }

  return [...links];
}

export function resourceKeyForUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  return `page:${parsed.toString()}`;
}

export async function crawlPage({
  url,
  fetcher = fetch,
  store,
  generatedAt = new Date().toISOString()
}: CrawlPageInput): Promise<CrawlRecord> {
  if (!store || typeof store.put !== "function") {
    throw new TypeError("crawlPage requires a store with a put(key, value) method");
  }

  try {
    const response = await fetcher(url);
    return await crawlResponse({ url, response, store, generatedAt });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "crawl-error";
    return await writeFailed(store, resourceKeyForUrl(url), url, generatedAt, reason);
  }
}

export async function crawlResponse({
  url,
  response,
  store,
  generatedAt = new Date().toISOString()
}: CrawlResponseInput): Promise<CrawlRecord> {
  if (!store || typeof store.put !== "function") {
    throw new TypeError("crawlResponse requires a store with a put(key, value) method");
  }

  const key = resourceKeyForUrl(url);
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return await writeFailed(store, key, url, generatedAt, `http-${response.status}`);
  }

  if (!contentType.toLowerCase().includes("text/html")) {
    return await writeFailed(store, key, url, generatedAt, "unsupported-content-type");
  }

  const html = await response.text();
  const markdown = extractMarkdown({ html, url, generatedAt });
  const record: ReadyCrawlRecord = {
    status: "ready",
    url: normalizedUrl(url),
    generatedAt,
    markdown
  };

  await store.put(key, JSON.stringify(record));
  return record;
}

async function writeFailed(
  store: AgentRailStore,
  key: string,
  url: string,
  generatedAt: string,
  reason: string
): Promise<FailedCrawlRecord> {
  const record: FailedCrawlRecord = {
    status: "failed",
    url: normalizedUrl(url),
    generatedAt,
    reason
  };
  await store.put(key, JSON.stringify(record));
  return record;
}

function normalizedUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function decodeXml(value: string): string {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}
