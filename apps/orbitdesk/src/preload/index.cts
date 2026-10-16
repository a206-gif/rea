import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  BrowserBounds,
  BrowserCommand,
  CreateTaskInput,
  CreateWorkspaceInput,
  MoveDirection,
  OrbitApi,
  SaveStoryboardInput,
  StateSnapshot,
  UpdateWorkspaceInput,
  WorkspaceEvent,
} from "../shared/contracts.js";

const api: OrbitApi = {
  getState: () => ipcRenderer.invoke("state:get") as Promise<StateSnapshot>,
  createWorkspace: (input: CreateWorkspaceInput) => ipcRenderer.invoke("workspace:create", input),
  updateWorkspace: (workspaceId: string, input: UpdateWorkspaceInput) => ipcRenderer.invoke("workspace:update", workspaceId, input),
  moveWorkspace: (workspaceId: string, direction: MoveDirection) => ipcRenderer.invoke("workspace:move", workspaceId, direction),
  removeWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:remove", workspaceId),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:open", workspaceId),
  createTasks: (input: CreateTaskInput) => ipcRenderer.invoke("task:create", input),
  moveTask: (taskId: string, direction: MoveDirection) => ipcRenderer.invoke("task:move", taskId, direction),
  pauseTask: (taskId: string) => ipcRenderer.invoke("task:pause", taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke("task:resume", taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke("task:cancel", taskId),
  retryTask: (taskId: string) => ipcRenderer.invoke("task:retry", taskId),
  saveStoryboard: (input: SaveStoryboardInput) => ipcRenderer.invoke("storyboard:save", input),
  deleteStoryboard: (storyboardId: string) => ipcRenderer.invoke("storyboard:delete", storyboardId),
  queueStoryboard: (storyboardId: string) => ipcRenderer.invoke("storyboard:queue", storyboardId),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  rotateAutomationApiToken: () => ipcRenderer.invoke("settings:rotate-api-token"),
  setBrowserBounds: (workspaceId: string, bounds: BrowserBounds) => ipcRenderer.invoke("browser:bounds", workspaceId, bounds),
  browserCommand: (workspaceId: string, command: BrowserCommand) => ipcRenderer.invoke("browser:command", workspaceId, command),
  selectThirtySeconds: (workspaceId: string) => ipcRenderer.invoke("browser:select-thirty", workspaceId),
  probeWorkspace: (workspaceId: string) => ipcRenderer.invoke("browser:probe", workspaceId),
  exportWorkspaceCookies: (workspaceId: string) => ipcRenderer.invoke("session:export-cookies", workspaceId),
  importWorkspaceCookies: (workspaceId: string) => ipcRenderer.invoke("session:import-cookies", workspaceId),
  importLibraryAssets: () => ipcRenderer.invoke("library:import"),
  removeLibraryAsset: (assetId: string) => ipcRenderer.invoke("library:remove", assetId),
  revealLibraryAsset: (assetId: string) => ipcRenderer.invoke("library:reveal", assetId),
  downloadAsset: (assetId: string) => ipcRenderer.invoke("asset:download", assetId),
  revealDownload: (downloadId: string) => ipcRenderer.invoke("download:reveal", downloadId),
  onStateChanged(callback: (state: StateSnapshot) => void) {
    const listener = (_event: Electron.IpcRendererEvent, state: StateSnapshot) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.off("state:changed", listener);
  },
  onWorkspaceEvent(callback: (event: WorkspaceEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: WorkspaceEvent) => callback(value);
    ipcRenderer.on("workspace:event", listener);
    return () => ipcRenderer.off("workspace:event", listener);
  },
};

contextBridge.exposeInMainWorld("orbit", Object.freeze(api));
