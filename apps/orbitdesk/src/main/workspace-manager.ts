import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  WebContentsView,
  session,
  type Rectangle,
} from "electron";
import { adapterFor, isAllowedSiteUrl } from "../adapters/site-adapters.js";
import type {
  BrowserBounds,
  BrowserCommand,
  DetectedAsset,
  Workspace,
  WorkspaceEvent,
} from "../shared/contracts.js";
import type { AutomationWorkspacePort } from "./automation-engine.js";
import type { DownloadManager } from "./download-manager.js";
import type { StateStore } from "./store.js";

interface WorkspaceRuntime {
  window: BrowserWindow;
  view: WebContentsView;
  ready: boolean;
}

export class WorkspaceManager extends EventEmitter implements AutomationWorkspacePort {
  readonly #store: StateStore;
  readonly #downloads: DownloadManager;
  readonly #preloadPath: string;
  readonly #rendererEntry: string;
  readonly #runtimes = new Map<string, WorkspaceRuntime>();

  constructor(
    store: StateStore,
    downloads: DownloadManager,
    preloadPath: string,
    rendererEntry: string,
  ) {
    super();
    this.#store = store;
    this.#downloads = downloads;
    this.#preloadPath = preloadPath;
    this.#rendererEntry = rendererEntry;
  }

