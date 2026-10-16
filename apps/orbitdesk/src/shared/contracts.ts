export type SiteId = "doubao" | "dola" | "demo";
export type AssetKind = "video" | "image";
export type WorkspaceRuntimeStatus =
  | "offline"
  | "opening"
  | "ready"
  | "working"
  | "needs_attention"
  | "error";
export type TaskStatus =
  | "queued"
  | "preparing"
  | "submitting"
  | "awaiting_result"
  | "downloading"
  | "completed"
  | "paused"
  | "needs_attention"
  | "failed"
  | "cancelled";
export type DownloadStatus = "queued" | "downloading" | "completed" | "failed" | "cancelled";

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  siteId: SiteId;
  profileId: string;
  startUrl: string;
  status: WorkspaceRuntimeStatus;
  currentUrl?: string;
  lastError?: string;
  createdAt: string;
  lastOpenedAt?: string;
}

export interface GenerationTask {
  id: string;
  workspaceId: string;
  prompt: string;
  kind: AssetKind;
  durationSeconds: 30;
  autoDownload: boolean;
  status: TaskStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  resultAssetIds: string[];
  attempt: number;
}

export interface DetectedAsset {
  id: string;
  taskId: string;
  workspaceId: string;
  kind: AssetKind;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  detectedAt: string;
  downloadId?: string;
}

export interface DownloadRecord {
  id: string;
  workspaceId: string;
  taskId?: string;
  assetId?: string;
  sourceUrl: string;
  filename: string;
  savePath: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface AppSettings {
  downloadDirectory: string;
  maxConcurrentWorkspaces: number;
  resultPollSeconds: number;
  taskTimeoutMinutes: number;
  openWorkspaceOnTask: boolean;
  notifyOnComplete: boolean;
  theme: "light" | "system";
}

export interface AdapterHealth {
  siteId: SiteId;
  name: string;
  baseUrl: string;
  configured: boolean;
  lastCheckedAt?: string;
  lastMessage?: string;
}

export interface StateSnapshot {
  profiles: Profile[];
  workspaces: Workspace[];
  tasks: GenerationTask[];
  assets: DetectedAsset[];
  downloads: DownloadRecord[];
  settings: AppSettings;
  adapters: AdapterHealth[];
}

export interface CreateWorkspaceInput {
  name: string;
  siteId: SiteId;
  profileId: string;
  startUrl?: string;
}

export interface CreateTaskInput {
  workspaceId: string;
  prompt: string;
  kind: AssetKind;
  durationSeconds: 30;
  quantity: number;
  autoDownload: boolean;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserCommand = "back" | "forward" | "reload" | "home";

export interface BrowserPageActionResult {
  ok: boolean;
  stage: "blocked" | "mode" | "duration" | "ready";
  message: string;
}

export interface WorkspaceEvent {
  workspaceId: string;
  type: "status" | "url" | "title" | "automation";
  value: string;
  at: string;
}

export interface OrbitApi {
  getState(): Promise<StateSnapshot>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  removeWorkspace(workspaceId: string): Promise<void>;
  openWorkspace(workspaceId: string): Promise<void>;
  createTasks(input: CreateTaskInput): Promise<GenerationTask[]>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  setBrowserBounds(workspaceId: string, bounds: BrowserBounds): Promise<void>;
  browserCommand(workspaceId: string, command: BrowserCommand): Promise<void>;
  selectThirtySeconds(workspaceId: string): Promise<BrowserPageActionResult>;
  downloadAsset(assetId: string): Promise<void>;
  revealDownload(downloadId: string): Promise<void>;
  onStateChanged(callback: (state: StateSnapshot) => void): () => void;
  onWorkspaceEvent(callback: (event: WorkspaceEvent) => void): () => void;
}

declare global {
  interface Window {
    orbit?: OrbitApi;
  }
}
