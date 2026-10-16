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
      { id: "profile_primary", name: "主工作档案", color: "#6f59e8", createdAt: iso(-900) },
      { id: "profile_secondary", name: "素材实验室", color: "#2d8f73", createdAt: iso(-800) },
      { id: "profile_campaign", name: "品牌短片", color: "#e86743", createdAt: iso(-700) },
    ],
    workspaces: [
      { id: "workspace_doubao", name: "豆包视频工作台", siteId: "doubao", profileId: "profile_primary", startUrl: "https://www.doubao.com/", currentUrl: "https://www.doubao.com/", status: "working", createdAt: iso(-600), lastOpenedAt: iso(-5) },
      { id: "workspace_dola", name: "Dola 创作窗口", siteId: "dola", profileId: "profile_secondary", startUrl: "https://www.dola.com/", currentUrl: "https://www.dola.com/", status: "ready", createdAt: iso(-580), lastOpenedAt: iso(-18) },
      { id: "workspace_campaign", name: "秋季产品短片", siteId: "doubao", profileId: "profile_campaign", startUrl: "https://www.doubao.com/", status: "offline", createdAt: iso(-320), lastOpenedAt: iso(-120) },
    ],
    tasks: [
      { id: "task_running", workspaceId: "workspace_doubao", prompt: "清晨薄雾中的未来城市，镜头沿着河面缓慢推进，电影级光影", kind: "video", durationSeconds: 30, autoDownload: true, status: "awaiting_result", progress: 68, createdAt: iso(-12), updatedAt: iso(-1), startedAt: iso(-11), resultAssetIds: [], attempt: 1 },
      { id: "task_queue", workspaceId: "workspace_dola", prompt: "极简陶瓷香氛产品，暖灰背景，柔和侧光，商业摄影", kind: "image", durationSeconds: 30, autoDownload: true, status: "queued", progress: 0, createdAt: iso(-7), updatedAt: iso(-7), resultAssetIds: [], attempt: 0 },
      { id: "task_done", workspaceId: "workspace_campaign", prompt: "橙色跑鞋在雨夜街道上落地，水花飞溅，快速跟拍", kind: "video", durationSeconds: 30, autoDownload: true, status: "completed", progress: 100, createdAt: iso(-80), updatedAt: iso(-42), startedAt: iso(-78), completedAt: iso(-42), resultAssetIds: ["asset_demo"], attempt: 1 },
      { id: "task_attention", workspaceId: "workspace_dola", prompt: "森林中的玻璃屋，午后阳光穿过树叶", kind: "video", durationSeconds: 30, autoDownload: true, status: "needs_attention", progress: 18, createdAt: iso(-145), updatedAt: iso(-140), error: "页面要求人工确认登录状态", resultAssetIds: [], attempt: 1 },
    ],
    assets: [
      { id: "asset_demo", taskId: "task_done", workspaceId: "workspace_campaign", kind: "video", url: "https://example.invalid/result.mp4", width: 1920, height: 1080, durationSeconds: 30, detectedAt: iso(-42), downloadId: "download_video" },
    ],
    downloads: [
      { id: "download_video", workspaceId: "workspace_campaign", taskId: "task_done", assetId: "asset_demo", sourceUrl: "https://example.invalid/result.mp4", filename: "秋季产品短片-001.mp4", savePath: "C:\\Users\\You\\Downloads\\OrbitDesk\\秋季产品短片-001.mp4", status: "completed", receivedBytes: 48_600_000, totalBytes: 48_600_000, createdAt: iso(-42), completedAt: iso(-40) },
      { id: "download_image", workspaceId: "workspace_dola", sourceUrl: "https://example.invalid/result.png", filename: "陶瓷香氛-hero.png", savePath: "C:\\Users\\You\\Downloads\\OrbitDesk\\陶瓷香氛-hero.png", status: "completed", receivedBytes: 4_820_000, totalBytes: 4_820_000, createdAt: iso(-220), completedAt: iso(-219) },
    ],
    settings: {
      downloadDirectory: "C:\\Users\\You\\Downloads\\OrbitDesk",
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
      configured: true,
      lastCheckedAt: iso(-4),
      lastMessage: siteId === "demo" ? "本地沙箱正常" : "启发式选择器已加载，等待真实页面校准",
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
      state = { ...state, workspaces: state.workspaces.map((item) => item.id === workspaceId ? { ...item, status: "ready" as const, lastOpenedAt: new Date().toISOString() } : item) };
      publish();
      const event: WorkspaceEvent = { workspaceId, type: "status", value: "网页预览模式：模拟窗口已就绪", at: new Date().toISOString() };
      for (const listener of workspaceListeners) listener(event);
    },
    async createTasks(input: CreateTaskInput) {
      const tasks: GenerationTask[] = Array.from({ length: input.quantity }, (_, index) => {
        const createdAt = new Date(Date.now() + index).toISOString();
        return { id: safeId("task"), workspaceId: input.workspaceId, prompt: input.prompt, kind: input.kind, durationSeconds: 30, autoDownload: input.autoDownload, status: "queued", progress: 0, createdAt, updatedAt: createdAt, resultAssetIds: [], attempt: 0 };
      });
      state = { ...state, tasks: [...tasks, ...state.tasks] };
      publish();
      window.setTimeout(() => {
        state = { ...state, tasks: state.tasks.map((item) => item.id === tasks[0]?.id ? { ...item, status: "preparing" as const, progress: 8 } : item) };
        publish();
      }, 1200);
      return tasks;
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
      const event: WorkspaceEvent = { workspaceId, type: "automation", value: `网页演示：${command}`, at: new Date().toISOString() };
      for (const listener of workspaceListeners) listener(event);
    },
    async downloadAsset(_assetId: string) {},
    async revealDownload(_downloadId: string) {},
    onStateChanged(callback) { stateListeners.add(callback); return () => stateListeners.delete(callback); },
    onWorkspaceEvent(callback) { workspaceListeners.add(callback); return () => workspaceListeners.delete(callback); },
  };

  function patchTask(taskId: string, patch: Partial<GenerationTask>) {
    state = { ...state, tasks: state.tasks.map((item) => item.id === taskId ? { ...item, ...patch } : item) };
    publish();
  }
  return api;
}
