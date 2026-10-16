import { describe, expect, it } from "vitest";
import { adapterFor } from "../adapters/site-adapters";
import type { GenerationTask } from "../shared/contracts";
import { buildDurationSelectionScript, buildSubmitScript } from "./page-scripts";

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

  it("opens Dola's visible duration menu and verifies the 30 second choice", () => {
    const script = buildDurationSelectionScript(adapterFor("dola"));
    expect(script).toContain("selectDolaModel25");
    expect(script).toContain("已打开模型菜单，但没有找到 Dola 模型 2.5");
    expect(script).toContain("trigger.click()");
    expect(script).toContain("option.click()");
    expect(script).toContain("无法确认网页已切换到 30 秒");
    expect(script).toContain("https://www.dola.com/chat/");
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });

  it("fails closed when the 30 second control cannot be located or verified", () => {
    const script = buildSubmitScript(adapterFor("dola"), baseTask);
    expect(script).toContain("没有找到 Dola 网页内的时长下拉控件；未执行提交");
    expect(script).toContain("点击了 30 秒选项，但无法确认网页已切换到 30 秒；未执行提交");
  });
});
