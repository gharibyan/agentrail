export type TrafficType = "ai-agent" | "search-crawler" | "browser" | "unknown-bot";

export interface BotPattern {
  name: string;
  pattern: RegExp | string;
}

export interface HeaderLike {
  get(key: string): string | null;
}

export interface ClassifyRequestInput {
  userAgent?: string;
  headers?: Headers | Record<string, string | undefined> | HeaderLike;
  aiBotPatterns?: BotPattern[];
  searchCrawlerPatterns?: BotPattern[];
}

export interface TrafficClassification {
  type: TrafficType;
  name: string;
}

export const DEFAULT_AI_BOT_PATTERNS: BotPattern[] = [
  { name: "Applebot", pattern: /\bapplebot\b/i },
  { name: "GPTBot", pattern: /\bgptbot\b/i },
  { name: "ChatGPT-User", pattern: /\bchatgpt-user\b/i },
  { name: "OAI-SearchBot", pattern: /\boai-searchbot\b/i },
  { name: "Google-CloudVertexBot", pattern: /\bgoogle-cloudvertexbot\b/i },
  { name: "Claude", pattern: /\bclaude\/\d+(?:\.\d+)?\b/i },
  { name: "ClaudeBot", pattern: /\bclaudebot\b/i },
  { name: "Claude-User", pattern: /\bclaude-user\b/i },
  { name: "Claude-SearchBot", pattern: /\bclaude-searchbot\b/i },
  { name: "Anthropic-AI", pattern: /\banthropic-ai\b/i },
  { name: "PerplexityBot", pattern: /\bperplexitybot\b/i },
  { name: "Perplexity-User", pattern: /\bperplexity-user\b/i },
  { name: "YouBot", pattern: /\byoubot\b/i },
  { name: "Cohere-AI", pattern: /\bcohere-ai\b/i },
  { name: "Amazonbot", pattern: /\bamazonbot\b/i },
  { name: "Anchor Browser", pattern: /\banchor[ -]?browser\b/i },
  { name: "Bytespider", pattern: /\bbytespider\b/i },
  { name: "Cloudflare Crawler", pattern: /\bcloudflare[ -]?crawler\b/i },
  { name: "CCBot", pattern: /\bccbot\b/i },
  { name: "DuckAssistBot", pattern: /\bduckassistbot\b/i },
  { name: "FacebookBot", pattern: /\bfacebookbot\b/i },
  { name: "Manus Bot", pattern: /\bmanus[ -]?bot\b/i },
  { name: "Meta-ExternalAgent", pattern: /\bmeta-externalagent\b/i },
  { name: "Meta-ExternalFetcher", pattern: /\bmeta-externalfetcher\b/i },
  { name: "MistralAI-User", pattern: /\bmistralai-user\b/i },
  { name: "Novellum AI Crawl", pattern: /\bnovellum[ -]?ai[ -]?crawl\b/i },
  { name: "PetalBot", pattern: /\bpetalbot\b/i },
  { name: "ProRataInc", pattern: /\bproratainc\b/i },
  { name: "TikTok Spider", pattern: /\btiktok[ -]?spider\b/i },
  { name: "Timpibot", pattern: /\btimpibot\b/i }
];

export const DEFAULT_SEARCH_CRAWLER_PATTERNS: BotPattern[] = [
  { name: "Googlebot", pattern: /\bgooglebot\b/i },
  { name: "Bingbot", pattern: /\bbingbot\b/i },
  { name: "DuckDuckBot", pattern: /\bduckduckbot\b/i },
  { name: "YandexBot", pattern: /\byandexbot\b/i },
  { name: "Baiduspider", pattern: /\bbaiduspider\b/i },
  { name: "archive.org_bot", pattern: /\barchive\.org_bot\b/i },
  { name: "Arquivo Web Crawler", pattern: /\barquivo[ -]?web[ -]?crawler\b/i },
  { name: "Terracotta Bot", pattern: /\bterracotta[ -]?bot\b/i },
  { name: "Slurp", pattern: /\bslurp\b/i }
];

const GENERIC_BOT_PATTERN = /\b(bot|crawler|spider|scraper|agent)\b/i;

export function classifyRequest(input: ClassifyRequestInput = {}): TrafficClassification {
  const headers = normalizeHeaders(input.headers);
  const userAgent = String(input.userAgent ?? headers.get("user-agent") ?? "").trim();
  const accept = String(headers.get("accept") ?? "").toLowerCase();

  const aiMatch = findPattern(userAgent, [
    ...(input.aiBotPatterns ?? []),
    ...DEFAULT_AI_BOT_PATTERNS
  ]);
  if (aiMatch) {
    return { type: "ai-agent", name: aiMatch.name };
  }

  const searchMatch = findPattern(userAgent, [
    ...(input.searchCrawlerPatterns ?? []),
    ...DEFAULT_SEARCH_CRAWLER_PATTERNS
  ]);
  if (searchMatch) {
    return { type: "search-crawler", name: searchMatch.name };
  }

  if (GENERIC_BOT_PATTERN.test(userAgent)) {
    return { type: "unknown-bot", name: inferBotName(userAgent) };
  }

  if (!userAgent || userAgent.includes("Mozilla/") || accept.includes("text/html")) {
    return { type: "browser", name: "Browser" };
  }

  return { type: "unknown-bot", name: inferBotName(userAgent) };
}

function findPattern(userAgent: string, patterns: BotPattern[]): BotPattern | null {
  for (const candidate of patterns) {
    const pattern = candidate.pattern;
    if (pattern instanceof RegExp && pattern.test(userAgent)) {
      return candidate;
    }
    if (typeof pattern === "string" && userAgent.toLowerCase().includes(pattern.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

function inferBotName(userAgent: string): string {
  const token = userAgent.match(/[A-Za-z][A-Za-z0-9_-]*(?:Bot|bot|Crawler|crawler|Spider|spider|Agent|agent)/);
  if (token) {
    return token[0];
  }
  return userAgent.split(/[ /;]/)[0] || "UnknownBot";
}

function normalizeHeaders(headers: ClassifyRequestInput["headers"] = {}): HeaderLike {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers;
  }
  if ("get" in headers && typeof headers.get === "function") {
    return headers as HeaderLike;
  }

  const normalized = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized.set(key.toLowerCase(), value);
  }

  return {
    get(key: string) {
      return normalized.get(String(key).toLowerCase()) ?? null;
    }
  };
}
