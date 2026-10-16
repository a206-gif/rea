import { adapterFor, isAllowedSiteUrl } from "../adapters/site-adapters.js";
import type {
  AppSettings,
  AspectRatio,
  BrowserBounds,
  CreateTaskInput,
  CreateWorkspaceInput,
  ProxyConfig,
  SaveStoryboardInput,
  SiteId,
  UpdateWorkspaceInput,
} from "../shared/contracts.js";

const siteIds = new Set<SiteId>(["doubao", "dola", "demo"]);
const aspectRatios = new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:3", "3:4"]);

export function validateWorkspaceInput(value: unknown): CreateWorkspaceInput {
  if (!isRecord(value)) throw new Error("工作区参数无效");
  const name = requiredText(value.name, "工作区名称", 80);
  const profileId = requiredText(value.profileId, "登录档案", 100);
  if (typeof value.siteId !== "string" || !siteIds.has(value.siteId as SiteId)) throw new Error("不支持的站点");
  const siteId = value.siteId as SiteId;
  const startUrl = optionalSiteUrl(value.startUrl, siteId);
  const group = value.group === undefined ? undefined : requiredText(value.group, "实例分组", 60);
  const proxy = value.proxy === undefined ? undefined : validateProxy(value.proxy);
  return { name, profileId, siteId, ...(startUrl ? { startUrl } : {}), ...(group ? { group } : {}), ...(proxy ? { proxy } : {}) };
}

export function validateWorkspaceUpdate(value: unknown, siteId: SiteId): UpdateWorkspaceInput {
  if (!isRecord(value)) throw new Error("实例设置无效");
  const result: UpdateWorkspaceInput = {};
  if (value.name !== undefined) result.name = requiredText(value.name, "工作区名称", 80);
  if (value.group !== undefined) result.group = requiredText(value.group, "实例分组", 60);
  if (value.startUrl !== undefined) result.startUrl = optionalSiteUrl(value.startUrl, siteId);
  if (value.proxy !== undefined) result.proxy = validateProxy(value.proxy);
  if (Object.keys(result).length === 0) throw new Error("没有可更新的实例设置");
  return result;
}

export function validateProxy(value: unknown): ProxyConfig {
  if (!isRecord(value) || (value.mode !== "direct" && value.mode !== "fixed_servers")) throw new Error("代理配置无效");
  if (value.mode === "direct") return { mode: "direct" };
  const server = requiredText(value.server, "代理服务器", 300);
  if (!/^(https?|socks4|socks5):\/\/[a-z0-9._\-\[\]:]+$/i.test(server)) {
    throw new Error("代理服务器必须是 http(s)://主机:端口 或 socks5://主机:端口");
  }
  const bypassRules = value.bypassRules === undefined ? undefined : requiredText(value.bypassRules, "代理绕过规则", 1_000);
  return { mode: "fixed_servers", server, ...(bypassRules ? { bypassRules } : {}) };
}

export function validateTaskInput(value: unknown): CreateTaskInput {
  if (!isRecord(value)) throw new Error("任务参数无效");
  const workspaceId = requiredText(value.workspaceId, "工作区", 100);
  const prompt = requiredText(value.prompt, "提示词", 8_000);
  if (value.kind !== "video" && value.kind !== "image") throw new Error("生成类型无效");
  if (value.durationSeconds !== 30) throw new Error("视频任务必须明确选择网页原生 30 秒选项");
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("单次任务数量必须为 1 到 20");
  const aspectRatio = value.aspectRatio === undefined ? "16:9" : value.aspectRatio;
  if (typeof aspectRatio !== "string" || !aspectRatios.has(aspectRatio as AspectRatio)) throw new Error("画面比例无效");
  const storyboardId = value.storyboardId === undefined ? undefined : requiredText(value.storyboardId, "分镜", 100);
  const shotId = value.shotId === undefined ? undefined : requiredText(value.shotId, "镜头", 100);
  return {
    workspaceId,
    prompt,
    kind: value.kind,
    durationSeconds: 30,
    quantity,
    autoDownload: value.autoDownload !== false,
    aspectRatio: aspectRatio as AspectRatio,
    ...(storyboardId ? { storyboardId } : {}),
    ...(shotId ? { shotId } : {}),
  };
}

