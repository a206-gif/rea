import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Notification } from "electron";
import type { StateSnapshot } from "../shared/contracts.js";
import { AutomationApiServer } from "./automation-api.js";
import { AutomationEngine } from "./automation-engine.js";
import { DownloadManager } from "./download-manager.js";
import { registerIpc } from "./ipc.js";
import { LibraryManager } from "./library-manager.js";
import { StateStore } from "./store.js";
import { loadRenderer, WorkspaceManager } from "./workspace-manager.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let controllerWindow: BrowserWindow | undefined;
let workspaceManager: WorkspaceManager | undefined;
let automation: AutomationEngine | undefined;
let localApi: AutomationApiServer | undefined;
let disposeIpc: (() => void) | undefined;

app.setAppUserModelId("ai.orbitdesk.studio");

app.whenReady().then(async () => {
  const preloadPath = join(currentDirectory, "../preload/index.cjs");
  const rendererEntry = process.env.VITE_DEV_SERVER_URL ?? join(currentDirectory, "../../dist/index.html");
  const store = new StateStore(
    join(app.getPath("userData"), "orbitdesk-state.json"),
    join(app.getPath("downloads"), "OrbitDesk"),
  );
  const downloads = new DownloadManager(store);
  const library = new LibraryManager(store, join(app.getPath("userData"), "library"));
  workspaceManager = new WorkspaceManager(store, downloads, preloadPath, rendererEntry);
  automation = new AutomationEngine(store, workspaceManager);
  localApi = new AutomationApiServer(store, workspaceManager);
  disposeIpc = registerIpc(store, workspaceManager, downloads, library);

  const completedTaskIds = new Set(store.snapshot().tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const broadcastState = (state: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("state:changed", state);
    }
  };
  store.on("changed", (state: StateSnapshot) => {
    broadcastState(state);
    for (const task of state.tasks) {
      if (task.status !== "completed" || completedTaskIds.has(task.id)) continue;
      completedTaskIds.add(task.id);
      if (state.settings.notifyOnComplete && Notification.isSupported()) {
        const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
        new Notification({ title: "OrbitDesk 任务完成", body: `${workspace?.name ?? "浏览器实例"} 已检测到${task.kind === "video" ? "视频" : "图片"}结果` }).show();
      }
    }
  });
  store.on("changed", () => void localApi?.sync().catch((error: unknown) => console.error("Local API sync failed", error)));
  workspaceManager.on("workspace-event", (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("workspace:event", event);
    }
  });

  automation.start();
  await localApi.sync().catch((error: unknown) => console.error("Local API start failed", error));
  controllerWindow = createController(preloadPath);
  controllerWindow.once("ready-to-show", () => controllerWindow?.show());
  await loadRenderer(controllerWindow, rendererEntry);
  if (!controllerWindow.isVisible()) controllerWindow.show();
  controllerWindow.on("closed", () => { controllerWindow = undefined; });

  app.on("activate", () => {
    if (!controllerWindow || controllerWindow.isDestroyed()) {
      controllerWindow = createController(preloadPath);
      void loadRenderer(controllerWindow, rendererEntry);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  automation?.stop();
  void localApi?.stop();
  disposeIpc?.();
  workspaceManager?.closeAll();
});

function createController(preloadPath: string): BrowserWindow {
  return new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f6f7f4",
    title: "OrbitDesk AI Studio",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
}
