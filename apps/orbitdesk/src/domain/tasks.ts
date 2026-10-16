import type { GenerationTask, TaskStatus } from "../shared/contracts.js";

const transitions: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(["preparing", "paused", "cancelled"]),
  preparing: new Set(["submitting", "paused", "needs_attention", "failed", "cancelled"]),
  submitting: new Set(["awaiting_result", "needs_attention", "failed", "cancelled"]),
  awaiting_result: new Set(["downloading", "completed", "paused", "needs_attention", "failed", "cancelled"]),
  downloading: new Set(["completed", "failed", "cancelled"]),
  completed: new Set([]),
  paused: new Set(["queued", "cancelled"]),
  needs_attention: new Set(["queued", "cancelled"]),
  failed: new Set(["queued", "cancelled"]),
  cancelled: new Set([]),
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].has(to);
}

export function transitionTask(
  task: GenerationTask,
  status: TaskStatus,
  patch: Partial<GenerationTask> = {},
  now = new Date().toISOString(),
): GenerationTask {
  if (task.status !== status && !canTransitionTask(task.status, status)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${status}`);
  }

  const progressByStatus: Partial<Record<TaskStatus, number>> = {
    queued: 0,
    preparing: 8,
    submitting: 18,
    awaiting_result: 42,
    downloading: 88,
    completed: 100,
  };

  return {
    ...task,
    ...patch,
    status,
    progress: patch.progress ?? progressByStatus[status] ?? task.progress,
    updatedAt: now,
    ...(status === "preparing" && task.startedAt === undefined ? { startedAt: now } : {}),
    ...(status === "completed" ? { completedAt: now, error: undefined } : {}),
  };
}

export function runnableTasks(tasks: readonly GenerationTask[]): GenerationTask[] {
  return tasks
    .filter((task) => task.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function taskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    queued: "排队中",
    preparing: "准备页面",
    submitting: "正在提交",
    awaiting_result: "等待生成",
    downloading: "正在下载",
    completed: "已完成",
    paused: "已暂停",
    needs_attention: "需要处理",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status];
}
