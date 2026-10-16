import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "./store";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryStatePath(): { directory: string; statePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "orbitdesk-store-"));
  directories.push(directory);
  return { directory, statePath: join(directory, "state.json") };
}

describe("state migration and buffered persistence", () => {
  it("migrates the old default direct mode to Windows system/VPN routing", () => {
    const { directory, statePath } = temporaryStatePath();
    writeFileSync(statePath, JSON.stringify({
      workspaces: [{
        id: "workspace_old", name: "Dola", siteId: "dola", profileId: "profile_old",
        startUrl: "https://www.dola.com/chat/", status: "offline", group: "默认分组", order: 0,
        proxy: { mode: "direct" }, createdAt: "2026-01-01T00:00:00.000Z",
      }],
    }));
    const store = new StateStore(statePath, directory);
    expect(store.snapshot().schemaVersion).toBe(3);
    expect(store.getWorkspace("workspace_old").proxy.mode).toBe("system");
  });

  it("flushes buffered mutations synchronously before shutdown", () => {
    const { directory, statePath } = temporaryStatePath();
    const store = new StateStore(statePath, directory);
    const profileId = store.snapshot().profiles[0]!.id;
    store.createWorkspace({ name: "VPN workspace", siteId: "dola", profileId });
    store.flush();
    const persisted = JSON.parse(readFileSync(statePath, "utf8")) as { workspaces: Array<{ name: string; proxy: { mode: string } }> };
    expect(persisted.workspaces.find((item) => item.name === "VPN workspace")?.proxy.mode).toBe("system");
  });
});
