import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  BrowserBounds,
  BrowserCommand,
  CreateTaskInput,
  CreateWorkspaceInput,
  OrbitApi,
  StateSnapshot,
  WorkspaceEvent,
} from "../shared/contracts.js";

const api: OrbitApi = {
  getState: () => ipcRenderer.invoke("state:get") as Promise<StateSnapshot>,
  createWorkspace: (input: CreateWorkspaceInput) => ipcRenderer.invoke("workspace:create", input),
  removeWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:remove", workspaceId),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:open", workspaceId),
  createTasks: (input: CreateTaskInput) => ipcRenderer.invoke("task:create", input),
  pauseTask: (taskId: string) => ipcRenderer.invoke("task:pause", taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke("task:resume", taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke("task:cancel", taskId),
  retryTask: (taskId: string) => ipcRenderer.invoke("task:retry", taskId),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  setBrowserBounds: (workspaceId: string, bounds: BrowserBounds) =>
    ipcRenderer.invoke("browser:bounds", workspaceId, bounds),
  browserCommand: (workspaceId: string, command: BrowserCommand) =>
    ipcRenderer.invoke("browser:command", workspaceId, command),
  selectThirtySeconds: (workspaceId: string) =>
    ipcRenderer.invoke("browser:select-thirty", workspaceId),
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
