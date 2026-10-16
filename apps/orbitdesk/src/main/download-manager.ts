import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { DownloadItem, Session, WebContents } from "electron";
import { safeId, sanitizeFilename } from "../domain/files.js";
import type { DetectedAsset, DownloadRecord } from "../shared/contracts.js";
import type { StateStore } from "./store.js";

interface PendingDownload {
  workspaceId: string;
  taskId?: string;
  assetId?: string;
}

export class DownloadManager {
  readonly #store: StateStore;
  readonly #pendingByUrl = new Map<string, PendingDownload[]>();
  readonly #registeredSessions = new WeakSet<Session>();
  readonly #workspaceByContents = new Map<number, string>();

  constructor(store: StateStore) {
    this.#store = store;
  }

  register(session: Session, webContents: WebContents, workspaceId: string): void {
    this.#workspaceByContents.set(webContents.id, workspaceId);
    webContents.once("destroyed", () => this.#workspaceByContents.delete(webContents.id));
    if (this.#registeredSessions.has(session)) return;
    this.#registeredSessions.add(session);
    session.on("will-download", (_event, item, sourceContents) => {
      this.#accept(item, sourceContents);
    });
  }

  request(webContents: WebContents, asset: DetectedAsset): void {
    const queue = this.#pendingByUrl.get(asset.url) ?? [];
    queue.push({ workspaceId: asset.workspaceId, taskId: asset.taskId, assetId: asset.id });
    this.#pendingByUrl.set(asset.url, queue);
    webContents.downloadURL(asset.url);
  }

  #accept(item: DownloadItem, sourceContents: WebContents): void {
    const sourceUrl = item.getURL();
    const pendingQueue = this.#pendingByUrl.get(sourceUrl) ?? [];
    const pending = pendingQueue.shift();
    if (pendingQueue.length === 0) this.#pendingByUrl.delete(sourceUrl);
    else this.#pendingByUrl.set(sourceUrl, pendingQueue);
    const workspaceId = pending?.workspaceId ?? this.#workspaceByContents.get(sourceContents.id);
    if (!workspaceId) {
      item.cancel();
      return;
    }

    const settings = this.#store.snapshot().settings;
    mkdirSync(settings.downloadDirectory, { recursive: true });
    const inferredExtension = extname(new URL(sourceUrl, "https://invalid.local").pathname);
    const original = item.getFilename() || `orbitdesk-${Date.now()}${inferredExtension}`;
    const filename = sanitizeFilename(original);
    const savePath = uniquePath(settings.downloadDirectory, filename);
    item.setSavePath(savePath);

    const record: DownloadRecord = {
      id: safeId("download"),
      workspaceId,
      taskId: pending?.taskId,
      assetId: pending?.assetId,
      sourceUrl,
      filename,
      savePath,
      status: "downloading",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      createdAt: new Date().toISOString(),
    };
    this.#store.addDownload(record);
    if (record.assetId) this.#store.patchAsset(record.assetId, { downloadId: record.id });

    item.on("updated", (_event, state) => {
      this.#store.patchDownload(record.id, {
        status: state === "interrupted" ? "failed" : "downloading",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        ...(state === "interrupted" ? { error: "下载被中断" } : {}),
      });
    });
    item.once("done", (_event, state) => {
      const status = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "failed";
      this.#store.patchDownload(record.id, {
        status,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        ...(status === "completed" ? { completedAt: new Date().toISOString() } : { error: `下载状态：${state}` }),
      });
      if (status === "completed" && record.assetId) {
        const sourceAsset = this.#store.snapshot().assets.find((asset) => asset.id === record.assetId);
        if (sourceAsset && !this.#store.snapshot().libraryAssets.some((asset) => asset.localPath === savePath)) {
          this.#store.addLibraryAssets([{
            id: safeId("library"),
            name: filename,
            kind: sourceAsset.kind,
            localPath: savePath,
            bytes: item.getReceivedBytes(),
            extension: extname(filename).toLowerCase(),
            tags: ["生成结果"],
            source: "download",
            workspaceId,
            ...(record.taskId ? { taskId: record.taskId } : {}),
            createdAt: new Date().toISOString(),
          }]);
        }
      }
    });
  }
}

function uniquePath(directory: string, filename: string): string {
  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return join(directory, `${stem}-${Date.now()}${extension}`);
}
