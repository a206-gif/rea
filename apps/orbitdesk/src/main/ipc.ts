import { dialog, ipcMain, shell } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateBounds,
  validateSettingsPatch,
  validateStoryboardInput,
  validateTaskInput,
  validateWorkspaceInput,
  validateWorkspaceUpdate,
} from "../domain/validation.js";
import type { AppSettings, BrowserCommand, MoveDirection } from "../shared/contracts.js";
import type { DownloadManager } from "./download-manager.js";
import type { LibraryManager } from "./library-manager.js";
import type { StateStore } from "./store.js";
import type { WorkspaceManager } from "./workspace-manager.js";

const browserCommands = new Set<BrowserCommand>(["back", "forward", "reload", "home", "devtools"]);
const directions = new Set<MoveDirection>(["up", "down"]);

const ipcChannels = [
  "state:get", "workspace:create", "workspace:update", "workspace:move", "workspace:remove", "workspace:open",
  "task:create", "task:move", "task:pause", "task:resume", "task:cancel", "task:retry",
  "storyboard:save", "storyboard:delete", "storyboard:queue", "settings:update", "settings:rotate-api-token", "browser:bounds",
  "browser:command", "browser:select-thirty", "browser:probe", "session:export-cookies", "session:import-cookies",
  "library:import", "library:remove", "library:reveal", "asset:download", "download:reveal",
] as const;

