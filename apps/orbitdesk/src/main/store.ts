import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { adapterFor } from "../adapters/site-adapters.js";
import { safeId } from "../domain/files.js";
import { transitionTask } from "../domain/tasks.js";
import type {
  AppSettings,
  CreateTaskInput,
  CreateWorkspaceInput,
  DetectedAsset,
  DownloadRecord,
  GenerationTask,
  Profile,
  StateSnapshot,
  TaskStatus,
  Workspace,
  WorkspaceRuntimeStatus,
} from "../shared/contracts.js";

export class StateStore {
  readonly #path: string;
  #state: StateSnapshot;
  #listeners = new Set<(snapshot: StateSnapshot) => void>();

  constructor(path: string, downloadDirectory: string) {
    this.#path = path;
    this.#state = this.#load(downloadDirectory);
    this.#state.workspaces = this.#state.workspaces.map((workspace) => ({
      ...workspace,
      startUrl:
        workspace.siteId === "dola" && workspace.startUrl === "https://www.dola.com/"
          ? adapterFor("dola").baseUrl
          : workspace.startUrl,
      status: "offline",
      lastError: undefined,
    }));
    this.#state.settings.downloadDirectory ||= downloadDirectory;
    this.#persist();
  }

  snapshot(): StateSnapshot {
    return structuredClone(this.#state);
  }

  subscribe(listener: (snapshot: StateSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const now = new Date().toISOString();
    const adapter = adapterFor(input.siteId);
    const workspace: Workspace = {
      id: safeId("workspace"),
      name: input.name,
      siteId: input.siteId,
      profileId: input.profileId,
      startUrl: input.startUrl ?? adapter.baseUrl,
      status: "offline",
      createdAt: now,
    };
    this.#state.workspaces.unshift(workspace);
    this.#commit();
    return structuredClone(workspace);
  }

  removeWorkspace(workspaceId: string): void {
    if (this.#state.tasks.some((task) => task.workspaceId === workspaceId && isTaskActive(task.status))) {
      throw new Error("该工作区仍有活动任务，请先暂停或取消任务");
    }
    const before = this.#state.workspaces.length;
    this.#state.workspaces = this.#state.workspaces.filter((item) => item.id !== workspaceId);
    if (before === this.#state.workspaces.length) throw new Error("找不到工作区");
    this.#commit();
  }

  createTasks(input: CreateTaskInput): GenerationTask[] {
    this.requireWorkspace(input.workspaceId);
    const created: GenerationTask[] = [];
    for (let index = 0; index < input.quantity; index += 1) {
      const now = new Date(Date.now() + index).toISOString();
      const task: GenerationTask = {
        id: safeId("task"),
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        kind: input.kind,
        durationSeconds: 30,
        autoDownload: input.autoDownload,
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
        resultAssetIds: [],
        attempt: 0,
      };
      this.#state.tasks.unshift(task);
      created.push(task);
    }
    this.#commit();
    return structuredClone(created);
  }

  updateTask(
    taskId: string,
    status: TaskStatus,
    patch: Partial<GenerationTask> = {},
  ): GenerationTask {
    const index = this.#state.tasks.findIndex((item) => item.id === taskId);
    if (index < 0) throw new Error("找不到任务");
    const current = this.#state.tasks[index];
    if (!current) throw new Error("找不到任务");
    const updated = transitionTask(current, status, patch);
    this.#state.tasks[index] = updated;
    this.#commit();
    return structuredClone(updated);
  }

  patchTask(taskId: string, patch: Partial<GenerationTask>): GenerationTask {
    const index = this.#state.tasks.findIndex((item) => item.id === taskId);
    const current = this.#state.tasks[index];
    if (index < 0 || !current) throw new Error("找不到任务");
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.#state.tasks[index] = updated;
    this.#commit();
    return structuredClone(updated);
  }

  setWorkspaceStatus(
    workspaceId: string,
    status: WorkspaceRuntimeStatus,
    patch: Partial<Workspace> = {},
  ): Workspace {
    const index = this.#state.workspaces.findIndex((item) => item.id === workspaceId);
    const current = this.#state.workspaces[index];
    if (index < 0 || !current) throw new Error("找不到工作区");
    const updated = { ...current, ...patch, status };
    this.#state.workspaces[index] = updated;
    this.#commit();
    return structuredClone(updated);
  }

  addAsset(asset: DetectedAsset): DetectedAsset {
    const existing = this.#state.assets.find(
      (item) => item.taskId === asset.taskId && item.url === asset.url,
    );
    if (existing) return structuredClone(existing);
    this.#state.assets.unshift(asset);
    const task = this.#state.tasks.find((item) => item.id === asset.taskId);
    if (task && !task.resultAssetIds.includes(asset.id)) task.resultAssetIds.push(asset.id);
    this.#commit();
    return structuredClone(asset);
  }

  addDownload(download: DownloadRecord): DownloadRecord {
    this.#state.downloads.unshift(download);
    this.#commit();
    return structuredClone(download);
  }

  patchDownload(downloadId: string, patch: Partial<DownloadRecord>): DownloadRecord {
    const index = this.#state.downloads.findIndex((item) => item.id === downloadId);
    const current = this.#state.downloads[index];
    if (index < 0 || !current) throw new Error("找不到下载记录");
    const updated = { ...current, ...patch };
    this.#state.downloads[index] = updated;
    this.#commit();
    return structuredClone(updated);
  }

  patchAsset(assetId: string, patch: Partial<DetectedAsset>): DetectedAsset {
    const index = this.#state.assets.findIndex((item) => item.id === assetId);
    const current = this.#state.assets[index];
    if (index < 0 || !current) throw new Error("找不到媒体结果");
    const updated = { ...current, ...patch };
    this.#state.assets[index] = updated;
    this.#commit();
    return structuredClone(updated);
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.#state.settings = {
      ...this.#state.settings,
      ...patch,
      maxConcurrentWorkspaces: clampInteger(
        patch.maxConcurrentWorkspaces ?? this.#state.settings.maxConcurrentWorkspaces,
        1,
        8,
      ),
      resultPollSeconds: clampInteger(
        patch.resultPollSeconds ?? this.#state.settings.resultPollSeconds,
        3,
        60,
      ),
      taskTimeoutMinutes: clampInteger(
        patch.taskTimeoutMinutes ?? this.#state.settings.taskTimeoutMinutes,
        5,
        180,
      ),
    };
    this.#commit();
    return structuredClone(this.#state.settings);
  }

  requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.#state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("找不到工作区");
    return structuredClone(workspace);
  }

  requireTask(taskId: string): GenerationTask {
    const task = this.#state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("找不到任务");
    return structuredClone(task);
  }

  requireAsset(assetId: string): DetectedAsset {
    const asset = this.#state.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("找不到媒体结果");
    return structuredClone(asset);
  }

  requireDownload(downloadId: string): DownloadRecord {
    const download = this.#state.downloads.find((item) => item.id === downloadId);
    if (!download) throw new Error("找不到下载记录");
    return structuredClone(download);
  }

  #commit(): void {
    this.#persist();
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  #persist(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.#path);
  }

  #load(downloadDirectory: string): StateSnapshot {
    if (existsSync(this.#path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<StateSnapshot>;
        if (
          Array.isArray(parsed.profiles) &&
          Array.isArray(parsed.workspaces) &&
          Array.isArray(parsed.tasks) &&
          Array.isArray(parsed.assets) &&
          Array.isArray(parsed.downloads) &&
          parsed.settings
        ) {
          return {
            profiles: parsed.profiles,
            workspaces: parsed.workspaces,
            tasks: parsed.tasks,
            assets: parsed.assets,
            downloads: parsed.downloads,
            settings: { ...defaultSettings(downloadDirectory), ...parsed.settings },
            adapters: Array.isArray(parsed.adapters) ? parsed.adapters : defaultAdapters(),
          };
        }
      } catch {
        // A malformed state file is not executed or partially trusted. Start clean.
      }
    }
    return defaultState(downloadDirectory);
  }
}

