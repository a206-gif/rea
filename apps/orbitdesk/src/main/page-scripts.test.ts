import { describe, expect, it } from "vitest";
import { adapterFor } from "../adapters/site-adapters";
import type { GenerationTask } from "../shared/contracts";
import { buildSubmitScript } from "./page-scripts";

const baseTask: GenerationTask = {
  id: "task_test",
  workspaceId: "workspace_test",
  prompt: "a prompt",
  kind: "video",
  durationSeconds: 30,
  autoDownload: true,
  status: "submitting",
  progress: 18,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  resultAssetIds: [],
  attempt: 1,
};

describe("page script construction", () => {
  it("serializes hostile prompt text as data rather than source", () => {
    const prompt = '"; window.pwned = true; // </script>';
    const script = buildSubmitScript(adapterFor("doubao"), { ...baseTask, prompt });
    expect(script).toContain(JSON.stringify(prompt));
    expect(script).toContain("config.prompt");
    expect(script).not.toContain(`const config = {${prompt}`);
  });

  it("fails closed when the 30 second control cannot be located", () => {
    const script = buildSubmitScript(adapterFor("dola"), baseTask);
    expect(script).toContain("页面没有可确认的 30 秒选项；任务未提交");
  });
});
