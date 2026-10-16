import { HttpsError } from "firebase-functions/v2/https";
export const statuses = ["todo", "in_progress", "done", "issue"];
export interface OrderedTask {
  id: string;
  status: string;
  position: number;
  isArchived: boolean;
  deletedAt: string | null;
}
/** Pure planner; caller must read/validate the board version and apply all writes in one transaction. */
export function planOrder(
  tasks: OrderedTask[],
  next: OrderedTask,
  beforeId?: string | null,
) {
  const active = tasks.filter(
    (t) => !t.deletedAt && !t.isArchived && t.id !== next.id,
  );
  const compare = (a: OrderedTask, b: OrderedTask) =>
    a.position - b.position || a.id.localeCompare(b.id);
  const target = active.filter((t) => t.status === next.status).sort(compare);
  if (!next.deletedAt && !next.isArchived) {
    if (active.length >= 300)
      throw new HttpsError(
        "resource-exhausted",
        "보드의 활성 업무는 최대 300개입니다.",
      );
    const at =
      beforeId == null
        ? target.length
        : target.findIndex((t) => t.id === beforeId);
    if (at < 0)
      throw new HttpsError(
        "failed-precondition",
        "conflict: 이동 대상이 변경되었습니다.",
      );
    target.splice(at, 0, next);
  }
  const updates: { id: string; position: number }[] = [];
  let nextPosition = next.position;
  for (const status of statuses) {
    const ordered =
      status === next.status
        ? target
        : active.filter((t) => t.status === status).sort(compare);
    ordered.forEach((t, i) => {
      const position = (i + 1) * 1000;
      if (t.id === next.id) nextPosition = position;
      else if (t.position !== position) updates.push({ id: t.id, position });
    });
  }
  return { updates, nextPosition };
}
