import {
  type AgentRailRuntimeStore,
  type ExecutionContextLike,
  type OriginFetch,
  type StoredMarkdownResource,
  type UrlFetcher,
  handleAgentRailRequest
} from "../../runtime/src/index.js";
import { crawlPage, parseSitemapUrls } from "../../crawler/src/index.js";

export type {
  AgentRailRuntimeStore as JsonResourceStore,
  ExecutionContextLike,
  OriginFetch,
  StoredMarkdownResource,
  UrlFetcher
};

export interface AgentRailQueue {
  send(body: { url: string }): Promise<void>;
}

export interface AgentRailEnv {
  AGENTRAIL_RESOURCES?: AgentRailRuntimeStore;
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

export async function handleRequest(
  request: Request,
  env: AgentRailEnv = {},
  ctx: ExecutionContextLike = {},
  originFetch: OriginFetch = fetch
): Promise<Response> {
  return handleAgentRailRequest(request, {
    store: env.AGENTRAIL_RESOURCES,
    staleWindowHours: env.AGENTRAIL_STALE_WINDOW_HOURS,
    schedule: ctx.waitUntil?.bind(ctx),
    originFetch,
    logger: console
  });
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
