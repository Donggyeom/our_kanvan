import { test } from "node:test";
import assert from "node:assert/strict";
import { todaySeoul, overdue, STATUSES } from "../src/types.ts";
test("Seoul date boundary and overdue policy exclude Done and missing deadlines", () => {
  const OriginalDate = globalThis.Date;
  try {
    globalThis.Date = class extends OriginalDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-10-15T15:05:00Z"]));
      }
    };
    assert.equal(todaySeoul(), "2026-10-16");
    assert.equal(overdue({ status: "todo", dueDate: "2026-10-15" }), true);
    assert.equal(overdue({ status: "done", dueDate: "2026-10-15" }), false);
    assert.equal(overdue({ status: "issue", dueDate: null }), false);
    assert.equal(
      overdue({ status: "in_progress", dueDate: "2026-10-16" }),
      false,
    );
    assert.equal(overdue({ status: "issue", dueDate: "2026-10-17" }), false);
    assert.equal(STATUSES.length, 4);
  } finally {
    globalThis.Date = OriginalDate;
  }
});
