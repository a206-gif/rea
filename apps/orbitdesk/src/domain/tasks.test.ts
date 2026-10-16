import { describe, expect, it } from "vitest";
import { canTransitionTask, runnableTasks, transitionTask } from "./tasks";
import type { GenerationTask } from "../shared/contracts";

function task(status: GenerationTask["status"], createdAt = "2026-01-01T00:00:00.000Z"): GenerationTask {
  return {
    id: `task_${status}`,
    workspaceId: "workspace_test",
    prompt: "test prompt",
    kind: "video",
    durationSeconds: 30,
    model: "2.5",
    aspectRatio: "16:9",
    autoDownload: true,
    status,
    progress: 0,
    queueOrder: new Date(createdAt).getTime(),
    createdAt,
    updatedAt: createdAt,
    resultAssetIds: [],
    attempt: 0,
  };
}

describe("task state machine", () => {
  it("admits the expected happy path", () => {
    let current = task("queued");
    current = transitionTask(current, "preparing");
    current = transitionTask(current, "submitting");
    current = transitionTask(current, "awaiting_result");
    current = transitionTask(current, "downloading");
    current = transitionTask(current, "completed");
    expect(current.progress).toBe(100);
    expect(current.completedAt).toBeDefined();
  });

  it("rejects bypassing submission states", () => {
    expect(canTransitionTask("queued", "completed")).toBe(false);
    expect(() => transitionTask(task("queued"), "completed")).toThrow(/Invalid task transition/);
  });

  it("selects only queued tasks in FIFO order", () => {
    const selected = runnableTasks([
      task("queued", "2026-01-01T00:02:00.000Z"),
      task("paused", "2026-01-01T00:00:00.000Z"),
      task("queued", "2026-01-01T00:01:00.000Z"),
    ]);
    expect(selected.map((item) => item.createdAt)).toEqual([
      "2026-01-01T00:01:00.000Z",
      "2026-01-01T00:02:00.000Z",
    ]);
  });
});
