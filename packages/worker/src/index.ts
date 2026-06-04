import { classifyRequest } from "../../bot-detector/src/index.js";
import { type AgentRailStore, crawlPage, crawlResponse, parseSitemapUrls, resourceKeyForUrl } from "../../crawler/src/index.js";

const ASSET_EXTENSION_PATTERN = /\.(avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?)$/i;

export interface StoredMarkdownResource {
  status: "ready" | "stale" | "failed" | "skipped" | "pending";
  url?: string;
  generatedAt?: string;
  markdown?: string;
  reason?: string;
}

export interface JsonResourceStore extends AgentRailStore {
  get(key: string, options?: { type?: "json" }): Promise<StoredMarkdownResource | string | null>;
}

export interface AgentRailQueue {
  send(body: { url: string }): Promise<void>;
}

export interface AgentRailEnv {
  AGENTRAIL_RESOURCES?: JsonResourceStore;
  AGENTRAIL_SITEMAP_URL?: string;
  AGENTRAIL_CRAWL_QUEUE?: AgentRailQueue;
  AGENTRAIL_MAX_PAGES_PER_RUN?: string | number;
  AGENTRAIL_STALE_WINDOW_HOURS?: string | number;
  AGENTRAIL_ORIGIN?: string;
}

export interface QueueMessage {
  body?: { url?: string };
  ack?: () => void;
}

export interface QueueBatch {
  messages?: QueueMessage[];
}

export interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type OriginFetch = (request: Request) => Promise<Response>;
export type UrlFetcher = (input: string | Request) => Promise<Response>;

export async function handleRequest(
  request: Request,
  env: AgentRailEnv = {},
  ctx: ExecutionContextLike = {},
  originFetch: OriginFetch = fetch
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method) || isAssetRequest(request)) {
    return originFetch(request);
  }

  const classification = classifyRequest({ headers: request.headers });
  if (classification.type !== "ai-agent") {
    return originFetch(request);
  }

  const storage = env.AGENTRAIL_RESOURCES;
  if (!storage || typeof storage.get !== "function") {
    return originFetch(request);
  }

  const key = resourceKeyForUrl(request.url);
  const resource = await readResource(storage, key);
  if (!canServeResource(resource, env)) {
    const originResponse = await originFetch(request);
    if (!resource && request.method === "GET") {
      warmMissingResource({
        request,
        response: originResponse.clone(),
        env,
        ctx
      });
    }
    return originResponse;
  }

  return markdownResponse(resource, request.url);
}

export async function handleScheduled(
  _controller: unknown,
  env: AgentRailEnv = {},
  ctx: ExecutionContextLike = {},
  fetcher: UrlFetcher = fetch
): Promise<void> {
  if (!env.AGENTRAIL_SITEMAP_URL) {
    return;
  }

  const response = await fetcher(env.AGENTRAIL_SITEMAP_URL);
  if (!response.ok) {
    throw new Error(`Unable to fetch sitemap: ${response.status}`);
  }

  const urls = parseSitemapUrls(await response.text()).slice(0, Number(env.AGENTRAIL_MAX_PAGES_PER_RUN ?? 500));
  if (env.AGENTRAIL_CRAWL_QUEUE) {
    for (const url of urls) {
      await env.AGENTRAIL_CRAWL_QUEUE.send({ url });
    }
    return;
  }

  if (!env.AGENTRAIL_RESOURCES) {
    return;
  }

  for (const url of urls) {
    await crawlPage({
      url,
      store: env.AGENTRAIL_RESOURCES,
      fetcher,
      generatedAt: new Date().toISOString()
    });
  }
}

export async function handleQueue(batch: QueueBatch, env: AgentRailEnv = {}): Promise<void> {
  if (!env.AGENTRAIL_RESOURCES) {
    throw new Error("AGENTRAIL_RESOURCES binding is required for queue processing");
  }

  for (const message of batch.messages ?? []) {
    const url = message.body?.url;
    if (!url) {
      message.ack?.();
      continue;
    }

    await crawlPage({
      url,
      store: env.AGENTRAIL_RESOURCES,
      generatedAt: new Date().toISOString()
    });
    message.ack?.();
  }
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
  queue: handleQueue
};

function warmMissingResource({
  request,
  response,
  env,
  ctx
}: {
  request: Request;
  response: Response;
  env: AgentRailEnv;
  ctx: ExecutionContextLike;
}): void {
  const storage = env.AGENTRAIL_RESOURCES;
  if (!storage || typeof ctx.waitUntil !== "function") {
    return;
  }

  const task = crawlResponse({
    url: request.url,
    response,
    store: storage,
    generatedAt: new Date().toISOString()
  }).catch((error) => {
    console.warn("Unable to warm AgentRail resource", error);
  });

  ctx.waitUntil(task);
}

async function readResource(storage: JsonResourceStore, key: string): Promise<StoredMarkdownResource | null> {
  const value = await storage.get(key, { type: "json" });
  if (!value || typeof value !== "object") {
    return null;
  }
  return value;
}

function canServeResource(resource: StoredMarkdownResource | null, env: AgentRailEnv): resource is StoredMarkdownResource & { markdown: string; status: "ready" | "stale" } {
  if (!resource || typeof resource.markdown !== "string" || !resource.markdown.trim()) {
    return false;
  }
  if (resource.status === "ready") {
    return true;
  }
  if (resource.status !== "stale") {
    return false;
  }

  const staleWindowHours = Number(env.AGENTRAIL_STALE_WINDOW_HOURS ?? 168);
  const generatedAt = Date.parse(resource.generatedAt ?? "");
  if (!Number.isFinite(generatedAt)) {
    return false;
  }

  return Date.now() - generatedAt <= staleWindowHours * 60 * 60 * 1000;
}

function markdownResponse(
  resource: StoredMarkdownResource & { markdown: string; status: "ready" | "stale" },
  requestUrl: string
): Response {
  const headers = new Headers({
    "content-type": "text/markdown; charset=utf-8",
    "vary": "User-Agent",
    "x-ai-response-layer": "AgentRail",
    "x-ai-resource-state": resource.status,
    "link": `<${canonicalUrl(resource.url ?? requestUrl)}>; rel="canonical"`
  });

  return new Response(resource.markdown, {
    status: 200,
    headers
  });
}

function isAssetRequest(request: Request): boolean {
  const url = new URL(request.url);
  return ASSET_EXTENSION_PATTERN.test(url.pathname);
}

function canonicalUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}
