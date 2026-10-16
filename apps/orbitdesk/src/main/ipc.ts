import { BrowserWindow, ipcMain, shell } from "electron";
import { adapterFor } from "../adapters/site-adapters.js";
import { transitionTask } from "../domain/tasks.js";
import { validateBounds, validateTaskInput, validateWorkspaceInput } from "../domain/validation.js";
import type { AppSettings, BrowserCommand, StateSnapshot } from "../shared/contracts.js";
import type { AutomationEngine } from "./automation-engine.js";
import type { StateStore } from "./store.js";
import type { WorkspaceManager } from "./workspace-manager.js";

export function registerIpc(
  store: StateStore,
  workspaces: WorkspaceManager,
  automation: AutomationEngine,
  controllerWindow: () => BrowserWindow | undefined,
): () => void {
  ipcMain.handle("state:get", () => store.snapshot());
  ipcMain.handle("workspace:create", (_event, value: unknown) => store.createWorkspace(validateWorkspaceInput(value)));
  ipcMain.handle("workspace:remove", (_event, workspaceId: string) => store.removeWorkspace(requireId(workspaceId)));
  ipcMain.handle("workspace:open", async (_event, workspaceId: string) => workspaces.open(requireId(workspaceId)));
  ipcMain.handle("task:create", (_event, value: unknown) => {
    const tasks = store.createTasks(validateTaskInput(value));
    void automation.tick();
    return tasks;
  });
  ipcMain.handle("task:pause", (_event, taskId: string) => store.updateTask(requireId(taskId), "paused"));
  ipcMain.handle("task:resume", (_event, taskId: string) => store.updateTask(requireId(taskId), "queued", { error: undefined }));
  ipcMain.handle("task:cancel", (_event, taskId: string) => store.updateTask(requireId(taskId), "cancelled"));
  ipcMain.handle("task:retry", (_event, taskId: string) => {
    const id = requireId(taskId);
    const current = store.requireTask(id);
    const queued = transitionTask(current, "queued", { error: undefined, progress: 0 });
    store.patchTask(id, queued);
    void automation.tick();
    return queued;
  });
  ipcMain.handle("settings:update", (_event, patch: Partial<AppSettings>) => store.updateSettings(patch));
  ipcMain.handle("browser:bounds", (_event, workspaceId: string, value: unknown) =>
    workspaces.setBounds(requireId(workspaceId), validateBounds(value)),
  );
  ipcMain.handle("browser:command", (_event, workspaceId: string, command: BrowserCommand) => {
    if (!["back", "forward", "reload", "home"].includes(command)) throw new Error("浏览器命令无效");
    workspaces.command(requireId(workspaceId), command);
  });
  ipcMain.handle("browser:select-thirty", (_event, workspaceId: string) =>
    workspaces.selectThirtySeconds(requireId(workspaceId)),
  );
  ipcMain.handle("asset:download", async (_event, assetId: string) => {
    const asset = store.requireAsset(requireId(assetId));
    await workspaces.requestDownload(asset);
  });
  ipcMain.handle("download:reveal", (_event, downloadId: string) => {
    const download = store.requireDownload(requireId(downloadId));
    shell.showItemInFolder(download.savePath);
  });

  const unsubscribe = store.subscribe((snapshot: StateSnapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("state:changed", snapshot);
    }
  });
  workspaces.on("workspace-event", (event) => {
    const controller = controllerWindow();
    if (controller && !controller.isDestroyed()) controller.webContents.send("workspace:event", event);
  });

  return () => {
    unsubscribe();
    for (const channel of [
      "state:get",
      "workspace:create",
      "workspace:remove",
      "workspace:open",
      "task:create",
      "task:pause",
      "task:resume",
      "task:cancel",
      "task:retry",
      "settings:update",
      "browser:bounds",
      "browser:command",
      "browser:select-thirty",
      "asset:download",
      "download:reveal",
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}

export function adapterSummary() {
  return (["doubao", "dola", "demo"] as const).map((siteId) => adapterFor(siteId));
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{2,120}$/.test(value)) throw new Error("标识符无效");
  return value;
}
