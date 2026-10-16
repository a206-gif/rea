import { BrowserWindow, WebContentsView, session, type Cookie, type Rectangle } from "electron";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { adapterFor, isAllowedSiteUrl } from "../adapters/site-adapters.js";
import type {
  AdapterProbe,
  BrowserBounds,
  BrowserCommand,
  NetworkDiagnostics,
  PageActionResult,
  Workspace,
  WorkspaceEvent,
} from "../shared/contracts.js";
import { buildDurationSelectionScript, buildProbeScript } from "./page-scripts.js";
import type { StateStore } from "./store.js";
import type { DownloadManager } from "./download-manager.js";

interface WorkspaceRuntime {
  window: BrowserWindow;
  view: WebContentsView;
  bounds: BrowserBounds;
}

interface PortableCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export class WorkspaceManager extends EventEmitter {
  readonly #store: StateStore;
  readonly #downloadManager: DownloadManager;
  readonly #preloadPath: string;
  readonly #rendererUrl: string;
  readonly #runtimes = new Map<string, WorkspaceRuntime>();

  constructor(store: StateStore, downloadManager: DownloadManager, preloadPath: string, rendererUrl: string) {
    super();
    this.#store = store;
    this.#downloadManager = downloadManager;
    this.#preloadPath = preloadPath;
    this.#rendererUrl = rendererUrl;
  }

  hasOpenWorkspace(workspaceId: string): boolean {
    return this.#runtimes.has(workspaceId);
  }

  async ensureOpen(workspace: Workspace): Promise<void> {
    await this.open(workspace.id);
  }

