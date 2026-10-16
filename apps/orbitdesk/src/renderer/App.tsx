import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Command,
  Download,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  ListTodo,
  Network,
  Upload,
  MoreHorizontal,
  PanelsTopLeft,
  Pause,
  Play,
  PlugZap,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { adapterFor } from "../adapters/site-adapters";
import { taskStatusLabel } from "../domain/tasks";
import type {
  AspectRatio,
  AssetKind,
  CreateTaskInput,
  CreateWorkspaceInput,
  GenerationTask,
  OrbitApi,
  SiteId,
  StateSnapshot,
  UpdateWorkspaceInput,
  Workspace,
} from "../shared/contracts";
import { createDemoApi } from "./demo-api";

const demoApi = createDemoApi();
const api: OrbitApi = window.orbit ?? demoApi;
const isDesktop = Boolean(window.orbit);
const desktopBridgeMissing = window.location.protocol === "file:" && !window.orbit;

type PageId = "overview" | "workspaces" | "storyboards" | "tasks" | "assets" | "downloads" | "adapters" | "settings";

const navigation: Array<{ id: PageId; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "workspaces", label: "浏览器实例", icon: PanelsTopLeft },
  { id: "storyboards", label: "分镜工作台", icon: Sparkles },
  { id: "tasks", label: "任务队列", icon: ListTodo },
  { id: "assets", label: "素材库", icon: Library },
  { id: "downloads", label: "下载中心", icon: Download },
  { id: "adapters", label: "站点适配", icon: PlugZap },
  { id: "settings", label: "设置与 API", icon: Settings },
];

export function App() {
  if (desktopBridgeMissing) {
    return <FatalState message="桌面安全桥接未加载，已阻止进入演示模式。请安装 0.1.1 或更高版本。" />;
  }
  return <ConnectedApp />;
}

function ConnectedApp() {
  const [state, setState] = useState<StateSnapshot>();
  const [error, setError] = useState<string>();
  const workspaceId = new URLSearchParams(window.location.search).get("workspace");

  useEffect(() => {
    let active = true;
    void api.getState().then((next) => active && setState(next)).catch((reason: unknown) => setError(errorMessage(reason)));
    const unsubscribe = api.onStateChanged((next) => setState(next));
    return () => { active = false; unsubscribe(); };
  }, []);

  if (error) return <FatalState message={error} />;
  if (!state) return <LoadingState />;
  if (workspaceId) return <WorkspaceWindow workspaceId={workspaceId} state={state} />;
  return <Dashboard state={state} />;
}

