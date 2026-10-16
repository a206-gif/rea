import { adapterFor } from "../adapters/site-adapters.js";
import { safeId } from "../domain/files.js";
import { runnableTasks } from "../domain/tasks.js";
import type {
  DetectedAsset,
  GenerationTask,
  Workspace,
} from "../shared/contracts.js";
import { buildDetectionScript, buildSubmitScript } from "./page-scripts.js";
import type { StateStore } from "./store.js";

export interface AutomationWorkspacePort {
  ensureOpen(workspace: Workspace): Promise<void>;
  waitUntilReady(workspaceId: string, timeoutMs: number): Promise<void>;
  evaluate<T>(workspaceId: string, script: string): Promise<T>;
  requestDownload(asset: DetectedAsset): Promise<void>;
}

export class AutomationEngine {
  readonly #store: StateStore;
  readonly #workspacePort: AutomationWorkspacePort;
  readonly #active = new Map<string, Promise<void>>();
  #timer?: NodeJS.Timeout;
  #ticking = false;

  constructor(store: StateStore, workspacePort: AutomationWorkspacePort) {
    this.#store = store;
    this.#workspacePort = workspacePort;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), 1_000);
    this.#timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const state = this.#store.snapshot();
      const maximum = state.settings.maxConcurrentWorkspaces;
      if (this.#active.size >= maximum) return;
      const activeWorkspaces = new Set(this.#active.keys());
      for (const task of runnableTasks(state.tasks)) {
        if (this.#active.size >= maximum) break;
        if (activeWorkspaces.has(task.workspaceId)) continue;
        activeWorkspaces.add(task.workspaceId);
        const promise = this.#runTask(task)
          .catch((error: unknown) => this.#failTask(task.id, error))
          .finally(() => {
            this.#active.delete(task.workspaceId);
            void this.tick();
          });
        this.#active.set(task.workspaceId, promise);
      }
    } finally {
      this.#ticking = false;
    }
  }

  async #runTask(initialTask: GenerationTask): Promise<void> {
    let task = this.#store.requireTask(initialTask.id);
    const workspace = this.#store.requireWorkspace(task.workspaceId);
    const adapter = adapterFor(workspace.siteId);
    this.#store.updateTask(task.id, "preparing", {
      attempt: task.attempt + 1,
      error: undefined,
    });
    this.#store.setWorkspaceStatus(workspace.id, "opening", { lastError: undefined });

    await this.#workspacePort.ensureOpen(workspace);
    await this.#workspacePort.waitUntilReady(workspace.id, 120_000);
    this.#store.setWorkspaceStatus(workspace.id, "working");

    const baseline = await this.#workspacePort.evaluate<{
      blocked?: string;
      assets: Array<{ url: string }>;
    }>(workspace.id, buildDetectionScript(adapter));
    if (baseline.blocked) {
      this.#needsAttention(task.id, workspace.id, `页面要求人工处理：${baseline.blocked}`);
      return;
    }
    const previousUrls = new Set(baseline.assets.map((asset) => asset.url));

    task = this.#store.updateTask(task.id, "submitting");
    const submission = await this.#workspacePort.evaluate<{
      ok: boolean;
      stage: string;
      message: string;
    }>(workspace.id, buildSubmitScript(adapter, task));
    if (!submission.ok) {
      if (submission.stage === "blocked") {
        this.#needsAttention(task.id, workspace.id, submission.message);
      } else {
        this.#store.updateTask(task.id, "failed", { error: submission.message });
        this.#store.setWorkspaceStatus(workspace.id, "error", { lastError: submission.message });
      }
      return;
    }

    this.#store.updateTask(task.id, "awaiting_result");
    const settings = this.#store.snapshot().settings;
    const deadline = Date.now() + settings.taskTimeoutMinutes * 60_000;
    let observations = 0;
    while (Date.now() < deadline) {
      await delay(settings.resultPollSeconds * 1_000);
      const latest = this.#store.requireTask(task.id);
      if (["cancelled", "paused"].includes(latest.status)) return;
      const detection = await this.#workspacePort.evaluate<{
        blocked?: string;
        assets: Array<{
          url: string;
          kind: "video" | "image";
          width?: number;
          height?: number;
          durationSeconds?: number;
        }>;
      }>(workspace.id, buildDetectionScript(adapter));
      if (detection.blocked) {
        this.#needsAttention(task.id, workspace.id, `页面要求人工处理：${detection.blocked}`);
        return;
      }
      observations += 1;
      const elapsedRatio = 1 - Math.max(0, deadline - Date.now()) / (settings.taskTimeoutMinutes * 60_000);
      this.#store.patchTask(task.id, {
        progress: Math.min(84, Math.max(42, Math.round(42 + elapsedRatio * 42))),
      });
      const newAssets = detection.assets.filter(
        (asset) => asset.kind === task.kind && !previousUrls.has(asset.url),
      );
      if (newAssets.length === 0) continue;

      const retained: DetectedAsset[] = newAssets.map((observation) =>
        this.#store.addAsset({
          id: safeId("asset"),
          taskId: task.id,
          workspaceId: workspace.id,
          kind: observation.kind,
          url: observation.url,
          width: observation.width,
          height: observation.height,
          durationSeconds: observation.durationSeconds,
          detectedAt: new Date().toISOString(),
        }),
      );

      if (task.autoDownload) {
        this.#store.updateTask(task.id, "downloading");
        for (const asset of retained) await this.#workspacePort.requestDownload(asset);
      }
      this.#store.updateTask(task.id, "completed", {
        resultAssetIds: retained.map((asset) => asset.id),
      });
      this.#store.setWorkspaceStatus(workspace.id, "ready");
      return;
    }

    this.#store.updateTask(task.id, "failed", {
      error: `等待结果超时；已轮询 ${observations} 次。页面任务可能仍在运行。`,
    });
    this.#store.setWorkspaceStatus(workspace.id, "error", {
      lastError: "等待生成结果超时",
    });
  }

  #needsAttention(taskId: string, workspaceId: string, message: string): void {
    this.#store.updateTask(taskId, "needs_attention", { error: message });
    this.#store.setWorkspaceStatus(workspaceId, "needs_attention", { lastError: message });
  }

  #failTask(taskId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const task = this.#store.requireTask(taskId);
    if (["cancelled", "paused", "completed", "failed", "needs_attention"].includes(task.status)) return;
    try {
      this.#store.updateTask(taskId, "failed", { error: message });
      this.#store.setWorkspaceStatus(task.workspaceId, "error", { lastError: message });
    } catch {
      // A concurrent user action owns the final state.
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