export function registerIpc(
  store: StateStore,
  workspaceManager: WorkspaceManager,
  downloadManager: DownloadManager,
  libraryManager: LibraryManager,
): () => void {
  for (const channel of ipcChannels) ipcMain.removeHandler(channel);
  ipcMain.handle("state:get", () => store.snapshot());
  ipcMain.handle("workspace:create", (_event, raw) => store.createWorkspace(validateWorkspaceInput(raw)));
  ipcMain.handle("workspace:update", async (_event, workspaceId: unknown, raw: unknown) => {
    const id = requiredId(workspaceId, "实例");
    const current = store.getWorkspace(id);
    const updated = store.updateWorkspace(id, validateWorkspaceUpdate(raw, current.siteId));
    await workspaceManager.applyWorkspaceNetworkSettings(id);
    return updated;
  });
  ipcMain.handle("workspace:move", (_event, workspaceId: unknown, direction: unknown) => {
    store.moveWorkspace(requiredId(workspaceId, "实例"), validDirection(direction));
  });
  ipcMain.handle("workspace:remove", (_event, workspaceId: unknown) => {
    const id = requiredId(workspaceId, "实例");
    workspaceManager.close(id);
    store.removeWorkspace(id);
  });
  ipcMain.handle("workspace:open", (_event, workspaceId: unknown) => workspaceManager.open(requiredId(workspaceId, "实例")));

  ipcMain.handle("task:create", (_event, raw) => {
    const input = validateTaskInput(raw);
    store.getWorkspace(input.workspaceId);
    return store.createTasks(input);
  });
  ipcMain.handle("task:move", (_event, taskId: unknown, direction: unknown) => store.moveTask(requiredId(taskId, "任务"), validDirection(direction)));
  ipcMain.handle("task:pause", (_event, taskId: unknown) => {
    const task = store.getTask(requiredId(taskId, "任务"));
    if (!["queued", "preparing", "awaiting_result"].includes(task.status)) throw new Error("当前任务不能暂停");
    store.transitionTask(task.id, "paused");
  });
  ipcMain.handle("task:resume", (_event, taskId: unknown) => {
    const task = store.getTask(requiredId(taskId, "任务"));
    if (!["paused", "needs_attention", "failed"].includes(task.status)) throw new Error("当前任务不能恢复");
    store.transitionTask(task.id, "queued", { error: undefined });
  });
  ipcMain.handle("task:cancel", (_event, taskId: unknown) => {
    const task = store.getTask(requiredId(taskId, "任务"));
    if (["completed", "cancelled"].includes(task.status)) return;
    store.transitionTask(task.id, "cancelled");
  });
  ipcMain.handle("task:retry", (_event, taskId: unknown) => {
    const task = store.getTask(requiredId(taskId, "任务"));
    if (!["failed", "needs_attention"].includes(task.status)) throw new Error("只有失败或需处理任务可以重试");
    store.transitionTask(task.id, "queued", { error: undefined, progress: 0 });
  });

  ipcMain.handle("storyboard:save", (_event, raw) => {
    const input = validateStoryboardInput(raw);
    store.getWorkspace(input.workspaceId);
    return store.saveStoryboard(input);
  });
  ipcMain.handle("storyboard:delete", (_event, storyboardId: unknown) => store.deleteStoryboard(requiredId(storyboardId, "分镜")));
  ipcMain.handle("storyboard:queue", (_event, storyboardId: unknown) => {
    const id = requiredId(storyboardId, "分镜");
    const storyboard = store.snapshot().storyboards.find((item) => item.id === id);
    if (!storyboard) throw new Error("找不到分镜");
    store.getWorkspace(storyboard.workspaceId);
    return storyboard.shots.flatMap((shot) => store.createTasks({
      workspaceId: storyboard.workspaceId,
      prompt: shot.prompt,
      kind: shot.kind,
      durationSeconds: 30,
      quantity: 1,
      autoDownload: true,
      aspectRatio: shot.aspectRatio,
      storyboardId: storyboard.id,
      shotId: shot.id,
    }));
  });

  ipcMain.handle("settings:update", (_event, raw: Partial<AppSettings>) => store.updateSettings(validateSettingsPatch(raw, store.snapshot().settings)));
  ipcMain.handle("settings:rotate-api-token", () => store.rotateAutomationApiToken());
  ipcMain.handle("browser:bounds", (_event, workspaceId: unknown, rawBounds: unknown) => workspaceManager.setBounds(requiredId(workspaceId, "实例"), validateBounds(rawBounds)));
  ipcMain.handle("browser:command", (_event, workspaceId: unknown, command: unknown) => {
    if (typeof command !== "string" || !browserCommands.has(command as BrowserCommand)) throw new Error("浏览器命令无效");
    workspaceManager.command(requiredId(workspaceId, "实例"), command as BrowserCommand);
  });
  ipcMain.handle("browser:select-thirty", (_event, workspaceId: unknown) => workspaceManager.selectThirtySeconds(requiredId(workspaceId, "实例")));
  ipcMain.handle("browser:probe", (_event, workspaceId: unknown) => workspaceManager.probe(requiredId(workspaceId, "实例")));

  ipcMain.handle("session:export-cookies", async (_event, workspaceId: unknown) => {
    const id = requiredId(workspaceId, "实例");
    const workspace = store.getWorkspace(id);
    const selected = await dialog.showSaveDialog({
      title: "导出当前实例 Cookie（敏感文件）",
      defaultPath: `${safeFileName(workspace.name)}-cookies.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return undefined;
    const cookies = await workspaceManager.exportCookies(id);
    writeFileSync(selected.filePath, JSON.stringify({ format: "orbitdesk.cookies.v1", siteId: workspace.siteId, exportedAt: new Date().toISOString(), cookies }, null, 2), { encoding: "utf8", mode: 0o600 });
    return { path: selected.filePath, exported: cookies.length };
  });
  ipcMain.handle("session:import-cookies", async (_event, workspaceId: unknown) => {
    const id = requiredId(workspaceId, "实例");
    const selected = await dialog.showOpenDialog({ title: "导入 Cookie JSON", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (selected.canceled || !selected.filePaths[0]) return undefined;
    const path = selected.filePaths[0];
    if (statSync(path).size > 5_000_000) throw new Error("Cookie 文件不能超过 5 MB");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cookies = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.cookies) ? parsed.cookies : undefined;
    if (!cookies) throw new Error("Cookie 文件格式无效");
    const result = await workspaceManager.importCookies(id, cookies);
    if (workspaceManager.hasOpenWorkspace(id)) workspaceManager.command(id, "reload");
    return { path, ...result };
  });

  ipcMain.handle("library:import", () => libraryManager.importFiles());
  ipcMain.handle("library:remove", (_event, assetId: unknown) => libraryManager.remove(requiredId(assetId, "素材")));
  ipcMain.handle("library:reveal", (_event, assetId: unknown) => libraryManager.reveal(requiredId(assetId, "素材")));
  ipcMain.handle("asset:download", (_event, assetId: unknown) => {
    const id = requiredId(assetId, "资源");
    const asset = store.snapshot().assets.find((item) => item.id === id);
    if (!asset) throw new Error("找不到资源");
    const contents = workspaceManager.getWebContents(asset.workspaceId);
    if (!contents) throw new Error("浏览器实例尚未打开");
    downloadManager.request(contents, asset);
  });
  ipcMain.handle("download:reveal", (_event, downloadId: unknown) => {
    const id = requiredId(downloadId, "下载");
    const download = store.snapshot().downloads.find((item) => item.id === id);
    if (!download) throw new Error("找不到下载记录");
    shell.showItemInFolder(resolve(download.savePath));
  });
  return () => { for (const channel of ipcChannels) ipcMain.removeHandler(channel); };
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{3,120}$/.test(value)) throw new Error(`${label}编号无效`);
  return value;
}

function validDirection(value: unknown): MoveDirection {
  if (typeof value !== "string" || !directions.has(value as MoveDirection)) throw new Error("移动方向无效");
  return value as MoveDirection;
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "orbitdesk";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