  async waitUntilReady(workspaceId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = this.#store.getWorkspace(workspaceId).status;
      if (status === "ready" || status === "working") return;
      if (status === "error" || status === "needs_attention") throw new Error(this.#store.getWorkspace(workspaceId).lastError || "实例未就绪");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("等待浏览器实例就绪超时");
  }

  evaluate<T>(workspaceId: string, script: string): Promise<T> {
    return this.execute<T>(workspaceId, script);
  }

  async requestDownload(asset: import("../shared/contracts.js").DetectedAsset): Promise<void> {
    const contents = this.getWebContents(asset.workspaceId);
    if (!contents) throw new Error("浏览器实例尚未打开");
    this.#downloadManager.request(contents, asset);
  }

  closeAll(): void {
    for (const runtime of this.#runtimes.values()) runtime.window.close();
  }

  async open(workspaceId: string): Promise<void> {
    const existing = this.#runtimes.get(workspaceId);
    if (existing) {
      existing.window.show();
      existing.window.focus();
      return;
    }

    const workspace = this.#store.getWorkspace(workspaceId);
    this.#store.patchWorkspace(workspaceId, { status: "opening", lastError: undefined });
    const persistentSession = this.#sessionFor(workspace);
    await this.#applyProxyToSession(workspace, persistentSession);
    await persistentSession.clearHostResolverCache();
    await persistentSession.closeAllConnections();
    persistentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    persistentSession.setPermissionCheckHandler(() => false);

    const window = new BrowserWindow({
      width: 1520,
      height: 940,
      minWidth: 1120,
      minHeight: 700,
      backgroundColor: "#111412",
      show: false,
      title: `${workspace.name} · OrbitDesk`,
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window.removeMenu();

    const view = new WebContentsView({
      webPreferences: {
        session: persistentSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    window.contentView.addChildView(view);
    const runtime: WorkspaceRuntime = {
      window,
      view,
      bounds: { x: 233, y: 45, width: 1_140, height: 735 },
    };
    this.#runtimes.set(workspaceId, runtime);
    this.#downloadManager.register(persistentSession, view.webContents, workspaceId);
    this.#wireRuntime(workspace, runtime);

    await this.#loadShell(window, workspaceId);
    view.setBounds(runtime.bounds);
    try {
      if (workspace.siteId === "demo") {
        const demoPath = fileURLToPath(new URL("../../dist/demo-generator.html", import.meta.url));
        await view.webContents.loadFile(demoPath);
      } else {
        await view.webContents.loadURL(workspace.currentUrl ?? workspace.startUrl);
      }
    } catch (error) {
      this.#store.patchWorkspace(workspaceId, { status: "error", lastError: errorMessage(error) });
      this.#emit(workspaceId, "status", `页面加载失败：${errorMessage(error)}`);
    }
    window.show();
  }

  close(workspaceId: string): void {
    this.#runtimes.get(workspaceId)?.window.close();
  }

  async applyWorkspaceNetworkSettings(workspaceId: string): Promise<void> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const persistentSession = this.#sessionFor(workspace);
    await this.#applyProxyToSession(workspace, persistentSession);
    await persistentSession.clearHostResolverCache();
    await persistentSession.closeAllConnections();
    const runtime = this.#runtimes.get(workspaceId);
    if (runtime) {
      if (workspace.siteId === "demo") runtime.view.webContents.reload();
      else await runtime.view.webContents.loadURL(workspace.startUrl);
    }
  }

  async diagnoseNetwork(workspaceId: string): Promise<NetworkDiagnostics> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const persistentSession = this.#sessionFor(workspace);
    await this.#applyProxyToSession(workspace, persistentSession);
    const resolvedProxy = await persistentSession.resolveProxy(workspace.startUrl);
    const runtime = this.#runtimes.get(workspaceId);
    const currentUrl = runtime?.view.webContents.getURL();
    const regionRestricted = runtime
      ? await runtime.view.webContents.executeJavaScript(regionRestrictionScript, true).then(Boolean).catch(() => false)
      : false;
    let message = `当前 Chromium 路由：${resolvedProxy || "DIRECT"}`;
    if (regionRestricted) {
      message = `Dola 已返回区域限制。当前 Chromium 路由为 ${resolvedProxy || "DIRECT"}；请更换受支持地区的 VPN 节点后重新加载。`;
    } else if (workspace.proxy.mode === "system" && /^DIRECT$/i.test(resolvedProxy)) {
      message = "Electron 当前没有检测到 Windows 系统代理。如果 VPN 使用本机代理端口，请在实例设置中选择“固定代理”并填写 HTTP/SOCKS5 地址。";
    } else if (workspace.proxy.mode === "direct") {
      message = "该实例正在强制直连，会绕过 Windows 系统代理。若要使用 VPN，请切换为“跟随 Windows 系统/VPN”。";
    }
    return {
      workspaceId,
      configuredMode: workspace.proxy.mode,
      ...(workspace.proxy.server ? { configuredServer: workspace.proxy.server } : {}),
      resolvedProxy: resolvedProxy || "DIRECT",
      ...(currentUrl ? { currentUrl } : {}),
      regionRestricted,
      message,
      checkedAt: new Date().toISOString(),
    };
  }

  setBounds(workspaceId: string, bounds: BrowserBounds): void {
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime) return;
    const contentBounds = runtime.window.getContentBounds();
    const rectangle: Rectangle = {
      x: Math.max(0, Math.min(bounds.x, contentBounds.width - 120)),
      y: Math.max(0, Math.min(bounds.y, contentBounds.height - 120)),
      width: Math.max(120, Math.min(bounds.width, contentBounds.width - bounds.x)),
      height: Math.max(120, Math.min(bounds.height, contentBounds.height - bounds.y)),
    };
    runtime.bounds = rectangle;
    runtime.view.setBounds(rectangle);
  }

  command(workspaceId: string, command: BrowserCommand): void {
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime) throw new Error("浏览器实例尚未打开");
    const contents = runtime.view.webContents;
    if (command === "back" && contents.canGoBack()) contents.goBack();
    if (command === "forward" && contents.canGoForward()) contents.goForward();
    if (command === "reload") contents.reload();
    if (command === "home") void contents.loadURL(this.#store.getWorkspace(workspaceId).startUrl);
    if (command === "devtools") contents.openDevTools({ mode: "detach" });
  }

  async execute<T>(workspaceId: string, script: string): Promise<T> {
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime) throw new Error("浏览器实例尚未打开");
    const workspace = this.#store.getWorkspace(workspaceId);
    const currentUrl = runtime.view.webContents.getURL();
    const allowedPage = workspace.siteId === "demo" ? currentUrl.startsWith("file://") : isAllowedSiteUrl(adapterFor(workspace.siteId), currentUrl);
    if (!allowedPage) throw new Error("当前页面不是该实例允许的官方站点");
    return runtime.view.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  async selectThirtySeconds(workspaceId: string): Promise<PageActionResult> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime) throw new Error("浏览器实例尚未打开");
    const url = runtime.view.webContents.getURL();
    if (!(workspace.siteId === "demo" ? url.startsWith("file://") : isAllowedSiteUrl(adapterFor(workspace.siteId), url))) throw new Error("当前页面不属于实例允许的官方站点");
    const result = await this.execute<PageActionResult>(workspaceId, buildDurationSelectionScript(adapterFor(workspace.siteId)));
    this.#emit(workspaceId, "automation", result.message);
    return result;
  }

  async probe(workspaceId: string): Promise<AdapterProbe> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const runtime = this.#runtimes.get(workspaceId);
    if (!runtime) throw new Error("浏览器实例尚未打开");
    const currentUrl = runtime.view.webContents.getURL();
    if (!(workspace.siteId === "demo" ? currentUrl.startsWith("file://") : isAllowedSiteUrl(adapterFor(workspace.siteId), currentUrl))) throw new Error("当前页面不属于实例允许的官方站点");
    const observed = await this.execute<Omit<AdapterProbe, "workspaceId" | "checkedAt">>(workspaceId, buildProbeScript(adapterFor(workspace.siteId)));
    const result = { ...observed, workspaceId, checkedAt: new Date().toISOString() };
    this.#emit(workspaceId, "automation", result.thirtySecondsVisible ? "页面诊断：已发现可见 2.5 / 30s 控件" : "页面诊断：未确认可见 2.5 / 30s 控件");
    return result;
  }

  async exportCookies(workspaceId: string): Promise<PortableCookie[]> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const cookies = await this.#sessionFor(workspace).cookies.get({});
    return cookies
      .filter((cookie) => cookieBelongsToWorkspace(cookie, workspace))
      .map(({ name, value, domain, path, secure, httpOnly, expirationDate, sameSite }) => ({
        name, value, domain, path, secure, httpOnly, expirationDate, sameSite,
      }));
  }