function Dashboard({ state }: { state: StateSnapshot }) {
  const [page, setPage] = useState<PageId>("overview");
  const [taskModal, setTaskModal] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [toast, setToast] = useState<string>();
  const [query, setQuery] = useState("");

  const run = useCallback(async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work();
      if (success) setToast(success);
    } catch (reason) {
      setToast(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const newTask = () => {
    if (!isDesktop) {
      setToast("网页预览不执行虚拟任务；请安装 Windows 桌面版并登录真实官网");
      return;
    }
    setTaskModal(true);
  };

  const openWorkspace = (workspaceId: string) => {
    if (!isDesktop) {
      const workspace = state.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        setToast("找不到浏览器实例");
        return;
      }
      window.open(workspace.currentUrl ?? workspace.startUrl, "_blank", "noopener,noreferrer");
      setToast(`已在新标签页打开 ${adapterFor(workspace.siteId).name} 官方网页`);
      return;
    }
    void run(() => api.openWorkspace(workspaceId));
  };

  const content = (() => {
    if (page === "overview") return <Overview state={state} query={query} onOpen={openWorkspace} onNewTask={newTask} onNewWorkspace={() => setWorkspaceModal(true)} onPage={setPage} onTaskAction={run} />;
    if (page === "workspaces") return <WorkspacePage state={state} onOpen={openWorkspace} onNew={() => setWorkspaceModal(true)} onAction={run} />;
    if (page === "storyboards") return <StoryboardPage state={state} onAction={run} />;
    if (page === "tasks") return <TaskPage state={state} onNew={newTask} onAction={run} />;
    if (page === "assets") return <AssetsPage state={state} onAction={run} />;
    if (page === "downloads") return <DownloadsPage state={state} onReveal={(id) => run(() => api.revealDownload(id))} />;
    if (page === "adapters") return <AdaptersPage state={state} />;
    return <SettingsPage state={state} onSave={(patch) => run(() => api.updateSettings(patch), "设置已保存")} />;
  })();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav-list" aria-label="主导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => setPage(id)}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
              {id === "tasks" && state.tasks.filter((task) => ["queued", "preparing", "submitting", "awaiting_result"].includes(task.status)).length > 0 && (
                <span className="nav-count">{state.tasks.filter((task) => ["queued", "preparing", "submitting", "awaiting_result"].includes(task.status)).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-card">
          <div className="sidebar-card-icon"><ShieldCheck size={18} /></div>
          <b>本机安全模式</b>
          <p>密码由站点页面处理，应用不采集账号凭据。</p>
        </div>
        <div className="sidebar-profile">
          <div className="avatar">主</div><div><b>主工作档案</b><span>本地会话</span></div><MoreHorizontal size={18} />
        </div>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作区、提示词或文件…" /><kbd>⌘ K</kbd></div>
          <div className="topbar-actions">
            {!isDesktop && <span className="preview-pill"><ExternalLink size={14} />网页预览 · 点击实例打开真实官网</span>}
            <button className="icon-button" aria-label="通知"><Bell size={18} /><i /></button>
            <button className="primary-button compact" onClick={newTask}><Plus size={17} />{isDesktop ? "新建任务" : "任务需桌面版"}</button>
          </div>
        </header>
        <div className="content-stage">{content}</div>
      </main>
      {taskModal && <TaskModal state={state} onClose={() => setTaskModal(false)} onSubmit={async (input) => { await run(() => api.createTasks(input), "任务已加入队列"); setTaskModal(false); }} />}
      {workspaceModal && <WorkspaceModal state={state} onClose={() => setWorkspaceModal(false)} onSubmit={async (input) => { await run(() => api.createWorkspace(input), "浏览器实例已创建"); setWorkspaceModal(false); }} />}
      {toast && <div className="toast"><CircleCheck size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ state, query, onOpen, onNewTask, onNewWorkspace, onPage, onTaskAction }: {
  state: StateSnapshot; query: string; onOpen: (id: string) => void; onNewTask: () => void; onNewWorkspace: () => void;
  onPage: (page: PageId) => void; onTaskAction: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const activeTasks = state.tasks.filter((task) => ["preparing", "submitting", "awaiting_result", "downloading"].includes(task.status));
  const queued = state.tasks.filter((task) => task.status === "queued").length;
  const completed = state.tasks.filter((task) => task.status === "completed").length;
  const completedBytes = state.downloads.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.receivedBytes, 0);
  const visibleWorkspaces = [...state.workspaces].sort((a, b) => a.order - b.order).filter((workspace) => !query || workspace.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>下午好，创作者</h1><p>你的生成窗口、任务与结果都在一处。</p></div><div className="heading-actions"><button className="secondary-button" onClick={onNewWorkspace}><PanelsTopLeft size={17} />新建实例</button><button className="primary-button" onClick={onNewTask}><Plus size={17} />创建生成任务</button></div></section>
      <section className="metric-grid">
        <Metric icon={PanelsTopLeft} color="violet" label="运行实例" value={String(state.workspaces.filter((w) => w.status !== "offline").length)} note={`${state.workspaces.length} 个实例，无数量限制`} trend="实时" />
        <Metric icon={Clock3} color="amber" label="排队任务" value={String(queued + activeTasks.length)} note={`${activeTasks.length} 个正在执行`} trend={activeTasks.length ? "进行中" : "空闲"} />
        <Metric icon={CircleCheck} color="green" label="完成任务" value={String(completed)} note="当前工作记录" trend="已同步" />
        <Metric icon={HardDriveDownload} color="blue" label="已下载" value={formatBytes(completedBytes)} note={`${state.downloads.length} 个媒体文件`} trend="本机" />
      </section>
      <section className="section-block">
        <SectionTitle title="浏览器实例" description="独立登录档案 · 持久 Cookie · 无限创建" action="查看全部" onAction={() => onPage("workspaces")} />
        <div className="workspace-grid">
          {visibleWorkspaces.slice(0, 3).map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} state={state} onOpen={() => onOpen(workspace.id)} />)}
          <button className="new-workspace-card" onClick={onNewWorkspace}><span><Plus size={24} /></span><b>新建浏览器实例</b><small>豆包、Dola 或本地演示</small></button>
        </div>
      </section>
      <div className="overview-columns">
        <section className="panel task-panel">
          <SectionTitle title="任务队列" description="自动提交、检测并下载生成结果" action="查看全部" onAction={() => onPage("tasks")} />
          <div className="task-list">{state.tasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} state={state} onAction={onTaskAction} />)}</div>
        </section>
        <section className="panel automation-panel">
          <div className="automation-orbit"><Sparkles size={28} /><span /><span /></div>
          <p className="eyebrow">30-SECOND VIDEO FLOW</p><h2>30 秒视频自动化</h2><p>批量提示词、页面提交、完成检测和自动下载，一条队列持续运行。</p>
          <ul><li><Check size={14} />使用你的已登录网页会话</li><li><Check size={14} />遇到验证或额度提示立即暂停</li><li><Check size={14} />视频与图片结果自动归档</li></ul>
          <button className="dark-button" onClick={onNewTask}>配置新任务<ArrowUpRight size={17} /></button>
        </section>
      </div>
    </>
  );
}

function Metric({ icon: Icon, color, label, value, note, trend }: { icon: LucideIcon; color: string; label: string; value: string; note: string; trend: string }) {
  return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={20} /></div><div className="metric-label">{label}<span>{trend}</span></div><strong>{value}</strong><p>{note}</p><div className={`metric-line ${color}`} /></article>;
}

function WorkspaceCard({ workspace, state, onOpen, onSettings }: { workspace: Workspace; state: StateSnapshot; onOpen: () => void; onSettings?: () => void }) {
  const adapter = adapterFor(workspace.siteId);
  const profile = state.profiles.find((item) => item.id === workspace.profileId);
  const active = state.tasks.filter((task) => task.workspaceId === workspace.id && !["completed", "cancelled", "failed"].includes(task.status));
  const targetUrl = workspace.currentUrl ?? workspace.startUrl;
  return <article className="workspace-card"><div className="workspace-card-head"><div className="site-mark" style={{ background: adapter.accent }}>{adapter.shortName}</div><div><b>{workspace.name}</b><span>{workspace.group} · {adapter.name} · {profile?.name ?? "独立档案"}</span></div><button className="mini-menu" onClick={onSettings} title={onSettings ? "实例设置" : "实例菜单"}><MoreHorizontal size={18} /></button></div><div className="browser-mini"><div className="browser-mini-bar"><i /><i /><i /><span>{targetUrl}</span></div><div className="browser-mini-body"><div className="mini-glow" style={{ background: adapter.accent }} /><span>{adapter.shortName}</span><small>{workspace.status === "working" ? "任务执行中" : workspace.status === "ready" ? "页面已就绪" : "窗口已休眠"}</small></div></div><div className="workspace-card-foot"><div><StatusDot status={workspace.status} />{workspaceStatusLabel(workspace.status)}<span className="divider" />{active.length} 个任务</div>{isDesktop ? <button onClick={onOpen}>打开<ExternalLink size={14} /></button> : <a href={targetUrl} target="_blank" rel="noreferrer">打开真实官网<ExternalLink size={14} /></a>}</div></article>;
}

