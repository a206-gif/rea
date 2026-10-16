import { copyFileSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { dialog, shell } from "electron";
import { safeId, sanitizeFilename } from "../domain/files.js";
import type { LibraryAsset } from "../shared/contracts.js";
import type { StateStore } from "./store.js";

const videoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export class LibraryManager {
  readonly #store: StateStore;
  readonly #directory: string;

  constructor(store: StateStore, directory: string) {
    this.#store = store;
    this.#directory = resolve(directory);
  }

  async importFiles(): Promise<LibraryAsset[]> {
    const selection = await dialog.showOpenDialog({
      title: "导入 OrbitDesk 素材",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "视频和图片", extensions: ["mp4", "webm", "mov", "m4v", "png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    if (selection.canceled) return [];
    mkdirSync(this.#directory, { recursive: true });
    const imported: LibraryAsset[] = [];
    for (const sourcePath of selection.filePaths.slice(0, 100)) {
      const extension = extname(sourcePath).toLowerCase();
      const kind = videoExtensions.has(extension) ? "video" : imageExtensions.has(extension) ? "image" : undefined;
      if (!kind) continue;
      const filename = sanitizeFilename(basename(sourcePath));
      const destination = join(this.#directory, `${Date.now()}-${safeId("asset").slice(-8)}-${filename}`);
      copyFileSync(sourcePath, destination);
      imported.push({
        id: safeId("library"),
        name: filename,
        kind,
        localPath: destination,
        bytes: statSync(destination).size,
        extension,
        tags: ["本机导入"],
        source: "imported",
        createdAt: new Date().toISOString(),
      });
    }
    if (imported.length) this.#store.addLibraryAssets(imported);
    return imported;
  }

  remove(assetId: string): void {
    const asset = this.#store.snapshot().libraryAssets.find((item) => item.id === assetId);
    if (!asset) throw new Error("找不到素材");
    const resolved = resolve(asset.localPath);
    const pathWithinLibrary = relative(this.#directory, resolved);
    if (asset.source === "imported" && pathWithinLibrary && !pathWithinLibrary.startsWith("..") && !isAbsolute(pathWithinLibrary)) {
      try { unlinkSync(resolved); } catch { /* The catalog can still be cleaned when the file is gone. */ }
    }
    this.#store.removeLibraryAsset(assetId);
  }

  reveal(assetId: string): void {
    const asset = this.#store.snapshot().libraryAssets.find((item) => item.id === assetId);
    if (!asset) throw new Error("找不到素材");
    shell.showItemInFolder(asset.localPath);
  }
}
