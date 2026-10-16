import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
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
  LibraryAsset,
  LoginProfile,
  MoveDirection,
  SaveStoryboardInput,
  StateSnapshot,
  Storyboard,
  TaskStatus,
  UpdateWorkspaceInput,
  Workspace,
} from "../shared/contracts.js";

const activeTaskStatuses = new Set<TaskStatus>(["queued", "preparing", "submitting", "awaiting_result", "downloading"]);

export class StateStore extends EventEmitter {
  readonly #filePath: string;
  #state: StateSnapshot;

  constructor(filePath: string, downloadDirectory: string) {
    super();
    this.#filePath = filePath;
    this.#state = this.#readState(downloadDirectory);
    this.#persist();
  }

  snapshot(): StateSnapshot {
    return structuredClone(this.#state);
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.#state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("找不到浏览器实例");
    return structuredClone(workspace);
  }

  requireWorkspace(workspaceId: string): Workspace {
    return this.getWorkspace(workspaceId);
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: safeId("workspace"),
      name: input.name,
      siteId: input.siteId,
      profileId: input.profileId,
      startUrl: input.startUrl ?? adapterFor(input.siteId).baseUrl,
      status: "offline",
      group: input.group?.trim() || "默认分组",
      order: nextOrder(this.#state.workspaces),
      proxy: input.proxy ?? { mode: "direct" },
      createdAt: now,
    };
    this.#state.workspaces.push(workspace);
    this.#commit();
    return structuredClone(workspace);
  }

  updateWorkspace(workspaceId: string, patch: UpdateWorkspaceInput): Workspace {
    let updated: Workspace | undefined;
    this.#state.workspaces = this.#state.workspaces.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      updated = { ...workspace, ...patch };
      return updated;
    });
    if (!updated) throw new Error("找不到浏览器实例");
    this.#commit();
    return structuredClone(updated);
  }

  moveWorkspace(workspaceId: string, direction: MoveDirection): void {
    this.#moveOrdered(this.#state.workspaces, workspaceId, direction);
  }

  removeWorkspace(workspaceId: string): void {
    if (!this.#state.workspaces.some((item) => item.id === workspaceId)) throw new Error("找不到浏览器实例");
    const hasRunningTasks = this.#state.tasks.some(
      (task) => task.workspaceId === workspaceId && activeTaskStatuses.has(task.status),
    );
    if (hasRunningTasks) throw new Error("该实例仍有活动任务，请先取消任务");
    this.#state.workspaces = this.#state.workspaces.filter((item) => item.id !== workspaceId);
    this.#state.tasks = this.#state.tasks.filter((item) => item.workspaceId !== workspaceId);
    this.#state.assets = this.#state.assets.filter((item) => item.workspaceId !== workspaceId);
    this.#state.storyboards = this.#state.storyboards.filter((item) => item.workspaceId !== workspaceId);
    this.#normalizeOrder(this.#state.workspaces);
    this.#commit();
  }

  patchWorkspace(workspaceId: string, patch: Partial<Workspace>): void {
    this.#state.workspaces = this.#state.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, ...patch } : workspace,
    );
    this.#commit();
  }

  createTasks(input: CreateTaskInput): GenerationTask[] {
    const now = new Date().toISOString();
    const workspace = this.getWorkspace(input.workspaceId);
    let order = nextOrder(this.#state.tasks);
    const created = Array.from({ length: input.quantity }, () => ({
      id: safeId("task"),
      workspaceId: input.workspaceId,
      prompt: input.prompt,
      kind: input.kind,
      durationSeconds: 30 as const,
      model: workspace.siteId === "dola" ? "2.5" as const : "page-default" as const,
      aspectRatio: input.aspectRatio ?? "16:9" as const,
      autoDownload: input.autoDownload,
      status: "queued" as const,
      progress: 0,
      queueOrder: order++,
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
      attempt: 0,
      ...(input.storyboardId ? { storyboardId: input.storyboardId } : {}),
      ...(input.shotId ? { shotId: input.shotId } : {}),
    }));
    this.#state.tasks.push(...created);
    this.#commit();
    return structuredClone(created);
  }

  moveTask(taskId: string, direction: MoveDirection): void {
    const task = this.#state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("找不到任务");
    const movableStatuses: TaskStatus[] = ["queued", "paused", "needs_attention", "failed"];
    if (!movableStatuses.includes(task.status)) throw new Error("执行中的任务不能调整顺序");
    const ordered = this.#state.tasks.filter((item) => movableStatuses.includes(item.status)).sort((a, b) => a.queueOrder - b.queueOrder);
    const index = ordered.findIndex((item) => item.id === taskId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const other = ordered[target]!;
    [task.queueOrder, other.queueOrder] = [other.queueOrder, task.queueOrder];
    this.#commit();
  }

  getTask(taskId: string): GenerationTask {
    const task = this.#state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("找不到任务");
    return structuredClone(task);
  }

  requireTask(taskId: string): GenerationTask {
    return this.getTask(taskId);
  }

  updateTask(taskId: string, status: TaskStatus, patch: Partial<GenerationTask> = {}): GenerationTask {
    return this.transitionTask(taskId, status, patch);
  }

  setWorkspaceStatus(workspaceId: string, status: Workspace["status"], patch: Partial<Workspace> = {}): void {
    this.patchWorkspace(workspaceId, { ...patch, status });
  }

  transitionTask(taskId: string, status: TaskStatus, patch: Partial<GenerationTask> = {}): GenerationTask {
    const current = this.#state.tasks.find((task) => task.id === taskId);
    if (!current) throw new Error("找不到任务");
    const next = transitionTask(current, status, patch);
    this.#state.tasks = this.#state.tasks.map((task) => (task.id === taskId ? next : task));
    this.#commit();
    return structuredClone(next);
  }

  patchTask(taskId: string, patch: Partial<GenerationTask>): void {
    this.#state.tasks = this.#state.tasks.map((task) =>
      task.id === taskId ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task,
    );
    this.#commit();
  }

  saveStoryboard(input: SaveStoryboardInput): Storyboard {
    const now = new Date().toISOString();
    const existing = input.id ? this.#state.storyboards.find((item) => item.id === input.id) : undefined;
    const storyboard: Storyboard = {
      id: existing?.id ?? safeId("storyboard"),
      name: input.name,
      workspaceId: input.workspaceId,
      shots: input.shots.map((shot, index) => ({
        id: shot.id ?? safeId("shot"),
        order: index,
        prompt: shot.prompt,
        kind: shot.kind,
        aspectRatio: shot.aspectRatio,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      this.#state.storyboards = this.#state.storyboards.map((item) => item.id === storyboard.id ? storyboard : item);
    } else {
      this.#state.storyboards.unshift(storyboard);
    }
    this.#commit();
    return structuredClone(storyboard);
  }

  deleteStoryboard(storyboardId: string): void {
    this.#state.storyboards = this.#state.storyboards.filter((item) => item.id !== storyboardId);
    this.#commit();
  }

  addAsset(asset: DetectedAsset): DetectedAsset {
    const existing = this.#state.assets.find((item) => item.url === asset.url && item.workspaceId === asset.workspaceId);
    if (existing) return structuredClone(existing);
    this.#state.assets.unshift(asset);
    this.#state.assets = this.#state.assets.slice(0, 1_000);
    this.#commit();
    return structuredClone(asset);
  }

  patchAsset(assetId: string, patch: Partial<DetectedAsset>): void {
    this.#state.assets = this.#state.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset);
    this.#commit();
  }

  addLibraryAssets(assets: LibraryAsset[]): void {
    this.#state.libraryAssets.unshift(...assets);
    this.#state.libraryAssets = this.#state.libraryAssets.slice(0, 2_000);
    this.#commit();
  }

  removeLibraryAsset(assetId: string): void {
    this.#state.libraryAssets = this.#state.libraryAssets.filter((asset) => asset.id !== assetId);
    this.#commit();
  }

  addDownload(download: DownloadRecord): void {
    this.#state.downloads.unshift(download);
    this.#state.downloads = this.#state.downloads.slice(0, 1_000);
    this.#commit();
  }

  patchDownload(downloadId: string, patch: Partial<DownloadRecord>): void {
    this.#state.downloads = this.#state.downloads.map((download) =>
      download.id === downloadId ? { ...download, ...patch } : download,
    );
    this.#commit();
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.#state.settings = { ...this.#state.settings, ...patch };
    this.#commit();
    return structuredClone(this.#state.settings);
  }

  rotateAutomationApiToken(): string {
    const token = randomBytes(32).toString("base64url");
    this.#state.settings.automationApiToken = token;
    this.#commit();
    return token;
  }

  #moveOrdered<T extends { id: string }>(items: T[], id: string, direction: MoveDirection, field: "order" | "queueOrder" = "order"): void {
    const ordered = [...items].sort((left, right) => Number(left[field as keyof T]) - Number(right[field as keyof T]));
    const index = ordered.findIndex((item) => item.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    ordered.forEach((item, itemIndex) => Object.assign(item, { [field]: itemIndex }));
    this.#commit();
  }

  #normalizeOrder<T extends { order: number }>(items: T[]): void {
    items.sort((left, right) => left.order - right.order).forEach((item, index) => { item.order = index; });
  }

  #readState(downloadDirectory: string): StateSnapshot {
    const fallback = createDefaultState(downloadDirectory);
    try {
      const raw = JSON.parse(readFileSync(this.#filePath, "utf8")) as Partial<StateSnapshot>;
      const settings = { ...fallback.settings, ...(raw.settings ?? {}) };
      if (!settings.automationApiToken || settings.automationApiToken.length < 32) {
        settings.automationApiToken = randomBytes(32).toString("base64url");
      }
      return {
        profiles: raw.profiles?.length ? raw.profiles : fallback.profiles,
        workspaces: (raw.workspaces ?? fallback.workspaces).map((workspace, index) => ({
          ...workspace,
          status: "offline",
          lastError: undefined,
          group: workspace.group || "默认分组",
          order: Number.isInteger(workspace.order) ? workspace.order : index,
          proxy: workspace.proxy ?? { mode: "direct" },
        })),
        tasks: (raw.tasks ?? []).map((task, index) => ({
          ...task,
          ...(activeTaskStatuses.has(task.status) && task.status !== "queued" ? { status: "needs_attention" as const, error: "OrbitDesk 上次退出时任务仍在执行；请检查官方网页状态后再决定是否重试" } : {}),
          model: task.model === "page-default" ? "page-default" : (raw.workspaces ?? fallback.workspaces).find((workspace) => workspace.id === task.workspaceId)?.siteId === "dola" ? "2.5" : "page-default",
          aspectRatio: task.aspectRatio ?? "16:9",
          queueOrder: Number.isInteger(task.queueOrder) ? task.queueOrder : index,
        })),
        assets: raw.assets ?? [],
        libraryAssets: raw.libraryAssets ?? [],
        storyboards: raw.storyboards ?? [],
        downloads: raw.downloads ?? [],
        settings,
        adapters: fallback.adapters,
      };
    } catch {
      return fallback;
    }
  }

  #commit(): void {
    this.#persist();
    this.emit("changed", this.snapshot());
  }

  #persist(): void {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.#state, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#filePath);
  }
}

function nextOrder(items: Array<{ order?: number; queueOrder?: number }>): number {
  return items.reduce((maximum, item) => Math.max(maximum, item.order ?? item.queueOrder ?? -1), -1) + 1;
}

function createDefaultState(downloadDirectory: string): StateSnapshot {
  const now = new Date().toISOString();
  const profile: LoginProfile = {
    id: safeId("profile"),
    name: "主工作档案",
    color: "#6f59e8",
    createdAt: now,
  };
  return {
    profiles: [profile],
    workspaces: [
      {
        id: safeId("workspace"),
        name: "豆包创作窗口",
        siteId: "doubao",
        profileId: profile.id,
        startUrl: adapterFor("doubao").baseUrl,
        status: "offline",
        group: "默认分组",
        order: 0,
        proxy: { mode: "direct" },
        createdAt: now,
      },
      {
        id: safeId("workspace"),
        name: "Dola 30s 视频窗口",
        siteId: "dola",
        profileId: profile.id,
        startUrl: adapterFor("dola").baseUrl,
        status: "offline",
        group: "默认分组",
        order: 1,
        proxy: { mode: "direct" },
        createdAt: now,
      },
    ],
    tasks: [],
    assets: [],
    libraryAssets: [],
    storyboards: [],
    downloads: [],
    settings: {
      downloadDirectory,
      maxConcurrentWorkspaces: 3,
      resultPollSeconds: 6,
      taskTimeoutMinutes: 45,
      openWorkspaceOnTask: true,
      notifyOnComplete: true,
      theme: "light",
      automationApiEnabled: false,
      automationApiPort: 17_824,
      automationApiToken: randomBytes(32).toString("base64url"),
    },
    adapters: (["doubao", "dola", "demo"] as const).map((siteId) => ({
      siteId,
      name: adapterFor(siteId).name,
      baseUrl: adapterFor(siteId).baseUrl,
      configured: true,
      lastMessage: siteId === "demo"
        ? "本地适配器仅供自动化回归测试"
        : "仅操作官方网页的可见控件；不使用隐藏接口或修改权限响应",
    })),
  };
}