  async importCookies(workspaceId: string, values: unknown[]): Promise<{ imported: number; skipped: number }> {
    const workspace = this.#store.getWorkspace(workspaceId);
    const targetSession = this.#sessionFor(workspace);
    let imported = 0;
    let skipped = 0;
    for (const value of values) {
      const cookie = portableCookie(value);
      if (!cookie || !cookieBelongsToWorkspace(cookie, workspace)) {
        skipped += 1;
        continue;
      }
      const hostname = (cookie.domain ?? new URL(workspace.startUrl).hostname).replace(/^\./, "");
      const url = `${cookie.secure === false ? "http" : "https"}://${hostname}${cookie.path || "/"}`;
      try {
        await targetSession.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(cookie.path ? { path: cookie.path } : {}),
          ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
          ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
          ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
          ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
        });
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    return { imported, skipped };
  }

  getWebContents(workspaceId: string) {
    return this.#runtimes.get(workspaceId)?.view.webContents;
  }

  #sessionFor(workspace: Workspace) {
    // Every instance gets a unique persistent partition. The profile is a label, not a shared cookie jar.
    return session.fromPartition(`persist:orbitdesk-workspace-${workspace.id}`, { cache: true });
  }

  async #applyProxyToSession(workspace: Workspace, persistentSession: Electron.Session): Promise<void> {
    if (workspace.proxy.mode === "fixed_servers" && workspace.proxy.server) {
      await persistentSession.setProxy({
        mode: "fixed_servers",
        proxyRules: workspace.proxy.server,
        proxyBypassRules: workspace.proxy.bypassRules || "<local>;localhost;127.0.0.1;[::1]",
      });
    } else if (workspace.proxy.mode === "direct") {
      await persistentSession.setProxy({ mode: "direct" });
    } else {
      await persistentSession.setProxy({ mode: "system" });
    }
  }

  async #loadShell(window: BrowserWindow, workspaceId: string): Promise<void> {
    await loadRenderer(window, this.#rendererUrl, { workspace: workspaceId });
  }

  #wireRuntime(workspace: Workspace, runtime: WorkspaceRuntime): void {
    const { window, view } = runtime;
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeWebNavigation(url)) void contents.loadURL(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const localDemo = workspace.siteId === "demo" && url.startsWith("file://");
      if (!localDemo && !isSafeWebNavigation(url)) {
        event.preventDefault();
        this.#emit(workspace.id, "status", "已阻止不安全的页面导航");
      }
    });
    contents.on("did-start-loading", () => {
      this.#store.patchWorkspace(workspace.id, { status: "opening" });
      this.#emit(workspace.id, "status", "正在加载官方网页");
    });
    contents.on("did-finish-load", () => {
      const currentUrl = contents.getURL();
      this.#store.patchWorkspace(workspace.id, {
        currentUrl,
        status: "ready",
        lastOpenedAt: new Date().toISOString(),
        lastError: undefined,
      });
      this.#emit(workspace.id, "url", currentUrl);
      this.#emit(workspace.id, "title", contents.getTitle());
      this.#emit(workspace.id, "status", "官方网页已就绪，请手动登录或开始任务");
      void this.#flagRegionRestriction(workspace, runtime);
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return;
      this.#store.patchWorkspace(workspace.id, { status: "error", lastError: errorDescription });
      this.#emit(workspace.id, "status", `网页错误：${errorDescription}`);
    });
    const publishNavigation = (url: string) => {
      this.#store.patchWorkspace(workspace.id, { currentUrl: url });
      this.#emit(workspace.id, "url", url);
    };
    contents.on("did-navigate", (_event, url) => publishNavigation(url));
    contents.on("did-navigate-in-page", (_event, url) => publishNavigation(url));
    contents.on("page-title-updated", (_event, title) => this.#emit(workspace.id, "title", title));
    window.on("resize", () => view.setBounds(runtime.bounds));
    window.on("closed", () => {
      this.#runtimes.delete(workspace.id);
      this.#store.patchWorkspace(workspace.id, { status: "offline" });
    });
  }

  async #flagRegionRestriction(workspace: Workspace, runtime: WorkspaceRuntime): Promise<void> {
    if (workspace.siteId !== "dola") return;
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (this.#runtimes.get(workspace.id) !== runtime || runtime.view.webContents.isDestroyed()) return;
    const restricted = await runtime.view.webContents.executeJavaScript(regionRestrictionScript, true).then(Boolean).catch(() => false);
    if (!restricted) return;
    const diagnostic = await this.diagnoseNetwork(workspace.id).catch(() => undefined);
    const message = diagnostic?.message ?? "Dola 返回区域限制；请检查实例代理和 VPN 出口地区";
    this.#store.patchWorkspace(workspace.id, { status: "needs_attention", lastError: message });
    this.#emit(workspace.id, "status", message);
  }

  #emit(workspaceId: string, type: WorkspaceEvent["type"], value: string): void {
    this.emit("workspace-event", { workspaceId, type, value, at: new Date().toISOString() } satisfies WorkspaceEvent);
  }
}

