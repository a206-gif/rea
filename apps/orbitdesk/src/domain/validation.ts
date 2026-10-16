import { adapterFor, isAllowedSiteUrl } from "../adapters/site-adapters.js";
import type {
  BrowserBounds,
  CreateTaskInput,
  CreateWorkspaceInput,
  SiteId,
} from "../shared/contracts.js";

const siteIds = new Set<SiteId>(["doubao", "dola", "demo"]);

export function validateWorkspaceInput(value: unknown): CreateWorkspaceInput {
  if (!isRecord(value)) throw new Error("工作区参数无效");
  const name = requiredText(value.name, "工作区名称", 80);
  const profileId = requiredText(value.profileId, "登录档案", 100);
  if (typeof value.siteId !== "string" || !siteIds.has(value.siteId as SiteId)) {
    throw new Error("不支持的站点");
  }
  const siteId = value.siteId as SiteId;
  const startUrl = value.startUrl === undefined ? undefined : requiredText(value.startUrl, "网址", 2048);
  if (startUrl !== undefined && !isAllowedSiteUrl(adapterFor(siteId), startUrl)) {
    throw new Error("网址不属于所选站点的允许域名");
  }
  return { name, profileId, siteId, ...(startUrl ? { startUrl } : {}) };
}

export function validateTaskInput(value: unknown): CreateTaskInput {
  if (!isRecord(value)) throw new Error("任务参数无效");
  const workspaceId = requiredText(value.workspaceId, "工作区", 100);
  const prompt = requiredText(value.prompt, "提示词", 8_000);
  if (value.kind !== "video" && value.kind !== "image") throw new Error("生成类型无效");
  if (value.durationSeconds !== 30) throw new Error("首版仅支持明确选择 30 秒视频");
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("单次任务数量必须为 1 到 20");
  }
  return {
    workspaceId,
    prompt,
    kind: value.kind,
    durationSeconds: 30,
    quantity,
    autoDownload: value.autoDownload !== false,
  };
}

export function validateBounds(value: unknown): BrowserBounds {
  if (!isRecord(value)) throw new Error("浏览器区域无效");
  const result = {
    x: Math.round(Number(value.x)),
    y: Math.round(Number(value.y)),
    width: Math.round(Number(value.width)),
    height: Math.round(Number(value.height)),
  };
  if (
    !Object.values(result).every(Number.isFinite) ||
    result.x < 0 ||
    result.y < 0 ||
    result.width < 120 ||
    result.height < 120 ||
    result.width > 10_000 ||
    result.height > 10_000
  ) {
    throw new Error("浏览器区域超出允许范围");
  }
  return result;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}无效`);
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) throw new Error(`${label}长度无效`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