function TaskRow({ task, state, onAction }: { task: GenerationTask; state: StateSnapshot; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  const active = ["preparing", "submitting", "awaiting_result", "downloading"].includes(task.status);
  return <article className="task-row"><div className={`task-kind ${task.kind}`} >{task.kind === "video" ? <Video size={18} /> : <ImageIcon size={18} />}</div><div className="task-copy"><div><b>{truncate(task.prompt, 45)}</b><StatusBadge status={task.status} /></div><span>{workspace?.name ?? "未知实例"} · {task.kind === "video" ? `${task.model === "2.5" ? "模型 2.5" : "网页默认模型"} · 30 秒 · ${task.aspectRatio}` : `图片 · ${task.aspectRatio}`}</span>{active && <div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div>}{task.error && <small className="task-error">{task.error}</small>}</div><div className="task-meta"><b>{active ? `${task.progress}%` : relativeTime(task.updatedAt)}</b><span>{active ? "预计时间由站点决定" : taskStatusLabel(task.status)}</span></div><TaskControls task={task} active={active} onAction={onAction} /></article>;
}

function TaskControls({ task, active, onAction }: { task: GenerationTask; active: boolean; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  if (active) return <div className="task-controls">{["preparing", "awaiting_result"].includes(task.status) && <button title="暂停本机自动化" onClick={() => void onAction(() => api.pauseTask(task.id), "任务已暂停")}><Pause size={14} /></button>}<button title="取消本机任务" onClick={() => void onAction(() => api.cancelTask(task.id), "任务已取消")}><X size={14} /></button></div>;
  if (task.status === "queued") return <div className="task-controls"><button title="上移" onClick={() => void onAction(() => api.moveTask(task.id, "up"))}>↑</button><button title="下移" onClick={() => void onAction(() => api.moveTask(task.id, "down"))}>↓</button><button title="取消" onClick={() => void onAction(() => api.cancelTask(task.id), "任务已取消")}><X size={14} /></button></div>;
  if (["paused", "failed", "needs_attention"].includes(task.status)) return <div className="task-controls"><button title="重新排队" onClick={() => void onAction(() => api.resumeTask(task.id), "任务已重新排队")}><Play size={14} /></button><button title="取消" onClick={() => void onAction(() => api.cancelTask(task.id), "任务已取消")}><X size={14} /></button></div>;
  return <button className="row-action"><MoreHorizontal size={16} /></button>;
}

function WorkspacePage({ state, onOpen, onNew, onAction }: { state: StateSnapshot; onOpen: (id: string) => void; onNew: () => void; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [editing, setEditing] = useState<Workspace>();
  const ordered = [...state.workspaces].sort((a, b) => a.order - b.order);
  return <><PageTitle title="浏览器实例" description="每个实例拥有独立持久 Cookie、缓存、代理和明确排序。" action="新建实例" onAction={onNew} /><div className="workspace-grid full">{ordered.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} state={state} onOpen={() => onOpen(workspace.id)} onSettings={() => setEditing(workspace)} />)}<button className="new-workspace-card" onClick={onNew}><span><Plus size={24} /></span><b>新建浏览器实例</b><small>独立会话、分组与代理</small></button></div><InfoStrip icon={ShieldCheck} title="会话隔离原则" text="每个实例使用独立 Electron persistent partition。Cookie 导入导出必须由你显式操作，且只接受实例站点域名。密码只进入官方网页。" />{editing && <WorkspaceSettingsModal workspace={editing} onClose={() => setEditing(undefined)} onSave={async (patch) => { await onAction(() => api.updateWorkspace(editing.id, patch), "实例设置已保存"); setEditing(undefined); }} onAction={onAction} />}</>;
}

function TaskPage({ state, onNew, onAction }: { state: StateSnapshot; onNew: () => void; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const tasks = filter === "all" ? state.tasks : state.tasks.filter((task) => task.status === filter);
  return <><PageTitle title="任务队列" description="每个工作区串行执行，工作区之间按并发上限运行。" action="新建任务" onAction={onNew} /><div className="filter-tabs">{[["all", "全部"], ["queued", "排队"], ["awaiting_result", "生成中"], ["completed", "已完成"], ["needs_attention", "需处理"]].map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><section className="panel table-panel"><div className="task-list large">{tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} state={state} onAction={onAction} />) : <EmptyState icon={ListTodo} title="没有匹配任务" text="调整筛选条件，或创建一个新的生成任务。" />}</div></section></>;
}

function StoryboardPage({ state, onAction }: { state: StateSnapshot; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState("新的 30s 分镜");
  const [workspaceId, setWorkspaceId] = useState(state.workspaces[0]?.id ?? "");
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [script, setScript] = useState("");
  const shots = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const reset = () => { setEditingId(undefined); setName("新的 30s 分镜"); setScript(""); };
  const edit = (id: string) => {
    const board = state.storyboards.find((item) => item.id === id); if (!board) return;
    setEditingId(board.id); setName(board.name); setWorkspaceId(board.workspaceId); setRatio(board.shots[0]?.aspectRatio ?? "16:9"); setScript(board.shots.map((shot) => shot.prompt).join("\n"));
  };
  const save = async () => {
    if (!name.trim() || !workspaceId || !shots.length) return;
    await onAction(() => api.saveStoryboard({ id: editingId, name: name.trim(), workspaceId, shots: shots.map((prompt) => ({ prompt, kind: "video", aspectRatio: ratio })) }), editingId ? "分镜已更新" : "分镜已保存");
    reset();
  };
  return <><PageTitle title="分镜工作台" description="一行一个镜头；保存后可按顺序加入实例队列。" /><div className="storyboard-layout"><section className="panel storyboard-editor"><div className="storyboard-fields"><label>分镜名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label><label>目标实例<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{state.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><label>画面比例<select value={ratio} onChange={(event) => setRatio(event.target.value as AspectRatio)}>{["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => <option key={value}>{value}</option>)}</select></label></div><label className="storyboard-script">镜头提示词<textarea value={script} onChange={(event) => setScript(event.target.value)} placeholder={'远景：清晨城市，镜头缓慢推进…\n中景：角色回头，风吹动衣角…\n特写：眼神与光影细节…'} /></label><div className="storyboard-actions"><span>{shots.length} 个镜头 · 每个视频严格使用网页模型 2.5 / 30s</span>{editingId && <button className="secondary-button" onClick={reset}>取消编辑</button>}<button className="primary-button" disabled={!shots.length || !workspaceId} onClick={() => void save()}>{editingId ? "更新分镜" : "保存分镜"}</button></div></section><section className="storyboard-list">{state.storyboards.length ? state.storyboards.map((board) => { const workspace = state.workspaces.find((item) => item.id === board.workspaceId); return <article className="panel storyboard-card" key={board.id}><div><span className="storyboard-count">{board.shots.length}</span><div><b>{board.name}</b><small>{workspace?.name ?? "实例已删除"} · {relativeTime(board.updatedAt)}</small></div></div><p>{board.shots.slice(0, 3).map((shot, index) => `${index + 1}. ${truncate(shot.prompt, 42)}`).join(" · ")}</p><footer><button onClick={() => edit(board.id)}>编辑</button><button onClick={() => void onAction(() => api.deleteStoryboard(board.id), "分镜已删除")}><Trash2 size={13} />删除</button><button className="queue-board" onClick={() => void onAction(() => api.queueStoryboard(board.id), `${board.shots.length} 个镜头已加入队列`)}><Play size={13} />加入队列</button></footer></article> }) : <div className="panel"><EmptyState icon={Sparkles} title="还没有分镜" text="在左侧输入一行一个镜头，并保存为可复用工作流。" /></div>}</section></div></>;
}

function AssetsPage({ state, onAction }: { state: StateSnapshot; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | AssetKind>("all");
  const assets = state.libraryAssets.filter((asset) => filter === "all" || asset.kind === filter);
  return <><PageTitle title="素材库" description="本机导入和已下载的生成结果统一归档；文件不会上传到 OrbitDesk 服务。" action="导入素材" onAction={() => void onAction(() => api.importLibraryAssets(), "素材已导入")} /><div className="filter-tabs">{[["all", "全部"], ["video", "视频"], ["image", "图片"]].map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id as typeof filter)}>{label}</button>)}</div><div className="library-grid">{assets.map((asset) => <article className="library-card" key={asset.id}><div className={`library-preview ${asset.kind}`}>{asset.kind === "video" ? <Video size={28} /> : <ImageIcon size={28} />}</div><div><b title={asset.name}>{asset.name}</b><small>{formatBytes(asset.bytes)} · {asset.source === "download" ? "生成结果" : "本机导入"}</small><span>{asset.tags.join(" · ")}</span></div><footer><button onClick={() => void onAction(() => api.revealLibraryAsset(asset.id))}><FolderOpen size={13} />定位</button><button onClick={() => void onAction(() => api.removeLibraryAsset(asset.id), "素材记录已移除")}><Trash2 size={13} />移除</button></footer></article>)}{!assets.length && <div className="panel library-empty"><EmptyState icon={Library} title="素材库为空" text="导入视频/图片，或等待生成任务下载结果。" /><button className="primary-button" onClick={() => void onAction(() => api.importLibraryAssets(), "素材已导入")}><Upload size={16} />导入素材</button></div>}</div></>;
}

function DownloadsPage({ state, onReveal }: { state: StateSnapshot; onReveal: (id: string) => void }) {
  return <><PageTitle title="下载中心" description={`结果保存在 ${state.settings.downloadDirectory}`} /><section className="panel download-table"><div className="download-head"><span>文件</span><span>来源实例</span><span>大小</span><span>状态</span><span /></div>{state.downloads.map((item) => { const workspace = state.workspaces.find((w) => w.id === item.workspaceId); return <div className="download-row" key={item.id}><div className="download-file"><span>{/\.(mp4|webm)$/i.test(item.filename) ? <Video size={18} /> : <ImageIcon size={18} />}</span><div><b>{item.filename}</b><small>{relativeTime(item.createdAt)}</small></div></div><span>{workspace?.name ?? "未知实例"}</span><span>{formatBytes(item.totalBytes)}</span><StatusBadge status={item.status === "completed" ? "completed" : item.status === "failed" ? "failed" : "downloading"} /><button className="row-action" onClick={() => onReveal(item.id)} title="在文件夹中显示"><FolderOpen size={16} /></button></div>})}</section></>;
}

function AdaptersPage({ state }: { state: StateSnapshot }) {
  return <><PageTitle title="站点适配" description="适配器只操作当前登录网页的可见 UI，不调用未公开接口。" /><div className="adapter-grid">{state.adapters.map((health) => { const adapter = adapterFor(health.siteId); return <article className="adapter-card" key={health.siteId}><div className="adapter-top"><div className="site-mark large" style={{ background: adapter.accent }}>{adapter.shortName}</div><div><h3>{health.name}</h3><p>{health.baseUrl}</p></div><span className="health-chip"><Wifi size={13} />已配置</span></div><div className="adapter-rule"><span>提示词控件</span><b>{adapter.promptSelectors.length} 条候选规则</b></div><div className="adapter-rule"><span>30 秒选项</span><b>{adapter.durationSelectors.length} 条候选规则</b></div><div className="adapter-rule"><span>结果媒体</span><b>{adapter.mediaSelectors.length} 条检测规则</b></div><p className="adapter-message"><AlertCircle size={14} />{health.lastMessage}</p></article>})}</div><InfoStrip icon={AlertCircle} title="首次使用需要校准" text="豆包和 Dola 页面结构可能随时变化。首个任务请保持窗口可见并确认控件；找不到 30 秒选项时任务会停止，不会改用其他时长或绕过站点限制。" /></>;
}

function SettingsPage({ state, onSave }: { state: StateSnapshot; onSave: (patch: Partial<StateSnapshot["settings"]>) => Promise<void> }) {
  const [settings, setSettings] = useState(state.settings);
  const [showToken, setShowToken] = useState(false);
  return <><PageTitle title="设置与本地 API" description="控制并发、下载以及默认关闭的鉴权回环自动化接口。" /><section className="settings-layout"><div className="panel settings-panel"><SettingRow title="下载目录" description="视频和图片结果的默认保存位置"><div className="path-field"><FolderOpen size={16} /><input value={settings.downloadDirectory} onChange={(e) => setSettings({ ...settings, downloadDirectory: e.target.value })} /></div></SettingRow><SettingRow title="并发工作区" description="不同实例可并行；同一实例保持串行。"><input className="number-input" type="number" min={1} max={8} value={settings.maxConcurrentWorkspaces} onChange={(e) => setSettings({ ...settings, maxConcurrentWorkspaces: Number(e.target.value) })} /></SettingRow><SettingRow title="结果检测间隔" description="频率过高可能增加页面负担。"><select value={settings.resultPollSeconds} onChange={(e) => setSettings({ ...settings, resultPollSeconds: Number(e.target.value) })}><option value={3}>3 秒</option><option value={6}>6 秒</option><option value={10}>10 秒</option><option value={20}>20 秒</option></select></SettingRow><SettingRow title="任务超时" description="超时只停止检测，不会取消站点上的生成。"><select value={settings.taskTimeoutMinutes} onChange={(e) => setSettings({ ...settings, taskTimeoutMinutes: Number(e.target.value) })}><option value={30}>30 分钟</option><option value={45}>45 分钟</option><option value={60}>60 分钟</option><option value={90}>90 分钟</option></select></SettingRow><SettingRow title="完成通知" description="任务检测完成时发送系统通知。"><Toggle checked={settings.notifyOnComplete} onChange={(checked) => setSettings({ ...settings, notifyOnComplete: checked })} /></SettingRow><SettingRow title="本地自动化 API" description="仅绑定 127.0.0.1，所有路由都要求 Bearer Token，默认关闭。"><Toggle checked={settings.automationApiEnabled} onChange={(checked) => setSettings({ ...settings, automationApiEnabled: checked })} /></SettingRow><SettingRow title="API 端口" description="Host 头也必须匹配该回环端口。"><input className="number-input" type="number" min={1024} max={65535} value={settings.automationApiPort} onChange={(event) => setSettings({ ...settings, automationApiPort: Number(event.target.value) })} /></SettingRow><SettingRow title="Bearer Token" description="相当于本机 API 密码；不要粘贴到网页或分享给他人。"><div className="token-field"><code>{showToken ? settings.automationApiToken : "••••••••••••••••••••••••"}</code><button onClick={() => setShowToken((value) => !value)}>{showToken ? "隐藏" : "显示"}</button><button onClick={() => void navigator.clipboard.writeText(settings.automationApiToken)}>复制</button><button onClick={() => { if (window.confirm("轮换 Token 会立即使旧 API 客户端失效，是否继续？")) void api.rotateAutomationApiToken().then((token) => setSettings((value) => ({ ...value, automationApiToken: token }))); }}>轮换</button></div></SettingRow><div className="settings-actions"><button className="primary-button" onClick={() => void onSave(settings)}>保存并应用</button></div></div><aside className="settings-note"><Network size={22} /><h3>最小权限 API</h3><p>接口仅提供健康检查、脱敏状态、任务创建/取消和实例打开。无 Cookie、文件路径、网页脚本执行或任意导航接口。</p><code className="api-endpoint">http://127.0.0.1:{settings.automationApiPort}/v1/health</code><Command size={22} /><h3>自动化边界</h3><p>不处理验证码、不规避付费或额度限制、不调用隐藏接口。无法确认 2.5 / 30s 时会停止。</p></aside></section></>;
}

function WorkspaceWindow({ workspaceId, state }: { workspaceId: string; state: StateSnapshot }) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(workspace?.currentUrl ?? workspace?.startUrl ?? "");
  const [status, setStatus] = useState("正在连接真实网页");
  const [prompt, setPrompt] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [autoDownload, setAutoDownload] = useState(true);
  const [working, setWorking] = useState(false);
  const [panelMessage, setPanelMessage] = useState("Dola 模型 2.5 · 网页内 30 秒控制器已就绪");
  const [assetTab, setAssetTab] = useState<AssetKind>("video");
  const tasks = state.tasks.filter((task) => task.workspaceId === workspaceId && !["completed", "cancelled"].includes(task.status));

  useEffect(() => api.onWorkspaceEvent((event) => {
    if (event.workspaceId !== workspaceId) return;
    if (event.type === "url") setUrl(event.value);
    if (event.type === "status" || event.type === "automation") setStatus(event.value);
  }), [workspaceId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const update = () => {
      const rect = surface.getBoundingClientRect();
      void api.setBrowserBounds(workspaceId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    update();
    return () => observer.disconnect();
  }, [workspaceId]);

  if (!workspace) return <FatalState message="找不到浏览器实例" />;
  const adapter = adapterFor(workspace.siteId);
  const siblingWorkspaces = state.workspaces.filter((item) => item.siteId === workspace.siteId);
  const visibleAssets = state.assets.filter((asset) => asset.workspaceId === workspaceId && asset.kind === assetTab);
  const workspaceDownloads = state.downloads.filter((download) => download.workspaceId === workspaceId);

  const selectThirty = async () => {
    if (!isDesktop) {
      setPanelMessage("网页预览不能操作第三方网页，请使用 Windows 桌面版");
      return false;
    }
    setWorking(true);
    setPanelMessage("正在网页内切换 Dola 模型 2.5，并选择 30s…");
    try {
      const result = await api.selectThirtySeconds(workspaceId);
      setPanelMessage(result.message);
      return result.ok;
    } catch (reason) {
      setPanelMessage(errorMessage(reason));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const submitThirtySecondTasks = async () => {
    if (!prompt.trim()) {
      setPanelMessage("请先填写视频提示词");
      return;
    }
    setWorking(true);
    setPanelMessage("正在通过 Dola 网页选择模型 2.5 和 30s…");
    try {
      const result = await api.selectThirtySeconds(workspaceId);
      if (!result.ok) {
        setPanelMessage(result.message);
        return;
      }
      await api.createTasks({
        workspaceId,
        prompt: prompt.trim(),
        kind: "video",
        durationSeconds: 30,
        quantity,
        autoDownload,
        aspectRatio,
      });
      setPrompt("");
      setPanelMessage(`已锁定 Dola 模型 2.5 / 30s，并加入 ${quantity} 个自动化任务`);
    } catch (reason) {
      setPanelMessage(errorMessage(reason));
    } finally {
      setWorking(false);
    }
  };

  return <div className="studio-window">
    <header className="studio-topbar">
      <div className="studio-title"><div className="studio-logo">O</div><b>OrbitDesk</b><span>30s Studio</span></div>
      <div className="studio-instance-select">{adapter.name} ({siblingWorkspaces.length})<ChevronRight size={13} /></div>
      <div className="studio-browser-buttons"><button onClick={() => void api.browserCommand(workspaceId, "back")}><ArrowLeft size={15} /></button><button onClick={() => void api.browserCommand(workspaceId, "forward")}><ArrowRight size={15} /></button><button onClick={() => void api.browserCommand(workspaceId, "reload")}><RotateCw size={14} /></button><button onClick={() => void api.browserCommand(workspaceId, "home")}><Home size={14} /></button></div>
      <div className="studio-address"><ShieldCheck size={13} /><span>{url}</span></div>
      <div className="studio-page-state"><StatusDot status={workspace.status} /><span>{status}</span></div>
    </header>
    <div className="studio-layout">
      <nav className="studio-rail" aria-label="工作区工具">
        <div className="active"><Sparkles size={17} /><span>创作</span></div>
        <div><ImageIcon size={17} /><span>资产</span></div>
        <div><PanelsTopLeft size={17} /><span>适配</span></div>
        <div><ListTodo size={17} /><span>任务</span></div>
        <div className="rail-spacer" />
        <div><Settings size={17} /><span>设置</span></div>
      </nav>
      <aside className="studio-instances">
        <div className="instance-search"><Search size={13} /><span>搜索实例名称…</span></div>
        <div className="instance-group-title"><span><i />分组 1</span><b>{siblingWorkspaces.length}</b></div>
        <div className="instance-list">
          {siblingWorkspaces.map((item, index) => <button key={item.id} className={item.id === workspaceId ? "active" : ""} onClick={() => void api.openWorkspace(item.id)}><span className="instance-avatar" style={{ background: adapter.accent }}>{adapter.shortName}</span><span><b>{adapter.name}-{index}</b><small>{item.id === workspaceId ? "当前真实网页" : item.name}</small></span><i className={item.status === "offline" ? "off" : "on"}>{item.status === "offline" ? "关" : "开"}</i></button>)}
        </div>
        <div className="instance-tools"><button onClick={() => void api.probeWorkspace(workspaceId).then((probe) => setPanelMessage(`诊断：输入框 ${probe.promptControlVisible ? "✓" : "×"} · 2.5 ${probe.model25Visible ? "✓" : "×"} · 30s ${probe.thirtySecondsVisible ? "✓" : "×"}`)).catch((reason) => setPanelMessage(errorMessage(reason)))}><PlugZap size={12} />诊断页面</button><button onClick={() => void api.exportWorkspaceCookies(workspaceId).then((result) => result && setPanelMessage(`已导出 ${result.exported ?? 0} 条 Cookie`)).catch((reason) => setPanelMessage(errorMessage(reason)))}>导出 Cookie</button><button onClick={() => void api.importWorkspaceCookies(workspaceId).then((result) => result && setPanelMessage(`已导入 ${result.imported ?? 0} 条 Cookie`)).catch((reason) => setPanelMessage(errorMessage(reason)))}>导入 Cookie</button></div><div className="instance-security"><ShieldCheck size={14} /><span>每个实例使用独立持久会话</span></div>
      </aside>
      <main className="studio-center">
        <div className="browser-surface" ref={surfaceRef}>{!isDesktop && <ExternalSiteNotice workspace={workspace} />}</div>
        <section className="automation-dock">
          <div className="dock-status"><span>{panelMessage}</span><div><b>运行 {tasks.length}</b><i />完成 {state.tasks.filter((task) => task.workspaceId === workspaceId && task.status === "completed").length}</div></div>
          <div className="dock-content">
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入分镜或视频描述；任务会直接操作当前 Dola 网页的 30s 选项…" />
            <div className="dock-options">
              <label>数量<input type="number" min={1} max={20} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
              <label>比例<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option></select></label>
              <label className="dock-check"><input type="checkbox" checked={autoDownload} onChange={(event) => setAutoDownload(event.target.checked)} />自动下载</label>
              <button className="duration-button" disabled={working} onClick={() => void selectThirty()}><Clock3 size={15} />模型 2.5 · 30s</button>
              <button className="automation-button" disabled={working || !prompt.trim()} onClick={() => void submitThirtySecondTasks()}><Sparkles size={16} />{working ? "执行中…" : "分镜自动化"}</button>
            </div>
          </div>
        </section>
      </main>
      <aside className="studio-assets">
        <div className="asset-tabs"><button className={assetTab === "video" ? "active" : ""} onClick={() => setAssetTab("video")}>视频</button><button className={assetTab === "image" ? "active" : ""} onClick={() => setAssetTab("image")}>图片</button></div>
        <div className="asset-list">{visibleAssets.length ? visibleAssets.map((asset) => <article key={asset.id}><div>{asset.kind === "video" ? <Video size={18} /> : <ImageIcon size={18} />}</div><b>{asset.kind === "video" ? `${Math.round(asset.durationSeconds ?? 30)}s 视频` : "生成图片"}</b><small>{new Date(asset.detectedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small><button onClick={() => void api.downloadAsset(asset.id)}><Download size={13} />下载</button></article>) : <div className="asset-empty"><HardDriveDownload size={25} /><span>暂无提取资源</span><small>生成完成后自动出现在这里</small></div>}</div>
        <div className="asset-footer"><span>{workspaceDownloads.length} 个下载记录</span>{workspaceDownloads.find((item) => item.status === "completed") && <button onClick={() => { const item = workspaceDownloads.find((download) => download.status === "completed"); if (item) void api.revealDownload(item.id); }}><FolderOpen size={13} />打开目录</button>}</div>
      </aside>
    </div>
  </div>;
}

function ExternalSiteNotice({ workspace }: { workspace: Workspace }) {
  const adapter = adapterFor(workspace.siteId);
  const targetUrl = workspace.currentUrl ?? workspace.startUrl;
  return <div className="external-site-notice"><div className="site-mark large" style={{ background: adapter.accent }}>{adapter.shortName}</div><h2>{adapter.name} 官方网页</h2><p>网页预览不能把第三方登录页面嵌入 Arena。这里不再显示模拟站点；请直接打开真实官网。</p><code>{targetUrl}</code><a className="primary-button" href={targetUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />打开真实官网</a><small>Windows 桌面版会在隔离的 Electron 浏览器窗口中直接加载该地址。</small></div>;
}

function TaskModal({ state, onClose, onSubmit }: { state: StateSnapshot; onClose: () => void; onSubmit: (input: CreateTaskInput) => Promise<void> }) {
  const [workspaceId, setWorkspaceId] = useState(state.workspaces[0]?.id ?? "");
  const [kind, setKind] = useState<AssetKind>("video");
  const [prompt, setPrompt] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [autoDownload, setAutoDownload] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!prompt.trim()) return; setSubmitting(true); try { await onSubmit({ workspaceId, prompt: prompt.trim(), kind, durationSeconds: 30, quantity, autoDownload, aspectRatio }); } finally { setSubmitting(false); } };
  return <Modal title="创建生成任务" subtitle="任务将使用所选实例中已登录的官方网页会话" onClose={onClose}><form onSubmit={(event) => void submit(event)}><label className="form-label">浏览器实例<select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>{state.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} · {adapterFor(workspace.siteId).name}</option>)}</select></label><div className="form-label">生成类型<div className="kind-switch"><button type="button" className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}><Video size={17} />30 秒视频</button><button type="button" className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}><ImageIcon size={17} />图片</button></div></div><label className="form-label">提示词<textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述主体、环境、镜头运动、光线与风格…" maxLength={8000} /><span className="field-count">{prompt.length} / 8000</span></label><div className="form-grid"><label className="form-label">任务数量<input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label><label className="form-label">视频时长<div className="locked-field"><Clock3 size={16} />{kind === "video" ? "30 秒（严格匹配）" : "不适用"}</div></label></div><label className="form-label">画面比例<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>{["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} /><span><b>检测完成后自动下载</b><small>保留原始文件名并写入下载中心</small></span></label><div className="boundary-note"><ShieldCheck size={16} /><span>找不到 30 秒选项、出现验证或额度提示时，任务会暂停等待人工处理。</span></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!prompt.trim() || submitting}>{submitting ? "正在创建…" : "加入任务队列"}</button></div></form></Modal>;
}

function WorkspaceSettingsModal({ workspace, onClose, onSave, onAction }: { workspace: Workspace; onClose: () => void; onSave: (patch: UpdateWorkspaceInput) => Promise<void>; onAction: (work: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [name, setName] = useState(workspace.name);
  const [group, setGroup] = useState(workspace.group);
  const [startUrl, setStartUrl] = useState(workspace.startUrl);
  const [proxyMode, setProxyMode] = useState(workspace.proxy.mode);
  const [proxyServer, setProxyServer] = useState(workspace.proxy.server ?? "");
  const [bypassRules, setBypassRules] = useState(workspace.proxy.bypassRules ?? "<-loopback>");
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave({ name: name.trim(), group: group.trim(), startUrl: startUrl.trim(), proxy: proxyMode === "direct" ? { mode: "direct" } : { mode: "fixed_servers", server: proxyServer.trim(), bypassRules: bypassRules.trim() } }); };
  return <Modal title="实例设置" subtitle="独立会话、官网入口、排序、代理和 Cookie 迁移" onClose={onClose}><form onSubmit={submit}><label className="form-label">实例名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-grid"><label className="form-label">分组<input value={group} onChange={(event) => setGroup(event.target.value)} /></label><label className="form-label">代理模式<select value={proxyMode} onChange={(event) => setProxyMode(event.target.value as typeof proxyMode)}><option value="direct">直连</option><option value="fixed_servers">固定代理</option></select></label></div><label className="form-label">官方站点入口<input value={startUrl} onChange={(event) => setStartUrl(event.target.value)} /></label>{proxyMode === "fixed_servers" && <><label className="form-label">代理服务器<input value={proxyServer} onChange={(event) => setProxyServer(event.target.value)} placeholder="http://127.0.0.1:7890 或 socks5://host:1080" /></label><label className="form-label">绕过规则<input value={bypassRules} onChange={(event) => setBypassRules(event.target.value)} placeholder="<-loopback>" /></label></>}<div className="session-toolbox"><b>会话迁移</b><p>Cookie 文件包含登录凭据。只导入可信文件，使用后妥善保管或删除。</p><div><button type="button" className="secondary-button" onClick={() => void onAction(() => api.exportWorkspaceCookies(workspace.id), "Cookie 已导出")}>导出 Cookie</button><button type="button" className="secondary-button" onClick={() => void onAction(() => api.importWorkspaceCookies(workspace.id), "Cookie 已导入")}>导入 Cookie</button></div></div><div className="instance-order-actions"><button type="button" onClick={() => void onAction(() => api.moveWorkspace(workspace.id, "up"), "实例已上移")}>上移</button><button type="button" onClick={() => void onAction(() => api.moveWorkspace(workspace.id, "down"), "实例已下移")}>下移</button><button type="button" className="danger-link" onClick={() => { if (window.confirm(`确定删除“${workspace.name}”？实例任务和会话入口将被移除。`)) void onAction(() => api.removeWorkspace(workspace.id), "实例已删除").then(onClose); }}><Trash2 size={13} />删除实例</button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!name.trim() || !group.trim() || (proxyMode === "fixed_servers" && !proxyServer.trim())}>保存并应用</button></div></form></Modal>;
}

function WorkspaceModal({ state, onClose, onSubmit }: { state: StateSnapshot; onClose: () => void; onSubmit: (input: CreateWorkspaceInput) => Promise<void> }) {
  const [siteId, setSiteId] = useState<SiteId>("doubao");
  const [profileId, setProfileId] = useState(state.profiles[0]?.id ?? "");
  const [name, setName] = useState("新的创作窗口");
  const [group, setGroup] = useState("默认分组");
  return <Modal title="新建浏览器实例" subtitle="每个实例拥有独立持久会话，可配置分组和代理" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); void onSubmit({ name, siteId, profileId, group }); }}><div className="site-choice">{(["doubao", "dola"] as SiteId[]).map((id) => { const adapter = adapterFor(id); return <button type="button" key={id} className={siteId === id ? "active" : ""} onClick={() => { setSiteId(id); setName(`${adapter.name} 创作窗口`); }}><span className="site-mark" style={{ background: adapter.accent }}>{adapter.shortName}</span><b>{adapter.name}</b><small>{adapter.baseUrl}</small><i><Check size={13} /></i></button>})}</div><label className="form-label">实例名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label><label className="form-label">实例分组<input value={group} onChange={(e) => setGroup(e.target.value)} maxLength={60} /></label><label className="form-label">登录档案<select value={profileId} onChange={(e) => setProfileId(e.target.value)}>{state.profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><div className="boundary-note"><ShieldCheck size={16} /><span>首次打开后请在官方网页中手动登录。OrbitDesk 不读取或保存登录密码。</span></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!name.trim()}>创建实例</button></div></form></Modal>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal"><header><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose}><X size={19} /></button></header>{children}</section></div>;
}

