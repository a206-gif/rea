import { adapterFor } from "../adapters/site-adapters";
import { safeId } from "../domain/files";
import type {
  AppSettings,
  BrowserBounds,
  BrowserCommand,
  CreateTaskInput,
  CreateWorkspaceInput,
  GenerationTask,
  OrbitApi,
  StateSnapshot,
  WorkspaceEvent,
} from "../shared/contracts";

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

export function createDemoApi(): OrbitApi {
  let state: StateSnapshot = {
    profiles: [
      { id: "profile_primary", name: "网页预览档案", color: "#6f59e8", createdAt: iso(-10) },
    ],
    workspaces: [
      { id: "workspace_doubao", name: "豆包官方网站", siteId: "doubao", profileId: "profile_primary", startUrl: "https://www.doubao.com/", status: "offline", createdAt: iso(-8) },
      { id: "workspace_dola", name: "Dola 官方网站", siteId: "dola", profileId: "profile_primary", startUrl: "https://www.dola.com/chat/", status: "offline", createdAt: iso(-7) },
    ],
    tasks: [],
    assets: [],
    downloads: [],
    settings: {
      downloadDirectory: "仅 Windows 桌面版可用",
      maxConcurrentWorkspaces: 3,
      resultPollSeconds: 6,
      taskTimeoutMinutes: 45,
      openWorkspaceOnTask: true,
      notifyOnComplete: true,
      theme: "light",
    },
    adapters: (["doubao", "dola", "demo"] as const).map((siteId) => ({
      siteId,
      name: adapterFor(siteId).name,
      baseUrl: adapterFor(siteId).baseUrl,
      configured: siteId !== "demo",
      lastMessage: siteId === "demo"
        ? "本地沙箱仅供开发测试"
        : "点击浏览器实例将打开真实官方网页；网页预览不执行桌面自动化",
    })),
  };
  const stateListeners = new Set<(value: StateSnapshot) => void>();
  const workspaceListeners = new Set<(value: WorkspaceEvent) => void>();
  const publish = () => {
    const snapshot = structuredClone(state);
    for (const listener of stateListeners) listener(snapshot);
  };

  const api: OrbitApi = {
    async getState() { return structuredClone(state); },
    async createWorkspace(input: CreateWorkspaceInput) {
      const workspace = {
        id: safeId("workspace"), name: input.name, siteId: input.siteId, profileId: input.profileId,
        startUrl: input.startUrl || adapterFor(input.siteId).baseUrl, status: "offline" as const, createdAt: new Date().toISOString(),
      };
      state = { ...state, workspaces: [workspace, ...state.workspaces] };
      publish();
      return workspace;
    },
    async removeWorkspace(workspaceId: string) {
      state = { ...state, workspaces: state.workspaces.filter((item) => item.id !== workspaceId) };
      publish();
    },
    async openWorkspace(workspaceId: string) {
      const workspace = state.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) throw new Error("找不到浏览器实例");
      window.open(workspace.currentUrl ?? workspace.startUrl, "_blank", "noopener,noreferrer");
    },
    async createTasks(_input: CreateTaskInput): Promise<GenerationTask[]> {
      throw new Error("网页预览不执行虚拟任务。请安装 Windows 桌面版并在真实官方网页登录后使用。");
    },
    async pauseTask(taskId: string) { patchTask(taskId, { status: "paused", updatedAt: new Date().toISOString() }); },
    async resumeTask(taskId: string) { patchTask(taskId, { status: "queued", error: undefined, updatedAt: new Date().toISOString() }); },
    async cancelTask(taskId: string) { patchTask(taskId, { status: "cancelled", updatedAt: new Date().toISOString() }); },
    async retryTask(taskId: string) { patchTask(taskId, { status: "queued", progress: 0, error: undefined, updatedAt: new Date().toISOString() }); },
    async updateSettings(patch: Partial<AppSettings>) {
      state = { ...state, settings: { ...state.settings, ...patch } };
      publish();
      return state.settings;
    },
    async setBrowserBounds(_workspaceId: string, _bounds: BrowserBounds) {},
    async browserCommand(workspaceId: string, command: BrowserCommand) {
      const event: WorkspaceEvent = { workspaceId, type: "automation", value: `网页预览：${command}`, at: new Date().toISOString() };
      for (const listener of workspaceListeners) listener(event);
    },
    async selectThirtySeconds(_workspaceId: string) {
      throw new Error("网页预览不能操作第三方页面；请在 Windows 桌面版中使用网页内 30 秒功能");
    },
    async downloadAsset(_assetId: string) { throw new Error("网页预览没有虚拟下载"); },
    async revealDownload(_downloadId: string) { throw new Error("网页预览没有本机下载目录"); },
    onStateChanged(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    onWorkspaceEvent(callback) { workspaceListeners.add(callback); return () => workspaceListeners.delete(callback); },
  };

  function patchTask(taskId: string, patch: Partial<GenerationTask>) {
    state = { ...state, tasks: state.tasks.map((item) => item.id === taskId ? { ...item, ...patch } : item) };
    publish();
  }
  return api;
}
