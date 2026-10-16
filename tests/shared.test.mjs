import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
const dir = mkdtempSync(join(tmpdir(), "flowboard-shared-"));
const port = 3881,
  origin = `http://127.0.0.1:${port}`;
const password = "Shared-test-password-2026";
let server,
  logs = "",
  admin,
  member,
  invitation,
  task;
async function start() {
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_EMAIL: "owner@example.com",
      ADMIN_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/healthz")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Server failed to start: " + logs);
}
async function stop() {
  if (server && server.exitCode === null) {
    const done = once(server, "exit");
    server.kill("SIGTERM");
    await done;
  }
}
function client() {
  let cookie = "";
  return {
    async rpc(method, args = [], extra = {}) {
      const response = await fetch(origin + "/api/rpc", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
          ...extra,
        },
        body: JSON.stringify({ method, args }),
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, ...(await response.json()) };
    },
    async snapshot() {
      return (
        await (
          await fetch(origin + "/api/snapshot", { headers: { Cookie: cookie } })
        ).json()
      ).snapshot;
    },
  };
}
before(async () => {
  await start();
  admin = client();
  member = client();
});
after(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});
test("anonymous users cannot read or change board data; CSRF is rejected", async () => {
  const guest = client();
  assert.equal((await guest.snapshot()).boards.length, 0);
  assert.equal((await guest.rpc("createBoard", ["bad", ""])).status, 401);
  assert.equal(
    (await guest.rpc("logout", [], { Origin: "https://evil.example" })).status,
    403,
  );
});
test("real password authentication and HttpOnly session login", async () => {
  assert.equal(
    (await admin.rpc("login", ["owner@example.com", "wrong-password"])).status,
    401,
  );
  const result = await admin.rpc("login", ["owner@example.com", password]);
  assert.equal(result.status, 200);
  assert.equal(result.snapshot.user.role, "admin");
});
test("hashed, single-use invitation registers a distinct member and grants shared access", async () => {
  const invite = await admin.rpc("invite", ["member@example.com"]);
  assert.equal(invite.status, 200);
  invitation = new URL(invite.result, origin).searchParams.get("invite");
  const guest = client();
  assert.equal(
    (
      await guest.rpc("register", [
        "Blocked",
        "blocked@example.com",
        password,
        "wrong",
      ])
    ).status,
    403,
  );
  const signup = await member.rpc("register", [
    "팀원",
    "member@example.com",
    password,
    invitation,
  ]);
  assert.equal(signup.status, 200);
  assert.equal(signup.snapshot.boards.length, 0);
  const accepted = await member.rpc("acceptInvite", [invitation]);
  assert.equal(accepted.status, 200);
  assert.ok(accepted.snapshot.boards.length > 0);
  assert.equal(accepted.snapshot.user.role, "member");
  assert.notEqual(accepted.snapshot.user.id, (await admin.snapshot()).user.id);
  assert.notEqual((await member.rpc("acceptInvite", [invitation])).status, 200);
  assert.ok(
    !readFileSync(join(dir, "flowboard.json"), "utf8").includes(invitation),
  );
});
test("members cannot perform admin operations or forge task roles and version fields", async () => {
  const snap = await member.snapshot();
  const board = snap.boards[0];
  assert.equal(
    (await member.rpc("createBoard", ["forbidden", ""])).status,
    403,
  );
  assert.equal((await member.rpc("invite", ["other@example.com"])).status, 403);
  assert.equal(
    (await member.rpc("updateBoard", [board.id, { memberIds: [] }])).status,
    403,
  );
  assert.equal(
    (
      await member.rpc("updateTask", [
        snap.tasks[0].id,
        snap.tasks[0].version,
        { version: 999 },
      ])
    ).status,
    400,
  );
  assert.equal((await member.rpc("__proto__", [])).status, 403);
});
test("member creates a card and another user receives it with change history", async () => {
  const board = (await member.snapshot()).boards[0];
  const created = await member.rpc("createTask", [
    board.id,
    {
      title: "공유 검증 카드",
      description: "shared",
      assigneeId: null,
      status: "todo",
      priority: "medium",
      dueDate: null,
    },
  ]);
  assert.equal(created.status, 200);
  task = (await admin.snapshot()).tasks.find(
    (t) => t.title === "공유 검증 카드",
  );
  assert.ok(task);
  assert.ok((await admin.snapshot()).history.some((h) => h.taskId === task.id));
});
test("simultaneous edits reject the stale writer and preserve exactly one change", async () => {
  const results = await Promise.all([
    admin.rpc("updateTask", [task.id, task.version, { title: "경합 A" }]),
    member.rpc("updateTask", [task.id, task.version, { title: "경합 B" }]),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const current = (await member.snapshot()).tasks.find((t) => t.id === task.id);
  assert.equal(current.version, task.version + 1);
});
test("simultaneous moves reject stale order versions and preserve unique positions", async () => {
  const snap = await admin.snapshot();
  const current = snap.tasks.find((t) => t.id === task.id);
  const board = snap.boards.find((b) => b.id === current.boardId);
  const args = [
    current.id,
    current.version,
    "in_progress",
    null,
    board.orderVersion || 0,
  ];
  const results = await Promise.all([
    admin.rpc("moveTask", args),
    member.rpc("moveTask", args),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const after = await member.snapshot();
  const positions = after.tasks
    .filter(
      (t) =>
        t.boardId === board.id &&
        t.status === "in_progress" &&
        !t.deletedAt &&
        !t.isArchived,
    )
    .map((t) => t.position);
  assert.equal(new Set(positions).size, positions.length);
});
test("removing a member from a board revokes snapshot and write access", async () => {
  const snap = await admin.snapshot();
  const board = snap.boards[0];
  const user = (await member.snapshot()).user;
  assert.equal(
    (
      await admin.rpc("updateBoard", [
        board.id,
        { memberIds: board.memberIds.filter((id) => id !== user.id) },
      ])
    ).status,
    200,
  );
  assert.ok(!(await member.snapshot()).boards.some((b) => b.id === board.id));
  const current = (await admin.snapshot()).tasks.find((t) => t.id === task.id);
  assert.notEqual(
    (
      await member.rpc("updateTask", [
        current.id,
        current.version,
        { title: "forbidden" },
      ])
    ).status,
    200,
  );
  assert.equal(
    (await admin.rpc("updateBoard", [board.id, { memberIds: board.memberIds }]))
      .status,
    200,
  );
});
test("server restart retains shared cards, accounts, history and valid sessions", async () => {
  const before = await admin.snapshot();
  await stop();
  await start();
  const after = await admin.snapshot();
  assert.equal(after.user.id, before.user.id);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.history, before.history);
  const raw = readFileSync(join(dir, "flowboard.json"), "utf8");
  assert.ok(!raw.includes(password));
  assert.ok(!raw.includes(invitation));
});
test("two real browser users see shared creation and edits without reloading", async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
  });
  try {
    const ownerPage = await browser.newPage();
    const memberPage = await browser.newPage();
    for (const [page, email] of [
      [ownerPage, "owner@example.com"],
      [memberPage, "member@example.com"],
    ]) {
      await page.goto(origin);
      await page.getByLabel("이메일", { exact: true }).fill(email);
      await page.getByLabel("비밀번호", { exact: true }).fill(password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: /신규 서비스 개발/ }),
      ).toBeVisible();
    }
    await memberPage
      .getByRole("button", { name: "새 업무", exact: false })
      .click();
    await memberPage
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("두 브라우저 공유");
    await memberPage
      .getByRole("button", { name: "업무 등록", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "두 브라우저 공유", exact: true }),
    ).toBeVisible({ timeout: 5000 });
    await ownerPage
      .getByRole("button", { name: "두 브라우저 공유", exact: true })
      .click();
    await ownerPage
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("실시간 수정 반영");
    await ownerPage
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(
      memberPage.getByRole("button", { name: "실시간 수정 반영", exact: true }),
    ).toBeVisible({ timeout: 5000 });
    for (const width of [390, 768, 1280]) {
      await memberPage.setViewportSize({ width, height: 900 });
      assert.ok(
        await memberPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await memberPage.screenshot({
        path: `artifacts/shared-${width}.png`,
        fullPage: true,
      });
    }
    await memberPage.reload();
    await expect(
      memberPage.getByRole("button", { name: "실시간 수정 반영", exact: true }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("invitation link completes real browser signup and joins the shared board", async () => {
  const invite = await admin.rpc("invite", ["browser-invite@example.com"]);
  assert.equal(invite.status, 200);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(new URL(invite.result, origin).href);
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByLabel("이름", { exact: true }).fill("초대 사용자");
    await page
      .getByLabel("이메일", { exact: true })
      .fill("browser-invite@example.com");
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /신규 서비스 개발/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "실시간 수정 반영", exact: true }),
    ).toBeVisible();
    assert.equal(new URL(page.url()).search, "");
  } finally {
    await browser.close();
  }
});
