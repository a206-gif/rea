import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { AutomationEngine } from "./automation-engine.js";
import { DownloadManager } from "./download-manager.js";
import { registerIpc } from "./ipc.js";
import { StateStore } from "./store.js";
import { loadRenderer, WorkspaceManager } from "./workspace-manager.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let controllerWindow: BrowserWindow | undefined;
let workspaceManager: WorkspaceManager | undefined;
let automation: AutomationEngine | undefined;
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
  workspaceManager = new WorkspaceManager(store, downloads, preloadPath, rendererEntry);
  automation = new AutomationEngine(store, workspaceManager);
  disposeIpc = registerIpc(store, workspaceManager, automation, () => controllerWindow);
  automation.start();

  controllerWindow = createController(preloadPath);
  controllerWindow.once("ready-to-show", () => controllerWindow?.show());
  await loadRenderer(controllerWindow, rendererEntry);
  if (!controllerWindow.isVisible()) controllerWindow.show();
  controllerWindow.on("closed", () => {
    controllerWindow = undefined;
  });

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