  async ensureOpen(workspace: Workspace): Promise<void> {
    const existing = this.#runtimes.get(workspace.id);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      return;
    }
    await this.open(workspace.id);
  }

  async open(workspaceId: string): Promise<void> {
    const workspace = this.#store.requireWorkspace(workspaceId);
    const existing = this.#runtimes.get(workspaceId);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      return;
    }

    this.#store.setWorkspaceStatus(workspaceId, "opening", {
      lastOpenedAt: new Date().toISOString(),
      lastError: undefined,
    });
    const window = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 980,
      minHeight: 680,
      backgroundColor: "#f6f7f4",
      title: `${workspace.name} · OrbitDesk`,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    const partition = `persist:orbitdesk-${safePartition(workspace.profileId)}`;
    const persistentSession = session.fromPartition(partition, { cache: true });
    persistentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    persistentSession.setPermissionCheckHandler(() => false);

    const view = new WebContentsView({
      webPreferences: {
        session: persistentSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        javascript: true,
        webSecurity: true,
      },
    });
    window.contentView.addChildView(view);
    view.setBounds({ x: 16, y: 102, width: 1348, height: 760 });
    view.setBackgroundColor("#ffffff");
    this.#downloads.register(persistentSession, view.webContents, workspaceId);

    const runtime: WorkspaceRuntime = { window, view, ready: false };
    this.#runtimes.set(workspaceId, runtime);
    this.#wireRuntime(workspace, runtime);

    window.once("ready-to-show", () => window.show());
    await loadRenderer(window, this.#rendererEntry, `workspace=${encodeURIComponent(workspaceId)}`);
    await this.#loadWorkspaceUrl(workspace, view);
    if (!window.isVisible()) window.show();
  }

  setBounds(workspaceId: string, bounds: BrowserBounds): void {
    const runtime = this.#requireRuntime(workspaceId);
    const contentBounds = runtime.window.getContentBounds();
    const rectangle: Rectangle = {
      x: Math.max(0, Math.min(bounds.x, contentBounds.width - 120)),
      y: Math.max(0, Math.min(bounds.y, contentBounds.height - 120)),
      width: Math.max(120, Math.min(bounds.width, contentBounds.width - bounds.x)),
      height: Math.max(120, Math.min(bounds.height, contentBounds.height - bounds.y)),
    };
    runtime.view.setBounds(rectangle);
  }

  command(workspaceId: string, command: BrowserCommand): void {
    const workspace = this.#store.requireWorkspace(workspaceId);
    const contents = this.#requireRuntime(workspaceId).view.webContents;
    if (command === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (command === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    if (command === "reload") contents.reload();
    if (command === "home") void contents.loadURL(workspace.startUrl);
  }

  async waitUntilReady(workspaceId: string, timeoutMs: number): Promise<void> {
    const runtime = this.#requireRuntime(workspaceId);
    if (runtime.ready && !runtime.view.webContents.isLoading()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("等待站点页面加载超时"));
      }, timeoutMs);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        runtime.view.webContents.off("did-finish-load", onReady);
      };
      runtime.view.webContents.once("did-finish-load", onReady);
    });
  }

  async evaluate<T>(workspaceId: string, script: string): Promise<T> {
    const workspace = this.#store.requireWorkspace(workspaceId);
    const runtime = this.#requireRuntime(workspaceId);
    const currentUrl = runtime.view.webContents.getURL();
    if (
      workspace.siteId !== "demo" &&
      !isAllowedSiteUrl(adapterFor(workspace.siteId), currentUrl)
    ) {
      throw new Error("当前页面不是已配置的生成站点；请先完成登录并返回生成页面");
    }
    return (await runtime.view.webContents.executeJavaScript(script, true)) as T;
  }

  async requestDownload(asset: DetectedAsset): Promise<void> {
    const runtime = this.#requireRuntime(asset.workspaceId);
    this.#downloads.request(runtime.view.webContents, asset);
  }

  closeAll(): void {
    for (const runtime of this.#runtimes.values()) {
      if (!runtime.window.isDestroyed()) runtime.window.destroy();
    }
    this.#runtimes.clear();
  }

  #wireRuntime(workspace: Workspace, runtime: WorkspaceRuntime): void {
    const { window, view } = runtime;
    const send = (event: WorkspaceEvent) => {
      this.emit("workspace-event", event);
      if (!window.isDestroyed()) window.webContents.send("workspace:event", event);
    };
    view.webContents.on("did-start-loading", () => {
      runtime.ready = false;
      this.#store.setWorkspaceStatus(workspace.id, "opening");
      send({ workspaceId: workspace.id, type: "status", value: "正在加载", at: new Date().toISOString() });
    });
    view.webContents.on("did-finish-load", () => {
      runtime.ready = true;
      this.#store.setWorkspaceStatus(workspace.id, "ready", {
        currentUrl: view.webContents.getURL(),
        lastError: undefined,
      });
      send({ workspaceId: workspace.id, type: "status", value: "页面已就绪", at: new Date().toISOString() });
    });
    view.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      const message = `${description} (${code})`;
      this.#store.setWorkspaceStatus(workspace.id, "error", { currentUrl: validatedUrl, lastError: message });
      send({ workspaceId: workspace.id, type: "status", value: message, at: new Date().toISOString() });
    });
    view.webContents.on("did-navigate", (_event, url) => {
      this.#store.setWorkspaceStatus(workspace.id, runtime.ready ? "ready" : "opening", { currentUrl: url });
      send({ workspaceId: workspace.id, type: "url", value: url, at: new Date().toISOString() });
    });
    view.webContents.on("page-title-updated", (_event, title) => {
      send({ workspaceId: workspace.id, type: "title", value: title, at: new Date().toISOString() });
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeWebNavigation(url)) void view.webContents.loadURL(url);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      const localDemo = workspace.siteId === "demo" && url.startsWith("file://");
      if (!localDemo && !isSafeWebNavigation(url)) event.preventDefault();
    });
    window.on("closed", () => {
      this.#runtimes.delete(workspace.id);
      this.#store.setWorkspaceStatus(workspace.id, "offline");
    });
  }

  async #loadWorkspaceUrl(workspace: Workspace, view: WebContentsView): Promise<void> {
    if (workspace.siteId === "demo") {
      const demoPath = fileURLToPath(new URL("../../dist/demo-generator.html", import.meta.url));
      await view.webContents.loadFile(demoPath);
      return;
    }
    if (!isAllowedSiteUrl(adapterFor(workspace.siteId), workspace.startUrl)) {
      throw new Error("工作区 URL 不属于允许站点");
    }
    await view.webContents.loadURL(workspace.startUrl);
  }

  #requireRuntime(workspaceId: string): WorkspaceRuntime {
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime || runtime.window.isDestroyed()) throw new Error("工作区窗口尚未打开");
    return runtime;
  }
}

export async function loadRenderer(
  window: BrowserWindow,
  rendererEntry: string,
  query = "",
): Promise<void> {
  if (rendererEntry.startsWith("http://") || rendererEntry.startsWith("https://")) {
    const separator = rendererEntry.includes("?") ? "&" : "?";
    await window.loadURL(`${rendererEntry}${query ? `${separator}${query}` : ""}`);
    return;
  }
  await window.loadFile(rendererEntry, query ? { query: Object.fromEntries(new URLSearchParams(query)) } : undefined);
}

function safePartition(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function isSafeWebNavigation(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "about:";
  } catch {
    return false;
  }
}
