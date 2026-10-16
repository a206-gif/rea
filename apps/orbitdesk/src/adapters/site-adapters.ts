import type { SiteId } from "../shared/contracts.js";

export interface SiteAdapter {
  id: SiteId;
  name: string;
  shortName: string;
  baseUrl: string;
  allowedHosts: string[];
  accent: string;
  promptSelectors: string[];
  durationSelectors: string[];
  submitSelectors: string[];
  submitLabels: string[];
  durationLabels: string[];
  completionLabels: string[];
  blockedLabels: string[];
  mediaSelectors: string[];
}

const commonBlockedLabels = [
  "验证码",
  "安全验证",
  "请完成验证",
  "操作频繁",
  "达到上限",
  "需要会员",
  "upgrade",
  "captcha",
  "verify you are human",
  "rate limit",
];

export const siteAdapters: Record<SiteId, SiteAdapter> = {
  doubao: {
    id: "doubao",
    name: "豆包",
    shortName: "豆",
    baseUrl: "https://www.doubao.com/",
    allowedHosts: ["doubao.com", "www.doubao.com"],
    accent: "#6f59e8",
    promptSelectors: [
      "textarea[placeholder*='描述']",
      "textarea[placeholder*='输入']",
      "textarea",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true']",
    ],
    durationSelectors: [
      "button[aria-label*='30']",
      "[role='option'][aria-label*='30']",
      "[data-value='30']",
      "input[value='30']",
    ],
    submitSelectors: [
      "button[data-testid*='generate']",
      "button[aria-label*='生成']",
      "button[type='submit']",
    ],
    submitLabels: ["生成", "开始生成", "立即生成", "创作", "Generate", "Create"],
    durationLabels: ["30 秒", "30秒", "30s", "30 s"],
    completionLabels: ["生成完成", "已完成", "完成", "Completed", "Download"],
    blockedLabels: commonBlockedLabels,
    mediaSelectors: ["video[src]", "video source[src]", "img[src]", "a[download]"],
  },
  dola: {
    id: "dola",
    name: "Dola",
    shortName: "D",
    baseUrl: "https://www.dola.com/",
    allowedHosts: ["dola.com", "www.dola.com"],
    accent: "#e86743",
    promptSelectors: [
      "textarea[placeholder*='prompt' i]",
      "textarea[placeholder*='描述']",
      "textarea",
      "[contenteditable='true'][role='textbox']",
      "[contenteditable='true']",
    ],
    durationSelectors: [
      "button[aria-label*='30']",
      "[role='option'][data-value='30']",
      "[data-duration='30']",
      "input[value='30']",
    ],
    submitSelectors: [
      "button[data-action='generate']",
      "button[aria-label*='generate' i]",
      "button[type='submit']",
    ],
    submitLabels: ["生成", "开始生成", "Generate", "Create", "Submit"],
    durationLabels: ["30 秒", "30秒", "30s", "30 seconds"],
    completionLabels: ["生成完成", "已完成", "Completed", "Ready", "Download"],
    blockedLabels: commonBlockedLabels,
    mediaSelectors: ["video[src]", "video source[src]", "img[src]", "a[download]"],
  },
  demo: {
    id: "demo",
    name: "本地演示",
    shortName: "演",
    baseUrl: "orbitdesk://demo-generator",
    allowedHosts: ["demo-generator"],
    accent: "#2d8f73",
    promptSelectors: ["#prompt"],
    durationSelectors: ["[data-duration='30']"],
    submitSelectors: ["#generate"],
    submitLabels: ["生成"],
    durationLabels: ["30 秒"],
    completionLabels: ["生成完成"],
    blockedLabels: commonBlockedLabels,
    mediaSelectors: ["video[src]", "img.generated-result"],
  },
};

export function adapterFor(siteId: SiteId): SiteAdapter {
  return siteAdapters[siteId];
}

export function isAllowedSiteUrl(adapter: SiteAdapter, rawUrl: string): boolean {
  if (adapter.id === "demo") {
    return rawUrl === adapter.baseUrl;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return adapter.allowedHosts.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}
