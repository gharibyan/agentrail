import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentRailLogger,
  type AgentRailRuntimeStore,
  type BackgroundScheduler,
  type StoredMarkdownResource,
  canServeAgentRailResource,
  createMarkdownResponse,
  readAgentRailResource,
  resourceKeyForUrl,
  shouldHandleAgentRailRequest,
  warmResourceFromUrl,
  type UrlFetcher
} from "../../runtime/src/index.js";

export interface NodeRequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: number | string | string[]): void;
  end(value?: string): void;
}

export type NodeNextFunction = (error?: unknown) => void;

export interface AgentRailNodeMiddlewareOptions {
  origin: string;
  store: AgentRailRuntimeStore;
  staleWindowHours?: string | number;
  schedule?: BackgroundScheduler;
  fetcher?: UrlFetcher;
  logger?: AgentRailLogger;
}

export type AgentRailNodeMiddleware = (
  request: NodeRequestLike,
  response: NodeResponseLike,
  next: NodeNextFunction
) => Promise<void>;

export interface FileResourceStoreOptions {
  directory: string;
}

export function createAgentRailMiddleware({
  origin,
  store,
  staleWindowHours,
  schedule,
  fetcher = fetch,
  logger = console
}: AgentRailNodeMiddlewareOptions): AgentRailNodeMiddleware {
  return async function agentRailMiddleware(request, response, next) {
    let webRequest: Request;
    try {
      webRequest = toWebRequest(request, origin);
      if (!shouldHandleAgentRailRequest(webRequest)) {
        next();
        return;
      }

      const resource = await readAgentRailResource(store, resourceKeyForUrl(webRequest.url));
      if (canServeAgentRailResource(resource, staleWindowHours)) {
        await sendWebResponse(createMarkdownResponse(resource, webRequest.url), response, webRequest.method);
        return;
      }

      if (!resource && webRequest.method === "GET") {
        scheduleWarmup(
          warmResourceFromUrl({
            url: webRequest.url,
            store,
            fetcher,
            generatedAt: new Date().toISOString(),
            logger
          }),
          schedule
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createNestAgentRailMiddleware(options: AgentRailNodeMiddlewareOptions): AgentRailNodeMiddleware {
  return createAgentRailMiddleware(options);
}

export function createFileResourceStore({ directory }: FileResourceStoreOptions): AgentRailRuntimeStore {
  return {
    async get(key: string, options?: { type?: "json" }) {
      try {
        const value = await readFile(filePathForKey(directory, key), "utf8");
        if (options?.type === "json") {
          return JSON.parse(value) as StoredMarkdownResource;
        }
        return value;
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }
        throw error;
      }
    },
    async put(key: string, value: string) {
      await mkdir(directory, { recursive: true });
      await writeFile(filePathForKey(directory, key), value, "utf8");
    }
  };
}

function toWebRequest(request: NodeRequestLike, origin: string): Request {
  const method = request.method ?? "GET";
  const path = request.originalUrl ?? request.url ?? "/";
  const url = new URL(path, origin);
  return new Request(url, {
    method,
    headers: toWebHeaders(request.headers ?? {})
  });
}

function toWebHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      output.set(name, value.join(", "));
      continue;
    }
    if (typeof value === "string") {
      output.set(name, value);
    }
  }
  return output;
}

async function sendWebResponse(response: Response, nodeResponse: NodeResponseLike, method: string): Promise<void> {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value);
  });

  nodeResponse.end(method === "HEAD" ? "" : await response.text());
}

function scheduleWarmup(task: Promise<unknown>, schedule?: BackgroundScheduler): void {
  if (schedule) {
    schedule(task);
    return;
  }
  void task;
}

function filePathForKey(directory: string, key: string): string {
  return join(directory, `${encodeURIComponent(key)}.json`);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}
