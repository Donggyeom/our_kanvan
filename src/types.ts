export type Status = "todo" | "in_progress" | "done" | "issue";
export type Priority = "high" | "medium" | "low";
export type Role = "admin" | "member";
export interface User {
  id: string;
  email: string;
  displayName: string;
  workspaceId: string;
  role: Role;
  createdAt?: unknown;
  updatedAt?: unknown;
}
export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  memberIds: string[];
  createdBy: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderVersion?: number;
}
export interface Task {
  id: string;
  workspaceId: string;
  boardId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  position: number;
  version: number;
  isArchived: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface History {
  id: string;
  taskId: string;
  actorId: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}
export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  link?: string;
}
export type TaskInput = Pick<
  Task,
  "title" | "description" | "assigneeId" | "status" | "priority" | "dueDate"
>;
export const STATUSES: Status[] = ["todo", "in_progress", "done", "issue"];
export const LABELS: Record<Status, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  issue: "Issue",
};
export const PRIORITY: Record<Priority, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
export const todaySeoul = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const overdue = (t: Task) =>
  !!t.dueDate && t.dueDate < todaySeoul() && t.status !== "done";
export const dateText = (value: string | null) =>
  value
    ? `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`
    : "기한 없음";
export class ConflictError extends Error {
  constructor() {
    super(
      "다른 사용자가 먼저 수정했습니다. 최신 내용을 확인하고 다시 수정해 주세요.",
    );
    this.name = "ConflictError";
  }
}
