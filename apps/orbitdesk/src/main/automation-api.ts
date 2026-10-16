import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { validateTaskInput } from "../domain/validation.js";
import type { StateStore } from "./store.js";
import type { WorkspaceManager } from "./workspace-manager.js";

const maxBodyBytes = 1_000_000;

export class AutomationApiServer {
  readonly #store: StateStore;
  readonly #workspaces: WorkspaceManager;
  #server?: Server;
  #signature = "";

  constructor(store: StateStore, workspaces: WorkspaceManager) {
    this.#store = store;
    this.#workspaces = workspaces;
  }

  async sync(): Promise<void> {
    const settings = this.#store.snapshot().settings;
    const signature = `${settings.automationApiEnabled}:${settings.automationApiPort}:${settings.automationApiToken}`;
    if (signature === this.#signature && this.#server) return;
    await this.stop();
    this.#signature = signature;
    if (!settings.automationApiEnabled) return;

    const server = createServer((request, response) => {
      void this.#route(request, response).catch((error: unknown) => {
        json(response, 500, { error: errorMessage(error) });
      });
    });
    server.keepAliveTimeout = 5_000;
    server.headersTimeout = 8_000;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(settings.automationApiPort, "127.0.0.1");
    });
    this.#server = server;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const settings = this.#store.snapshot().settings;
    if (!validHost(request.headers.host, settings.automationApiPort)) {
      json(response, 400, { error: "invalid_host" });
      return;
    }
    if (!authorized(request.headers.authorization, settings.automationApiToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      json(response, 401, { error: "unauthorized" });
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    const url = new URL(request.url || "/", `http://127.0.0.1:${settings.automationApiPort}`);
    if (request.method === "GET" && url.pathname === "/v1/health") {
      json(response, 200, { ok: true, service: "OrbitDesk", apiVersion: 1 });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/state") {
      const state = this.#store.snapshot();
      json(response, 200, {
        workspaces: state.workspaces.map(({ id, name, siteId, status, group, order }) => ({ id, name, siteId, status, group, order })),
        tasks: state.tasks.map(({ id, workspaceId, kind, status, progress, queueOrder, storyboardId, shotId }) => ({ id, workspaceId, kind, status, progress, queueOrder, storyboardId, shotId })),
        storyboards: state.storyboards.map(({ id, name, workspaceId, shots, updatedAt }) => ({ id, name, workspaceId, shotCount: shots.length, updatedAt })),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/tasks") {
      const input = validateTaskInput(await readJson(request));
      this.#store.getWorkspace(input.workspaceId);
      json(response, 201, { tasks: this.#store.createTasks(input) });
      return;
    }

    const openMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/open$/);
    if (request.method === "POST" && openMatch) {
      await this.#workspaces.open(decodeURIComponent(openMatch[1]!));
      json(response, 202, { ok: true });
      return;
    }
    const cancelMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const task = this.#store.getTask(decodeURIComponent(cancelMatch[1]!));
      if (!["completed", "cancelled"].includes(task.status)) this.#store.transitionTask(task.id, "cancelled");
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "not_found" });
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error("Content-Type 必须是 application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
