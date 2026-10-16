import { describe, expect, it } from "vitest";
import { validateProxy, validateStoryboardInput, validateTaskInput } from "./validation";

describe("expanded clean-room input validation", () => {
  it("accepts system/VPN routing and only explicit supported proxy schemes", () => {
    expect(validateProxy({ mode: "system" })).toEqual({ mode: "system" });
    expect(validateProxy({ mode: "fixed_servers", server: "socks5://127.0.0.1:1080" })).toMatchObject({ mode: "fixed_servers" });
    expect(() => validateProxy({ mode: "fixed_servers", server: "file:///tmp/socket" })).toThrow(/代理服务器/);
  });

  it("preserves the strict 30 second requirement and validates ratios", () => {
    expect(validateTaskInput({ workspaceId: "workspace_1", prompt: "a cinematic prompt", kind: "video", durationSeconds: 30, quantity: 1, autoDownload: true, aspectRatio: "9:16" }).aspectRatio).toBe("9:16");
    expect(() => validateTaskInput({ workspaceId: "workspace_1", prompt: "a cinematic prompt", kind: "video", durationSeconds: 10, quantity: 1, autoDownload: true })).toThrow(/30 秒/);
  });

  it("bounds persistent storyboards to 50 validated shots", () => {
    const board = validateStoryboardInput({ name: "广告分镜", workspaceId: "workspace_1", shots: [{ prompt: "opening wide angle", kind: "video", aspectRatio: "16:9" }] });
    expect(board.shots).toHaveLength(1);
    expect(() => validateStoryboardInput({ name: "empty", workspaceId: "workspace_1", shots: [] })).toThrow(/1 到 50/);
  });
});
