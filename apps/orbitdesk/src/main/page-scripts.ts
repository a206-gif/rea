import type { SiteAdapter } from "../adapters/site-adapters.js";
import type { GenerationTask } from "../shared/contracts.js";

export interface PageActionResult {
  ok: boolean;
  stage: "blocked" | "prompt" | "mode" | "model" | "duration" | "ratio" | "submit" | "submitted" | "ready";
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

const pageInteractionHelpers = String.raw`
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0 && element.getClientRects().length > 0;
    };
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const compact = (value) => normalize(value).replace(/\s+/g, "");
    const elementText = (element) => normalize(element?.getAttribute?.("aria-label") || element?.textContent || "");
    const waitFor = async (finder, timeout = 1800) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = finder();
        if (value) return value;
        await sleep(80);
      }
      return null;
    };
    const bySelectors = (selectors) => {
      for (const selector of selectors) {
        try {
          const match = [...document.querySelectorAll(selector)].find(visible);
          if (match) return match;
        } catch {}
      }
      return null;
    };
    const interactive = () => [...document.querySelectorAll("button, [role='button'], [role='option'], [role='menuitem'], [role='menuitemradio'], [role='radio'], [role='combobox'], label, li, [data-value], [data-duration], [tabindex='0']")].filter(visible);
    const byLabels = (labels, exactOnly = false) => {
      const wanted = labels.map(normalize);
      const candidates = interactive();
      const exact = candidates.find((candidate) => wanted.includes(elementText(candidate)));
      if (exact || exactOnly) return exact || null;
      return candidates.find((candidate) => wanted.some((label) => elementText(candidate).includes(label))) || null;
    };
    const durationTokens = (element) => compact(elementText(element)).match(/(5|10|15|30)(s|秒|seconds?|second)/gi) || [];
    const isThirty = (element) => {
      const tokens = durationTokens(element);
      return tokens.length === 1 && /^30(s|秒|seconds?|second)$/i.test(tokens[0]);
    };
    const isDurationValue = (element) => durationTokens(element).length === 1;
    const optionLike = (element) => {
      const role = normalize(element?.getAttribute?.("role"));
      if (["option", "menuitem", "menuitemradio", "radio"].includes(role)) return true;
      return Boolean(element?.closest?.("[role='listbox'], [role='menu'], [class*='dropdown' i], [class*='popover' i], [class*='menu' i]"));
    };
    const selected = (element) => ["true", "checked"].includes(normalize(element?.getAttribute?.("aria-selected"))) || element?.getAttribute?.("aria-checked") === "true" || element?.getAttribute?.("data-state") === "checked";
    const modelVersion = (element) => compact(elementText(element)).match(/2\.(0|5)(fast|pro)?/i)?.[0] || "";
    const isModel25 = (element) => /^2\.5/i.test(modelVersion(element));
    const distanceScore = (element, anchor) => {
      if (!anchor || !element) return 0;
      const a = anchor.getBoundingClientRect();
      const b = element.getBoundingClientRect();
      const distance = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) + Math.abs(a.bottom - b.bottom);
      return Math.max(0, 1200 - distance);
    };
    const modelCandidates = () => {
      const candidates = interactive().filter((element) => Boolean(modelVersion(element)));
      for (const element of document.querySelectorAll("div, span")) {
        if (!visible(element) || !isModel25(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 300 && rect.height > 0 && rect.height < 120) candidates.push(element);
      }
      return [...new Set(candidates)].filter(visible);
    };
    const findModelTrigger = (anchor) => modelCandidates()
      .filter((candidate) => !optionLike(candidate))
      .sort((left, right) => {
        const score = (element) => distanceScore(element, anchor)
          + (element.matches("button, [role='button'], [role='combobox']") ? 600 : 0)
          + (element.hasAttribute("aria-haspopup") ? 700 : 0)
          + (/模型|model/i.test(elementText(element)) ? 300 : 0);
        return score(right) - score(left);
      })[0] || null;
    const findModel25Option = (trigger) => modelCandidates()
      .filter((candidate) => candidate !== trigger && isModel25(candidate))
      .sort((left, right) => {
        const score = (element) => (optionLike(element) ? 1000 : 0)
          + (element.matches("[role='option'], [role='menuitem'], [role='radio'], li") ? 500 : 0)
          - element.getBoundingClientRect().width;
        return score(right) - score(left);
      })[0] || null;
    const selectDolaModel25 = async (anchor) => {
      if (config.siteId !== "dola") return { ok: true, stage: "ready", message: "当前站点无需切换 Dola 模型" };
      let trigger = findModelTrigger(anchor);
      if (trigger && isModel25(trigger) && !optionLike(trigger)) {
        return { ok: true, stage: "ready", message: "Dola 网页已使用模型 2.5" };
      }
      if (!trigger) return { ok: false, stage: "mode", message: "没有找到 Dola 网页内的模型选择控件；请先进入视频生成模式" };
      trigger.click();
      const option = await waitFor(() => findModel25Option(trigger), 2200);
      if (!option) return { ok: false, stage: "mode", message: "已打开模型菜单，但没有找到 Dola 模型 2.5；未尝试伪造 30s 选项" };
      option.click();
      const verified = await waitFor(() => {
        trigger = findModelTrigger(anchor);
        if (trigger && isModel25(trigger) && !optionLike(trigger)) return trigger;
        return modelCandidates().find((candidate) => isModel25(candidate) && selected(candidate));
      }, 2600);
      if (!verified) return { ok: false, stage: "mode", message: "点击了模型 2.5，但无法确认 Dola 网页已切换；未继续选择 30s" };
      await sleep(300);
      return { ok: true, stage: "ready", message: "已通过 Dola 网页切换到模型 2.5" };
    };
    const durationCandidates = () => {
      const candidates = [];
      for (const selector of config.durationSelectors || []) {
        try { candidates.push(...document.querySelectorAll(selector)); } catch {}
      }
      candidates.push(...interactive().filter(isDurationValue));
      for (const element of document.querySelectorAll("div, span")) {
        if (!visible(element) || !isThirty(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 240 && rect.height > 0 && rect.height < 90) candidates.push(element);
      }
      return [...new Set(candidates)].filter((candidate) => visible(candidate) && isDurationValue(candidate));
    };
    const findDurationTrigger = (anchor) => durationCandidates()
      .filter((candidate) => !optionLike(candidate))
      .sort((left, right) => {
        const score = (element) => distanceScore(element, anchor)
          + (element.matches("button, [role='button'], [role='combobox']") ? 500 : 0)
          + (element.hasAttribute("aria-haspopup") ? 700 : 0)
          - (element.closest("aside, nav") ? 1000 : 0);
        return score(right) - score(left);
      })[0] || null;
    const findThirtyOption = (trigger) => durationCandidates()
      .filter((candidate) => candidate !== trigger && isThirty(candidate))
      .sort((left, right) => {
        const score = (element) => (optionLike(element) ? 1000 : 0)
          + (element.matches("[role='option'], [role='menuitem'], [role='menuitemradio'], li") ? 500 : 0)
          - element.getBoundingClientRect().width;
        return score(right) - score(left);
      })[0] || null;
    const selectThirtySeconds = async (anchor) => {
      let trigger = findDurationTrigger(anchor);
      if (trigger && isThirty(trigger) && !optionLike(trigger)) {
        return { ok: true, stage: "ready", message: "Dola 网页已处于 30 秒" };
      }
      let option = findThirtyOption(trigger);
      if (!option) {
        if (!trigger) return { ok: false, stage: "duration", message: "没有找到 Dola 网页内的时长下拉控件；未执行提交" };
        trigger.click();
        option = await waitFor(() => findThirtyOption(trigger), 2200);
      }
      if (!option) return { ok: false, stage: "duration", message: "已打开时长菜单，但页面没有可确认的 30 秒选项；未执行提交" };
      option.click();
      const verified = await waitFor(() => {
        trigger = findDurationTrigger(anchor);
        if (trigger && isThirty(trigger) && !optionLike(trigger)) return trigger;
        return durationCandidates().find((candidate) => isThirty(candidate) && selected(candidate));
      }, 2200);
      if (!verified) return { ok: false, stage: "duration", message: "点击了 30 秒选项，但无法确认网页已切换到 30 秒；未执行提交" };
      return { ok: true, stage: "ready", message: "已通过网页可见时长菜单选择 30 秒" };
    };
    const ratioText = (element) => compact(elementText(element)).replace(/[：]/g, ":");
    const isRatio = (element, wanted) => ratioText(element).includes(String(wanted).replace(/\s+/g, ""));
    const ratioCandidates = () => {
      const candidates = [];
      for (const selector of config.ratioSelectors || []) {
        try { candidates.push(...document.querySelectorAll(selector)); } catch {}
      }
      candidates.push(...interactive().filter((element) => /(^|[^0-9])(16:9|9:16|1:1|4:3|3:4)([^0-9]|$)/.test(ratioText(element))));
      return [...new Set(candidates)].filter(visible);
    };
    const selectAspectRatio = async (anchor) => {
      const wanted = config.aspectRatio || "16:9";
      let selectedRatio = ratioCandidates().find((candidate) => isRatio(candidate, wanted) && selected(candidate));
      if (selectedRatio) return { ok: true, stage: "ready", message: "网页已使用画面比例 " + wanted };
      let option = ratioCandidates().find((candidate) => isRatio(candidate, wanted) && optionLike(candidate));
      let trigger = ratioCandidates()
        .filter((candidate) => !optionLike(candidate))
        .sort((left, right) => distanceScore(right, anchor) - distanceScore(left, anchor))[0] || null;
      if (!option && trigger) {
        if (isRatio(trigger, wanted)) return { ok: true, stage: "ready", message: "网页已使用画面比例 " + wanted };
        trigger.click();
        option = await waitFor(() => ratioCandidates().find((candidate) => candidate !== trigger && isRatio(candidate, wanted) && optionLike(candidate)), 1800);
      }
      // Ratio selection is only attempted when a ratio control is visible. Some page modes do not expose it.
      if (!trigger && !option) return { ok: true, stage: "ready", message: "网页未显示画面比例控件，保留网页当前比例" };
      if (!option) return { ok: false, stage: "ratio", message: "已打开网页比例菜单，但没有找到 " + wanted + "；任务未提交" };
      option.click();
      selectedRatio = await waitFor(() => ratioCandidates().find((candidate) => isRatio(candidate, wanted) && (selected(candidate) || !optionLike(candidate))), 1800);
      if (!selectedRatio) return { ok: false, stage: "ratio", message: "点击了画面比例 " + wanted + "，但无法确认网页状态；任务未提交" };
      return { ok: true, stage: "ready", message: "已通过网页可见控件选择画面比例 " + wanted };
    };
`;

export function buildDurationSelectionScript(adapter: SiteAdapter): string {
  const configuration = JSON.stringify({
    siteId: adapter.id,
    baseUrl: adapter.baseUrl,
    durationSelectors: adapter.durationSelectors,
    blockedLabels: adapter.blockedLabels,
  });
  return `(async () => {
    const config = ${configuration};
    ${pageInteractionHelpers}
    const pageText = normalize(document.body?.innerText || "");
    const blocked = config.blockedLabels.find((label) => pageText.includes(normalize(label)));
    if (blocked) return { ok: false, stage: "blocked", message: "页面要求人工处理：" + blocked };
    const anchor = bySelectors(["textarea[placeholder*='视频']", "textarea[placeholder*='描述']", "textarea", "[contenteditable='true'][role='textbox']", "[contenteditable='true']"]);
    const model = await selectDolaModel25(anchor);
    if (!model.ok) return model;
    return selectThirtySeconds(anchor);
  })()`;
}

export function buildSubmitScript(adapter: SiteAdapter, task: GenerationTask): string {
  const configuration = JSON.stringify({
    siteId: adapter.id,
    prompt: task.prompt,
    kind: task.kind,
    promptSelectors: adapter.promptSelectors,
    durationSelectors: adapter.durationSelectors,
    ratioSelectors: adapter.ratioSelectors,
    aspectRatio: task.aspectRatio,
    submitSelectors: adapter.submitSelectors,
    submitLabels: adapter.submitLabels,
    durationLabels: adapter.durationLabels,
    blockedLabels: adapter.blockedLabels,
  });

  return `(async () => {
    const config = ${configuration};
    ${pageInteractionHelpers}
    const pageText = normalize(document.body?.innerText || "");
    const blocked = config.blockedLabels.find((label) => pageText.includes(normalize(label)));
    if (blocked) return { ok: false, stage: "blocked", message: "页面要求人工处理：" + blocked };

    let input = bySelectors(config.promptSelectors);
    if (!input) return { ok: false, stage: "prompt", message: "没有找到提示词输入框；请打开 Dola 视频生成页面后重试" };

    const modeLabels = config.kind === "video" ? ["视频", "video", "文生视频"] : ["图片", "图像", "image", "文生图"];
    const videoModeState = () => [...document.querySelectorAll("button, [role='button'], [role='tab'], [data-tag], [class*='tag' i]")]
      .filter(visible)
      .find((element) => {
        const text = elementText(element);
        const identifiesVideo = ["视频", "视频生成", "文生视频", "video", "video generation"].includes(text);
        return identifiesVideo && (selected(element) || ["视频生成", "video generation"].includes(text));
      });
    let activeVideo = config.kind === "video" && Boolean(videoModeState());
    if (!activeVideo) {
      const mode = byLabels(modeLabels, true) || byLabels(modeLabels);
      if (!mode && config.kind === "video") return { ok: false, stage: "mode", message: "没有找到网页内可见的视频模式入口；任务未提交" };
      if (mode) {
        mode.click();
        if (config.kind === "video") {
          activeVideo = Boolean(await waitFor(() => videoModeState(), 2200));
          if (!activeVideo) return { ok: false, stage: "mode", message: "点击了视频模式，但无法确认网页已进入视频生成；任务未提交" };
        } else {
          await sleep(300);
        }
        input = bySelectors(config.promptSelectors) || input;
      }
    }

    if (config.kind === "video") {
      const model = await selectDolaModel25(input);
      if (!model.ok) return model;
      input = bySelectors(config.promptSelectors) || input;
    }

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
    await sleep(250);

    if (config.kind === "video") {
      const duration = await selectThirtySeconds(input);
      if (!duration.ok) return duration;
      const ratio = await selectAspectRatio(input);
      if (!ratio.ok) return ratio;
      if (!videoModeState()) return { ok: false, stage: "mode", message: "提交前最终检查未确认视频模式；任务未提交" };
      const finalModel = findModelTrigger(input);
      if (config.siteId === "dola" && (!finalModel || !isModel25(finalModel))) return { ok: false, stage: "model", message: "提交前最终检查未确认网页模型 2.5；任务未提交" };
      const finalDuration = findDurationTrigger(input);
      if (!finalDuration || !isThirty(finalDuration)) return { ok: false, stage: "duration", message: "提交前最终检查未确认网页原生 30 秒；任务未提交" };
    }

    const localForm = input.closest("form");
    const findComposer = () => {
      if (localForm) return localForm;
      let ancestor = input.parentElement;
      for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
        const rect = ancestor.getBoundingClientRect();
        const buttons = [...ancestor.querySelectorAll("button, [role='button']")].filter(visible);
        if (buttons.length >= 2 && rect.width >= 360 && rect.height <= 300) return ancestor;
      }
      return null;
    };
    const findSubmit = () => {
      const composer = findComposer();
      const local = composer?.querySelector("button[type='submit'], button[aria-label*='发送'], button[aria-label*='生成'], button[aria-label*='send' i], button[aria-label*='create' i]");
      if (local && visible(local)) return local;
      const configured = bySelectors(config.submitSelectors) || byLabels(config.submitLabels);
      if (configured) return configured;
      if (!composer) return null;
      const composerRect = composer.getBoundingClientRect();
      return [...composer.querySelectorAll("button, [role='button']")]
        .filter((candidate) => {
          if (!visible(candidate) || isDurationValue(candidate)) return false;
          const text = elementText(candidate);
          if (text && /(比例|模型|视频|图片|上传|ratio|model|video|image|upload)/i.test(text)) return false;
          const rect = candidate.getBoundingClientRect();
          return rect.width <= 86 && rect.height <= 86 && rect.right >= composerRect.right - 120;
        })
        .sort((left, right) => right.getBoundingClientRect().right - left.getBoundingClientRect().right)[0] || null;
    };
    const submit = await waitFor(() => {
      const candidate = findSubmit();
      if (!candidate) return null;
      if (candidate instanceof HTMLButtonElement && candidate.disabled) return null;
      if (candidate.getAttribute?.("aria-disabled") === "true") return null;
      return candidate;
    }, 2200);
    if (!submit) return { ok: false, stage: "submit", message: "没有找到可用的网页生成按钮；任务未提交" };
    submit.click();
    return { ok: true, stage: "submitted", message: "已在网页内选择 30 秒并通过可见生成按钮提交任务" };
  })()`;
}

export function buildProbeScript(adapter: SiteAdapter): string {
  const configuration = JSON.stringify({
    promptSelectors: adapter.promptSelectors,
    durationSelectors: adapter.durationSelectors,
    blockedLabels: adapter.blockedLabels,
  });
  return `(() => {
    const config = ${configuration};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && element.getClientRects().length > 0;
    };
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const candidates = [...document.querySelectorAll("button, [role='button'], [role='option'], [role='menuitem'], [role='radio'], [role='combobox'], textarea, [contenteditable='true'], [data-value], [data-duration], div, span")].filter(visible);
    const texts = candidates.map((element) => normalize(element.getAttribute?.("aria-label") || element.textContent || "")).filter(Boolean);
    let promptControlVisible = false;
    for (const selector of config.promptSelectors) {
      try { if ([...document.querySelectorAll(selector)].some(visible)) { promptControlVisible = true; break; } } catch {}
    }
    const visibleDurations = [...new Set(texts.flatMap((text) => text.match(/(?:5|10|15|30)\\s*(?:s|秒|seconds?)/gi) || []).map((value) => value.replace(/\\s+/g, "")))];
    const pageText = normalize(document.body?.innerText || "");
    const blockedReason = config.blockedLabels.find((label) => pageText.includes(normalize(label)));
    return {
      url: location.href,
      title: document.title,
      promptControlVisible,
      videoModeVisible: texts.some((text) => /(^|\\s)(视频|video|文生视频)(\\s|$)/i.test(text)),
      model25Visible: texts.some((text) => /2\\.5(?:fast|pro)?/i.test(text)),
      visibleDurations,
      thirtySecondsVisible: visibleDurations.some((value) => /^30(?:s|秒|seconds?)$/i.test(value)),
      ...(blockedReason ? { blockedReason } : {}),
    };
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