export function validateStoryboardInput(value: unknown): SaveStoryboardInput {
  if (!isRecord(value) || !Array.isArray(value.shots)) throw new Error("分镜参数无效");
  const id = value.id === undefined ? undefined : requiredText(value.id, "分镜编号", 100);
  const name = requiredText(value.name, "分镜名称", 100);
  const workspaceId = requiredText(value.workspaceId, "浏览器实例", 100);
  if (value.shots.length < 1 || value.shots.length > 50) throw new Error("每个分镜需要 1 到 50 个镜头");
  const shots = value.shots.map((shot, index) => {
    if (!isRecord(shot)) throw new Error(`第 ${index + 1} 个镜头无效`);
    const shotId = shot.id === undefined ? undefined : requiredText(shot.id, "镜头编号", 100);
    const prompt = requiredText(shot.prompt, `第 ${index + 1} 个镜头提示词`, 8_000);
    if (shot.kind !== "video" && shot.kind !== "image") throw new Error(`第 ${index + 1} 个镜头类型无效`);
    const kind: "video" | "image" = shot.kind;
    if (typeof shot.aspectRatio !== "string" || !aspectRatios.has(shot.aspectRatio as AspectRatio)) throw new Error(`第 ${index + 1} 个镜头画面比例无效`);
    return { ...(shotId ? { id: shotId } : {}), prompt, kind, aspectRatio: shot.aspectRatio as AspectRatio };
  });
  return { ...(id ? { id } : {}), name, workspaceId, shots };
}

export function validateSettingsPatch(value: unknown, current: AppSettings): Partial<AppSettings> {
  if (!isRecord(value)) throw new Error("设置无效");
  const patch: Partial<AppSettings> = {};
  if (value.downloadDirectory !== undefined) patch.downloadDirectory = requiredText(value.downloadDirectory, "下载目录", 1_000);
  if (value.maxConcurrentWorkspaces !== undefined) patch.maxConcurrentWorkspaces = integerBetween(value.maxConcurrentWorkspaces, 1, 8, "并发工作区");
  if (value.resultPollSeconds !== undefined) patch.resultPollSeconds = integerBetween(value.resultPollSeconds, 3, 120, "检测间隔");
  if (value.taskTimeoutMinutes !== undefined) patch.taskTimeoutMinutes = integerBetween(value.taskTimeoutMinutes, 5, 240, "任务超时");
  if (value.automationApiPort !== undefined) patch.automationApiPort = integerBetween(value.automationApiPort, 1_024, 65_535, "本地 API 端口");
  for (const field of ["openWorkspaceOnTask", "notifyOnComplete", "automationApiEnabled"] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "boolean") throw new Error(`${field} 必须是布尔值`);
      patch[field] = value[field];
    }
  }
  if (value.theme !== undefined) {
    if (!["light", "dark", "system"].includes(String(value.theme))) throw new Error("主题无效");
    patch.theme = value.theme as AppSettings["theme"];
  }
  // A renderer cannot replace the bearer token. It is generated in the trusted main process.
  patch.automationApiToken = current.automationApiToken;
  return patch;
}

export function validateBounds(value: unknown): BrowserBounds {
  if (!isRecord(value)) throw new Error("浏览器区域无效");
  const result = { x: Math.round(Number(value.x)), y: Math.round(Number(value.y)), width: Math.round(Number(value.width)), height: Math.round(Number(value.height)) };
  if (!Object.values(result).every(Number.isFinite) || result.x < 0 || result.y < 0 || result.width < 120 || result.height < 120 || result.width > 10_000 || result.height > 10_000) {
    throw new Error("浏览器区域超出允许范围");
  }
  return result;
}

function optionalSiteUrl(value: unknown, siteId: SiteId): string | undefined {
  if (value === undefined) return undefined;
  const url = requiredText(value, "网址", 2_048);
  if (!isAllowedSiteUrl(adapterFor(siteId), url)) throw new Error("网址不属于所选站点的允许域名");
  return url;
}

function integerBetween(value: unknown, minimum: number, maximum: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${label}必须介于 ${minimum} 和 ${maximum} 之间`);
  return number;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}无效`);
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) throw new Error(`${label}长度无效`);
  return text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