function defaultState(downloadDirectory: string): StateSnapshot {
  const now = new Date().toISOString();
  const profiles: Profile[] = [
    { id: "profile_primary", name: "主工作档案", color: "#6f59e8", createdAt: now },
    { id: "profile_secondary", name: "素材实验室", color: "#2d8f73", createdAt: now },
  ];
  const workspaces: Workspace[] = [
    {
      id: "workspace_doubao",
      name: "豆包视频工作台",
      siteId: "doubao",
      profileId: profiles[0]!.id,
      startUrl: adapterFor("doubao").baseUrl,
      status: "offline",
      createdAt: now,
    },
    {
      id: "workspace_dola",
      name: "Dola 创作窗口",
      siteId: "dola",
      profileId: profiles[1]!.id,
      startUrl: adapterFor("dola").baseUrl,
      status: "offline",
      createdAt: now,
    },
    {
      id: "workspace_demo",
      name: "自动化本地沙箱",
      siteId: "demo",
      profileId: profiles[1]!.id,
      startUrl: adapterFor("demo").baseUrl,
      status: "offline",
      createdAt: now,
    },
  ];
  return {
    profiles,
    workspaces,
    tasks: [],
    assets: [],
    downloads: [],
    settings: defaultSettings(downloadDirectory),
    adapters: defaultAdapters(),
  };
}

function defaultSettings(downloadDirectory: string): AppSettings {
  return {
    downloadDirectory,
    maxConcurrentWorkspaces: 3,
    resultPollSeconds: 6,
    taskTimeoutMinutes: 45,
    openWorkspaceOnTask: true,
    notifyOnComplete: true,
    theme: "light",
  };
}

function defaultAdapters() {
  return (["doubao", "dola", "demo"] as const).map((siteId) => {
    const adapter = adapterFor(siteId);
    return {
      siteId,
      name: adapter.name,
      baseUrl: adapter.baseUrl,
      configured: true,
      lastMessage:
        siteId === "demo" ? "本地演示适配器可用" : "启发式 UI 适配器；首次使用请在页面中人工确认控件",
    };
  });
}

function isTaskActive(status: TaskStatus): boolean {
  return !["completed", "failed", "cancelled", "paused", "needs_attention"].includes(status);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
