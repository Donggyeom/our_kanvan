import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { planOrder } = createRequire(import.meta.url)(
  "../functions/lib/ordering.js",
);
const task = (id, status = "todo", position = 1000) => ({
  id,
  status,
  position,
  isArchived: false,
  deletedAt: null,
});
function apply(tasks, next, beforeId) {
  const plan = planOrder(tasks, next, beforeId);
  return [
    ...tasks
      .filter((t) => t.id !== next.id)
      .map((t) => ({
        ...t,
        position:
          plan.updates.find((u) => u.id === t.id)?.position ?? t.position,
      })),
    { ...next, position: plan.nextPosition },
  ];
}
const ids = (tasks, status = "todo") =>
  tasks
    .filter((t) => t.status === status && !t.deletedAt && !t.isArchived)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.id);
test("same-column move inserts at requested anchor without numeric collisions", () => {
  const tasks = [task("A"), task("B", "todo", 2000), task("C", "todo", 3000)];
  const result = apply(tasks, tasks[2], "A");
  assert.deepEqual(ids(result), ["C", "A", "B"]);
  assert.deepEqual(
    result.map((t) => t.position).sort((a, b) => a - b),
    [1000, 2000, 3000],
  );
  assert.equal(tasks[0].position, 1000);
});
test("cross-column move closes source gaps and inserts before target", () => {
  const tasks = [task("A"), task("B", "todo", 2000), task("C", "issue", 1000)];
  const result = apply(tasks, { ...tasks[0], status: "issue" }, "C");
  assert.deepEqual(ids(result), ["B"]);
  assert.deepEqual(ids(result, "issue"), ["A", "C"]);
  assert.equal(result.find((t) => t.id === "B").position, 1000);
});
test("empty-column move starts at 1000; append follows last card", () => {
  const tasks = [task("A")];
  let result = apply(tasks, { ...tasks[0], status: "done" }, null);
  assert.deepEqual(ids(result, "done"), ["A"]);
  result = apply(result, task("B", "done"), null);
  assert.deepEqual(ids(result, "done"), ["A", "B"]);
  assert.equal(result.find((t) => t.id === "B").position, 2000);
});
test("deleted/archived cards do not consume active positions and invalid anchors fail", () => {
  const tasks = [
    task("A"),
    { ...task("B"), isArchived: true },
    { ...task("C"), deletedAt: "2026-10-16" },
  ];
  const result = apply(tasks, task("D"), null);
  assert.deepEqual(ids(result), ["A", "D"]);
  assert.throws(
    () => planOrder(tasks, task("D"), "B"),
    (e) => e.code === "failed-precondition",
  );
  assert.equal(tasks[0].position, 1000);
});
test("legacy equal/fractional positions normalize deterministically by ID", () => {
  const result = apply(
    [task("B", "todo", 0.01), task("A", "todo", 0.01)],
    task("C"),
    null,
  );
  assert.deepEqual(ids(result), ["A", "B", "C"]);
  assert.deepEqual(
    result.map((t) => t.position).sort((a, b) => a - b),
    [1000, 2000, 3000],
  );
});
test("300 cards permit movement and archiving but block creation/restoration of a 301st", () => {
  const tasks = Array.from({ length: 300 }, (_, i) =>
    task("card-" + i, "todo", (i + 1) * 1000),
  );
  assert.doesNotThrow(() =>
    planOrder(tasks, { ...tasks[0], status: "issue" }, null),
  );
  assert.doesNotThrow(() =>
    planOrder(tasks, { ...tasks[0], isArchived: true }),
  );
  assert.throws(
    () => planOrder(tasks, task("extra")),
    (e) => e.code === "resource-exhausted",
  );
  const fewer = apply(tasks, { ...tasks[0], isArchived: true });
  assert.doesNotThrow(() => planOrder(fewer, task("extra")));
});
test("repeated multi-column moves keep all active positions unique and all cards present", () => {
  let tasks = Array.from({ length: 40 }, (_, i) =>
    task("card-" + i, "todo", (i + 1) * 1000),
  );
  const statuses = ["todo", "in_progress", "done", "issue"];
  for (let i = 0; i < 200; i++) {
    const t = tasks.find((t) => t.id === "card-" + (i % 40));
    tasks = apply(tasks, { ...t, status: statuses[i % 4] }, null);
    assert.equal(new Set(tasks.map((t) => t.id)).size, 40);
    for (const s of statuses) {
      const positions = tasks
        .filter((t) => t.status === s)
        .map((t) => t.position);
      assert.equal(new Set(positions).size, positions.length);
    }
  }
});