function Brand() { return <div className="brand"><div className="brand-symbol"><span>O</span><i /></div><div><b>OrbitDesk</b><small>AI STUDIO</small></div></div>; }
function PageTitle({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) { return <section className="page-heading small"><div><p className="eyebrow">ORBITDESK CONTROL</p><h1>{title}</h1><p>{description}</p></div>{action && <button className="primary-button" onClick={onAction}><Plus size={17} />{action}</button>}</section>; }
function SectionTitle({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) { return <div className="section-title"><div><h2>{title}</h2><p>{description}</p></div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</div>; }
function InfoStrip({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="info-strip"><span><Icon size={19} /></span><div><b>{title}</b><p>{text}</p></div></div>; }
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><b>{title}</b><p>{description}</p></div>{children}</div>; }
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) { return <button className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button>; }
function EmptyState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="empty-state"><Icon size={26} /><b>{title}</b><p>{text}</p></div>; }
function StatusDot({ status }: { status: Workspace["status"] }) { return <i className={`status-dot ${status}`} />; }
function StatusBadge({ status }: { status: GenerationTask["status"] | "downloading" }) { return <span className={`status-badge ${status}`}>{status === "downloading" ? "下载中" : taskStatusLabel(status)}</span>; }
function LoadingState() { return <div className="loading-state"><div className="brand-symbol"><span>O</span><i /></div><b>正在启动 OrbitDesk</b><span>加载本机工作区…</span></div>; }
function FatalState({ message }: { message: string }) { return <div className="loading-state error"><AlertCircle size={32} /><b>无法启动</b><span>{message}</span></div>; }

function workspaceStatusLabel(status: Workspace["status"]): string { return { offline: "已休眠", opening: "正在打开", ready: "已就绪", working: "任务执行中", needs_attention: "需要处理", error: "异常" }[status]; }
function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length)}…` : value; }
function relativeTime(value: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return "刚刚"; if (minutes < 60) return `${minutes} 分钟前`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} 小时前`; return `${Math.floor(hours / 24)} 天前`; }
function formatBytes(value: number) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
