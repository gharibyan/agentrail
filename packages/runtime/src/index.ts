import { classifyRequest } from "../../bot-detector/src/index.js";
import {
  type AgentRailStore,
  crawlPage,
  crawlResponse,
  resourceKeyForUrl
} from "../../crawler/src/index.js";

const ASSET_EXTENSION_PATTERN = /\.(avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?)$/i;

export interface StoredMarkdownResource {
  status: "ready" | "stale" | "failed" | "skipped" | "pending";
  url?: string;
  generatedAt?: string;
  markdown?: string;
  reason?: string;
}

export interface AgentRailRuntimeStore extends AgentRailStore {
  get(key: string, options?: { type?: "json" }): Promise<StoredMarkdownResource | string | null>;
}

export interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface AgentRailLogger {
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

export type OriginFetch = (request: Request) => Promise<Response>;
export type UrlFetcher = (input: string | Request) => Promise<Response>;
export type BackgroundScheduler = (task: Promise<unknown>) => void;

export interface HandleAgentRailRequestOptions {
  store?: AgentRailRuntimeStore;
  staleWindowHours?: string | number;
  schedule?: BackgroundScheduler;
  originFetch?: OriginFetch;
  logger?: AgentRailLogger;
}

export interface WarmResourceFromResponseInput {
  url: string;
  response: Response;
  store: AgentRailRuntimeStore;
  generatedAt?: string;
  logger?: AgentRailLogger;
}

export interface WarmResourceFromUrlInput {
  url: string;
  store: AgentRailRuntimeStore;
  fetcher?: UrlFetcher;
  generatedAt?: string;
  logger?: AgentRailLogger;
}

export async function handleAgentRailRequest(
  request: Request,
  {
    store,
    staleWindowHours,
    schedule,
    originFetch = fetch,
    logger = console
  }: HandleAgentRailRequestOptions = {}
): Promise<Response> {
  if (!shouldHandleAgentRailRequest(request) || !store) {
    return originFetch(request);
  }

  const key = resourceKeyForUrl(request.url);
  const resource = await readAgentRailResource(store, key);
  if (!canServeAgentRailResource(resource, staleWindowHours)) {
    const originResponse = await originFetch(request);
    if (!resource && request.method === "GET" && schedule) {
      schedule(
        warmResourceFromResponse({
          url: request.url,
          response: originResponse.clone(),
          store,
          generatedAt: new Date().toISOString(),
          logger
        })
      );
    }
    return originResponse;
  }

  return createMarkdownResponse(resource, request.url);
}

export function shouldHandleAgentRailRequest(request: Request): boolean {
  if (!["GET", "HEAD"].includes(request.method) || isAssetRequest(request)) {
    return false;
  }

  return classifyRequest({ headers: request.headers }).type === "ai-agent";
}

export async function readAgentRailResource(
  store: AgentRailRuntimeStore,
  key: string
): Promise<StoredMarkdownResource | null> {
  const value = await store.get(key, { type: "json" });
  if (!value || typeof value !== "object") {
    return null;
  }
  return value;
}

export function canServeAgentRailResource(
  resource: StoredMarkdownResource | null,
  staleWindowHours: string | number = 168
): resource is StoredMarkdownResource & { markdown: string; status: "ready" | "stale" } {
  if (!resource || typeof resource.markdown !== "string" || !resource.markdown.trim()) {
    return false;
  }
  if (resource.status === "ready") {
    return true;
  }
  if (resource.status !== "stale") {
    return false;
  }

  const parsedStaleWindowHours = Number(staleWindowHours);
  const generatedAt = Date.parse(resource.generatedAt ?? "");
  if (!Number.isFinite(generatedAt) || !Number.isFinite(parsedStaleWindowHours)) {
    return false;
  }

  return Date.now() - generatedAt <= parsedStaleWindowHours * 60 * 60 * 1000;
}

export function createMarkdownResponse(
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

export async function warmResourceFromResponse({
  url,
  response,
  store,
  generatedAt = new Date().toISOString(),
  logger = console
}: WarmResourceFromResponseInput): Promise<void> {
  await crawlResponse({ url, response, store, generatedAt }).catch((error) => {
    logger.warn("Unable to warm AgentRail resource", error);
  });
}

export async function warmResourceFromUrl({
  url,
  store,
  fetcher = fetch,
  generatedAt = new Date().toISOString(),
  logger = console
}: WarmResourceFromUrlInput): Promise<void> {
  await crawlPage({ url, store, fetcher, generatedAt }).catch((error) => {
    logger.warn("Unable to warm AgentRail resource", error);
  });
}

export function createMemoryResourceStore(
  initial: Record<string, StoredMarkdownResource> = {}
): AgentRailRuntimeStore {
  const values = new Map<string, string>();
  for (const [key, record] of Object.entries(initial)) {
    values.set(key, JSON.stringify(record));
  }

  return {
    async get(key: string, options?: { type?: "json" }) {
      const value = values.get(key) ?? null;
      if (!value || options?.type !== "json") {
        return value;
      }
      return JSON.parse(value) as StoredMarkdownResource;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    }
  };
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

export { resourceKeyForUrl };
