import type { SiteAdapter } from "../adapters/site-adapters.js";
import type { GenerationTask } from "../shared/contracts.js";

export interface PageActionResult {
  ok: boolean;
  stage: "blocked" | "prompt" | "mode" | "duration" | "submit" | "submitted";
  message: string;
}

export interface PageAssetObservation {
  url: string;
  kind: "video" | "image";
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface PageDetectionResult {
  blocked?: string;
  assets: PageAssetObservation[];
  pageTextHint: string;
}

export function buildSubmitScript(adapter: SiteAdapter, task: GenerationTask): string {
  const configuration = JSON.stringify({
    prompt: task.prompt,
    kind: task.kind,
    promptSelectors: adapter.promptSelectors,
    durationSelectors: adapter.durationSelectors,
    submitSelectors: adapter.submitSelectors,
    submitLabels: adapter.submitLabels,
    durationLabels: adapter.durationLabels,
    blockedLabels: adapter.blockedLabels,
  });

  return `(() => {
    const config = ${configuration};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
    };
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const pageText = normalize(document.body?.innerText || "");
    const blocked = config.blockedLabels.find((label) => pageText.includes(normalize(label)));
    if (blocked) return { ok: false, stage: "blocked", message: "页面要求人工处理：" + blocked };
    const bySelectors = (selectors) => {
      for (const selector of selectors) {
        try {
          const match = [...document.querySelectorAll(selector)].find(visible);
          if (match) return match;
        } catch {}
      }
      return null;
    };
    const byLabels = (labels) => {
      const wanted = labels.map(normalize);
      const candidates = document.querySelectorAll("button, [role='button'], [role='option'], [role='radio'], label");
      for (const candidate of candidates) {
        if (!visible(candidate)) continue;
        const text = normalize(candidate.textContent || candidate.getAttribute("aria-label") || "");
        if (wanted.some((label) => text === label || text.includes(label))) return candidate;
      }
      return null;
    };
    const input = bySelectors(config.promptSelectors);
    if (!input) return { ok: false, stage: "prompt", message: "没有找到提示词输入框；请打开生成页面后重试" };
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(input, config.prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (input instanceof HTMLElement && input.isContentEditable) {
      input.textContent = config.prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: config.prompt }));
    } else {
      return { ok: false, stage: "prompt", message: "找到的提示词控件不可编辑" };
    }
    const modeLabels = config.kind === "video" ? ["视频", "video", "文生视频"] : ["图片", "图像", "image", "文生图"];
    const mode = byLabels(modeLabels);
    if (mode) mode.click();
    if (config.kind === "video") {
      const duration = bySelectors(config.durationSelectors) || byLabels(config.durationLabels);
      if (!duration) return { ok: false, stage: "duration", message: "页面没有可确认的 30 秒选项；任务未提交" };
      duration.click();
    }
    const submit = bySelectors(config.submitSelectors) || byLabels(config.submitLabels);
    if (!submit) return { ok: false, stage: "submit", message: "没有找到生成按钮；任务未提交" };
    if (submit instanceof HTMLButtonElement && submit.disabled) {
      return { ok: false, stage: "submit", message: "生成按钮当前不可用，请检查页面参数或账号状态" };
    }
    submit.click();
    return { ok: true, stage: "submitted", message: "已通过页面 UI 提交任务" };
  })()`;
}

export function buildDetectionScript(adapter: SiteAdapter): string {
  const configuration = JSON.stringify({
    mediaSelectors: adapter.mediaSelectors,
    blockedLabels: adapter.blockedLabels,
    completionLabels: adapter.completionLabels,
  });
  return `(() => {
    const config = ${configuration};
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
    };
    const bodyText = normalize(document.body?.innerText || "");
    const blocked = config.blockedLabels.find((label) => bodyText.includes(normalize(label)));
    const completion = config.completionLabels.some((label) => bodyText.includes(normalize(label)));
    const nodes = [];
    for (const selector of config.mediaSelectors) {
      try { nodes.push(...document.querySelectorAll(selector)); } catch {}
    }
    const assets = [];
    const seen = new Set();
    for (const node of nodes) {
      const visibilityTarget = node instanceof HTMLSourceElement ? node.closest("video") : node;
      if (!visibilityTarget || !visible(visibilityTarget)) continue;
      let url = "";
      let kind = "image";
      let width = 0;
      let height = 0;
      let durationSeconds;
      if (node instanceof HTMLVideoElement) {
        kind = "video";
        url = node.currentSrc || node.src || node.querySelector("source")?.src || "";
        width = node.videoWidth || node.clientWidth;
        height = node.videoHeight || node.clientHeight;
        durationSeconds = Number.isFinite(node.duration) ? node.duration : undefined;
        if (node.readyState < 2 && !completion) continue;
      } else if (node instanceof HTMLSourceElement) {
        const video = node.closest("video");
        kind = "video";
        url = node.src;
        width = video?.videoWidth || video?.clientWidth || 0;
        height = video?.videoHeight || video?.clientHeight || 0;
        durationSeconds = video && Number.isFinite(video.duration) ? video.duration : undefined;
      } else if (node instanceof HTMLImageElement) {
        kind = "image";
        url = node.currentSrc || node.src;
        width = node.naturalWidth || node.clientWidth;
        height = node.naturalHeight || node.clientHeight;
        const nearby = normalize(node.closest("article, [class*='result'], [class*='generation'], [data-testid]")?.textContent || "");
        if (width < 512 && height < 512 && !config.completionLabels.some((label) => nearby.includes(normalize(label)))) continue;
      } else if (node instanceof HTMLAnchorElement) {
        url = node.href;
        const text = normalize(node.textContent || node.getAttribute("aria-label") || "");
        kind = text.includes("video") || /\\.(mp4|webm)(\\?|$)/i.test(url) ? "video" : "image";
      }
      if (!url || !/^(https?:|blob:|data:)/i.test(url) || seen.has(url)) continue;
      seen.add(url);
      assets.push({ url, kind, width: width || undefined, height: height || undefined, durationSeconds });
    }
    return { blocked, assets, pageTextHint: bodyText.slice(0, 240) };
  })()`;
}