function cookieBelongsToWorkspace(cookie: Pick<Cookie, "domain"> | PortableCookie, workspace: Workspace): boolean {
  const adapter = adapterFor(workspace.siteId);
  const domain = (cookie.domain || new URL(workspace.startUrl).hostname).replace(/^\./, "").toLowerCase();
  return adapter.allowedHosts.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function portableCookie(value: unknown): PortableCookie | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name || typeof input.value !== "string") return undefined;
  const sameSite = ["unspecified", "no_restriction", "lax", "strict"].includes(String(input.sameSite))
    ? input.sameSite as PortableCookie["sameSite"]
    : undefined;
  return {
    name: input.name,
    value: input.value,
    ...(typeof input.domain === "string" ? { domain: input.domain } : {}),
    ...(typeof input.path === "string" ? { path: input.path } : {}),
    ...(typeof input.secure === "boolean" ? { secure: input.secure } : {}),
    ...(typeof input.httpOnly === "boolean" ? { httpOnly: input.httpOnly } : {}),
    ...(typeof input.expirationDate === "number" ? { expirationDate: input.expirationDate } : {}),
    ...(sameSite ? { sameSite } : {}),
  };
}

export async function loadRenderer(window: BrowserWindow, rendererEntry: string, query?: Record<string, string>): Promise<void> {
  if (/^https?:\/\//i.test(rendererEntry)) {
    const target = new URL(rendererEntry);
    for (const [key, value] of Object.entries(query ?? {})) target.searchParams.set(key, value);
    await window.loadURL(target.toString());
  } else {
    await window.loadFile(rendererEntry, query ? { query } : undefined);
  }
}

const regionRestrictionScript = `(() => {
  const text = String(document.body?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
  return location.pathname.includes("region-restricted")
    || text.includes("受区域限制")
    || text.includes("无法使用 dola")
    || text.includes("not available in your region")
    || text.includes("region restricted");
})()`;

function isSafeWebNavigation(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "about:";
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
