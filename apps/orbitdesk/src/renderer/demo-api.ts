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
  SaveStoryboardInput,
  StateSnapshot,
  UpdateWorkspaceInput,
  WorkspaceEvent,
} from "../shared/contracts";

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

export function createDemoApi(): OrbitApi {
  let state: StateSnapshot = {
    profiles: [{ id: "profile_primary", name: "网页预览档案", color: "#6f59e8", createdAt: iso(-10) }],
    workspaces: [
      { id: "workspace_doubao", name: "豆包官方网站", siteId: "doubao", profileId: "profile_primary", startUrl: "https://www.doubao.com/", status: "offline", group: "内容组", order: 0, proxy: { mode: "direct" }, createdAt: iso(-8) },
      { id: "workspace_dola", name: "Dola 30s 工作台", siteId: "dola", profileId: "profile_primary", startUrl: "https://www.dola.com/chat/", status: "offline", group: "内容组", order: 1, proxy: { mode: "direct" }, createdAt: iso(-7) },
    ],
    tasks: [], assets: [], libraryAssets: [], storyboards: [], downloads: [],
    settings: {
      downloadDirectory: "仅 Windows 桌面版可用", maxConcurrentWorkspaces: 3, resultPollSeconds: 6,
      taskTimeoutMinutes: 45, openWorkspaceOnTask: true, notifyOnComplete: true, theme: "light",
      automationApiEnabled: false, automationApiPort: 17_824, automationApiToken: "preview-token-hidden",
    },
    adapters: (["doubao", "dola", "demo"] as const).map((siteId) => ({
      siteId, name: adapterFor(siteId).name, baseUrl: adapterFor(siteId).baseUrl, configured: siteId !== "demo",
      lastMessage: siteId === "demo" ? "本地沙箱仅供开发测试" : "点击实例打开真实官网；网页预览不执行桌面自动化",
    })),
  };
  const stateListeners = new Set<(value: StateSnapshot) => void>();
  const workspaceListeners = new Set<(value: WorkspaceEvent) => void>();
  const publish = () => { const snapshot = structuredClone(state); for (const listener of stateListeners) listener(snapshot); };
  const desktopOnly = (): never => { throw new Error("此功能需要 Windows 桌面版"); };

  const api: OrbitApi = {
    async getState() { return structuredClone(state); },
    async createWorkspace(input: CreateWorkspaceInput) {
      const workspace = {
        id: safeId("workspace"), name: input.name, siteId: input.siteId, profileId: input.profileId,
        startUrl: input.startUrl || adapterFor(input.siteId).baseUrl, status: "offline" as const,
        group: input.group || "默认分组", order: state.workspaces.length, proxy: input.proxy || { mode: "direct" as const }, createdAt: new Date().toISOString(),
      };
      state = { ...state, workspaces: [...state.workspaces, workspace] }; publish(); return workspace;
    },
    async updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput) {
      state = { ...state, workspaces: state.workspaces.map((item) => item.id === workspaceId ? { ...item, ...input } : item) };
      publish();
      const workspace = state.workspaces.find((item) => item.id === workspaceId); if (!workspace) throw new Error("找不到实例"); return workspace;
    },
    async moveWorkspace() {},
    async removeWorkspace(workspaceId: string) { state = { ...state, workspaces: state.workspaces.filter((item) => item.id !== workspaceId) }; publish(); },
    async openWorkspace(workspaceId: string) { const workspace = state.workspaces.find((item) => item.id === workspaceId); if (!workspace) throw new Error("找不到浏览器实例"); window.open(workspace.currentUrl ?? workspace.startUrl, "_blank", "noopener,noreferrer"); },
    async createTasks(_input: CreateTaskInput): Promise<GenerationTask[]> { return desktopOnly(); },
    async moveTask() {},
    async pauseTask(taskId: string) { patchTask(taskId, { status: "paused" }); },
    async resumeTask(taskId: string) { patchTask(taskId, { status: "queued", error: undefined }); },
    async cancelTask(taskId: string) { patchTask(taskId, { status: "cancelled" }); },
    async retryTask(taskId: string) { patchTask(taskId, { status: "queued", progress: 0, error: undefined }); },
    async saveStoryboard(input: SaveStoryboardInput) {
      const existing = input.id ? state.storyboards.find((item) => item.id === input.id) : undefined;
      const timestamp = new Date().toISOString();
      const board = { id: existing?.id ?? safeId("storyboard"), name: input.name, workspaceId: input.workspaceId, shots: input.shots.map((shot, order) => ({ id: shot.id ?? safeId("shot"), order, prompt: shot.prompt, kind: shot.kind, aspectRatio: shot.aspectRatio })), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      state = { ...state, storyboards: existing ? state.storyboards.map((item) => item.id === board.id ? board : item) : [board, ...state.storyboards] }; publish(); return board;
    },
    async deleteStoryboard(id: string) { state = { ...state, storyboards: state.storyboards.filter((item) => item.id !== id) }; publish(); },
    async queueStoryboard(): Promise<GenerationTask[]> { return desktopOnly(); },
    async updateSettings(patch: Partial<AppSettings>) { state = { ...state, settings: { ...state.settings, ...patch } }; publish(); return state.settings; },
    async rotateAutomationApiToken() { const token = `preview-${Date.now()}`; state = { ...state, settings: { ...state.settings, automationApiToken: token } }; publish(); return token; },
    async setBrowserBounds(_workspaceId: string, _bounds: BrowserBounds) {},
    async browserCommand(workspaceId: string, command: BrowserCommand) { const event: WorkspaceEvent = { workspaceId, type: "automation", value: `网页预览：${command}`, at: new Date().toISOString() }; for (const listener of workspaceListeners) listener(event); },
    async selectThirtySeconds() { return desktopOnly(); },
    async probeWorkspace() { return desktopOnly(); },
    async exportWorkspaceCookies() { return desktopOnly(); }, async importWorkspaceCookies() { return desktopOnly(); },
    async importLibraryAssets() { return desktopOnly(); }, async removeLibraryAsset() { return desktopOnly(); }, async revealLibraryAsset() { return desktopOnly(); },
    async downloadAsset() { return desktopOnly(); }, async revealDownload() { return desktopOnly(); },
    onStateChanged(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    onWorkspaceEvent(callback) { workspaceListeners.add(callback); return () => workspaceListeners.delete(callback); },
  };
  function patchTask(taskId: string, patch: Partial<GenerationTask>) { state = { ...state, tasks: state.tasks.map((item) => item.id === taskId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) }; publish(); }
  return api;
}
