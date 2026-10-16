export type SiteId = "doubao" | "dola" | "demo";
export type AssetKind = "video" | "image";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
export type WorkspaceStatus = "offline" | "opening" | "ready" | "working" | "needs_attention" | "error";
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
export type DownloadStatus = "downloading" | "completed" | "failed" | "cancelled";

export interface LoginProfile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ProxyConfig {
  mode: "direct" | "fixed_servers";
  /** Chromium proxy rule such as http://127.0.0.1:7890 or socks5://host:1080. */
  server?: string;
  bypassRules?: string;
}

export interface Workspace {
  id: string;
  name: string;
  siteId: SiteId;
  /** Human-readable profile label. Browser storage is still isolated by workspace id. */
  profileId: string;
  startUrl: string;
  currentUrl?: string;
  status: WorkspaceStatus;
  group: string;
  order: number;
  proxy: ProxyConfig;
  createdAt: string;
  lastOpenedAt?: string;
  lastError?: string;
}

export interface GenerationTask {
  id: string;
  workspaceId: string;
  prompt: string;
  kind: AssetKind;
  durationSeconds: 30;
  model: "2.5" | "page-default";
  aspectRatio: AspectRatio;
  autoDownload: boolean;
  status: TaskStatus;
  progress: number;
  queueOrder: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  resultAssetIds: string[];
  attempt: number;
  storyboardId?: string;
  shotId?: string;
}

export interface DetectedAsset {
  id: string;
  workspaceId: string;
  taskId?: string;
  kind: AssetKind;
  url: string;
  detectedAt: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  downloadId?: string;
}

export interface LibraryAsset {
  id: string;
  name: string;
  kind: AssetKind;
  localPath: string;
  bytes: number;
  extension: string;
  tags: string[];
  source: "imported" | "download";
  workspaceId?: string;
  taskId?: string;
  createdAt: string;
}

export interface StoryboardShot {
  id: string;
  order: number;
  prompt: string;
  kind: AssetKind;
  aspectRatio: AspectRatio;
}

export interface Storyboard {
  id: string;
  name: string;
  workspaceId: string;
  shots: StoryboardShot[];
  createdAt: string;
  updatedAt: string;
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
  theme: "light" | "dark" | "system";
  automationApiEnabled: boolean;
  automationApiPort: number;
  /** A random local bearer token. It is only shown after an explicit reveal action in the UI. */
  automationApiToken: string;
}

export interface AdapterHealth {
  siteId: SiteId;
  name: string;
  baseUrl: string;
  configured: boolean;
  lastCheckedAt?: string;
  lastMessage?: string;
}

export interface AdapterProbe {
  workspaceId: string;
  url: string;
  title: string;
  promptControlVisible: boolean;
  videoModeVisible: boolean;
  model25Visible: boolean;
  visibleDurations: string[];
  thirtySecondsVisible: boolean;
  blockedReason?: string;
  checkedAt: string;
}

export interface StateSnapshot {
  profiles: LoginProfile[];
  workspaces: Workspace[];
  tasks: GenerationTask[];
  assets: DetectedAsset[];
  libraryAssets: LibraryAsset[];
  storyboards: Storyboard[];
  downloads: DownloadRecord[];
  settings: AppSettings;
  adapters: AdapterHealth[];
}

export interface CreateWorkspaceInput {
  name: string;
  siteId: SiteId;
  profileId: string;
  startUrl?: string;
  group?: string;
  proxy?: ProxyConfig;
}

export interface UpdateWorkspaceInput {
  name?: string;
  startUrl?: string;
  group?: string;
  proxy?: ProxyConfig;
}

export interface CreateTaskInput {
  workspaceId: string;
  prompt: string;
  kind: AssetKind;
  durationSeconds: 30;
  quantity: number;
  autoDownload: boolean;
  aspectRatio?: AspectRatio;
  storyboardId?: string;
  shotId?: string;
}

export interface SaveStoryboardInput {
  id?: string;
  name: string;
  workspaceId: string;
  shots: Array<Pick<StoryboardShot, "prompt" | "kind" | "aspectRatio"> & { id?: string }>;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserCommand = "back" | "forward" | "reload" | "home" | "devtools";
export type MoveDirection = "up" | "down";

export interface PageActionResult {
  ok: boolean;
  stage: "blocked" | "prompt" | "mode" | "model" | "duration" | "ratio" | "submit" | "submitted" | "ready";
  message: string;
}

export interface SessionTransferResult {
  path: string;
  imported?: number;
  exported?: number;
  skipped?: number;
}

export interface WorkspaceEvent {
  workspaceId: string;
  type: "url" | "title" | "status" | "automation";
  value: string;
  at: string;
}

export interface OrbitApi {
  getState(): Promise<StateSnapshot>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  moveWorkspace(workspaceId: string, direction: MoveDirection): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
  openWorkspace(workspaceId: string): Promise<void>;
  createTasks(input: CreateTaskInput): Promise<GenerationTask[]>;
  moveTask(taskId: string, direction: MoveDirection): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  saveStoryboard(input: SaveStoryboardInput): Promise<Storyboard>;
  deleteStoryboard(storyboardId: string): Promise<void>;
  queueStoryboard(storyboardId: string): Promise<GenerationTask[]>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  rotateAutomationApiToken(): Promise<string>;
  setBrowserBounds(workspaceId: string, bounds: BrowserBounds): Promise<void>;
  browserCommand(workspaceId: string, command: BrowserCommand): Promise<void>;
  selectThirtySeconds(workspaceId: string): Promise<PageActionResult>;
  probeWorkspace(workspaceId: string): Promise<AdapterProbe>;
  exportWorkspaceCookies(workspaceId: string): Promise<SessionTransferResult | undefined>;
  importWorkspaceCookies(workspaceId: string): Promise<SessionTransferResult | undefined>;
  importLibraryAssets(): Promise<LibraryAsset[]>;
  removeLibraryAsset(assetId: string): Promise<void>;
  revealLibraryAsset(assetId: string): Promise<void>;
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
