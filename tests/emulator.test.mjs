import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  getDoc,
  getDocs,
  doc,
  collection,
  query,
  where,
  setDoc,
  onSnapshot,
} from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import { createRequire } from "node:module";
const requireFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const { initializeApp: initAdmin, deleteApp: deleteAdmin } =
  requireFunctions("firebase-admin/app");
const { getFirestore: adminStore, Timestamp } = requireFunctions(
  "firebase-admin/firestore",
);

// Never connect test writers to a real project, and never clear any existing data.
assert.equal(process.env.GCLOUD_PROJECT, "demo-flowboard");
assert.match(
  process.env.FIRESTORE_EMULATOR_HOST || "",
  /^(127\.0\.0\.1|localhost):8080$/,
);
const run = Date.now().toString(36),
  apps = [];
const adminApp = initAdmin({ projectId: "demo-flowboard" }, `tests-${run}`),
  dbAdmin = adminStore(adminApp);
async function account(label, register = true) {
  const app = initializeApp(
    {
      apiKey: "demo-flowboard-key",
      projectId: "demo-flowboard",
      appId: "demo",
    },
    `${label}-${run}-${apps.length}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const call = async (name, data = {}) =>
    (await httpsCallable(functions, name)(data)).data;
  const email = `${label}-${run}@example.com`;
  if (register) {
    await createUserWithEmailAndPassword(auth, email, "Test-password-123");
    await call("registerUser", { displayName: label });
  }
  return {
    app,
    auth,
    db,
    call,
    email,
    get uid() {
      return auth.currentUser?.uid;
    },
  };
}
const failure = async (p, code) =>
  assert.rejects(p, (e) => e.code === code, `expected ${code}`);
let owner, member, outsider, anonymous, board, workspace;
const input = (title = "업무") => ({
  title,
  description: "설명",
  assigneeId: null,
  status: "todo",
  priority: "medium",
  dueDate: null,
});
const mutate = (who, op, data = {}) => who.call("mutate", { op, ...data });
const data = async (path) => (await dbAdmin.doc(path).get()).data();
const current = async (id) => ({
  id,
  version: (await data(`tasks/${id}`)).version,
});
const order = async () => (await data(`boards/${board}`)).orderVersion;
async function newTask(title = "업무", extra = {}) {
  return (
    await mutate(owner, "createTask", {
      boardId: board,
      data: { ...input(title), ...extra },
    })
  ).id;
}
async function invite(who) {
  return owner.call("inviteMember", { email: who.email });
}
async function inviteDoc(email) {
  return (
    await dbAdmin
      .collection("invitations")
      .where("workspaceId", "==", workspace)
      .where("email", "==", email)
      .get()
  ).docs[0];
}
before(async () => {
  owner = await account("owner");
  member = await account("member");
  outsider = await account("outsider");
  anonymous = await account("anonymous", false);
  workspace = (await owner.call("createWorkspace", { name: "검증 팀" })).id;
  await outsider.call("createWorkspace", { name: "다른 팀" });
  board = (
    await mutate(owner, "createBoard", {
      name: "검증 보드",
      description: "기본 4열",
    })
  ).id;
  const { token } = await invite(member);
  await member.call("acceptInvitation", { token });
});
after(async () => {
  await Promise.all(apps.map(deleteApp));
  await deleteAdmin(adminApp);
});

test("Auth: incorrect passwords fail; reset and sign-out work; protected callable requires login", async () => {
  const person = await account("auth");
  await sendPasswordResetEmail(person.auth, person.email);
  await signOut(person.auth);
  await failure(
    signInWithEmailAndPassword(person.auth, person.email, "bad-password"),
    "auth/wrong-password",
  );
  await signInWithEmailAndPassword(
    person.auth,
    person.email,
    "Test-password-123",
  );
  await person.call("bootstrap");
  await signOut(person.auth);
  await failure(
    person.call("createWorkspace", { name: "불가" }),
    "functions/unauthenticated",
  );
});
test("Profile bootstrap/register race preserves workspace and role", async () => {
  await Promise.all([
    owner.call("bootstrap"),
    owner.call("registerUser", { displayName: "관리자" }),
  ]);
  const u = await data(`users/${owner.uid}`);
  assert.equal(u.workspaceId, workspace);
  assert.equal(u.role, "admin");
  assert.equal(u.displayName, "관리자");
});
test("Rules: anonymous, outsider and forged cross-workspace reads fail", async () => {
  const task = await newTask();
  await failure(getDoc(doc(anonymous.db, "tasks", task)), "permission-denied");
  await failure(getDoc(doc(outsider.db, "tasks", task)), "permission-denied");
  await failure(getDoc(doc(outsider.db, "boards", board)), "permission-denied");
  const bad = dbAdmin.collection("tasks").doc();
  await bad.set({ ...input(), workspaceId: "forged", boardId: board });
  await failure(getDoc(doc(member.db, "tasks", bad.id)), "permission-denied");
});
test("Rules: constrained member board/task/history queries work, broad queries fail", async () => {
  const bs = await getDocs(
    query(
      collection(member.db, "boards"),
      where("workspaceId", "==", workspace),
      where("memberIds", "array-contains", member.uid),
    ),
  );
  assert.ok(bs.docs.some((d) => d.id === board));
  for (const c of ["tasks", "task_history"])
    assert.ok(
      !(
        await getDocs(
          query(
            collection(member.db, c),
            where("workspaceId", "==", workspace),
            where("boardId", "==", board),
          ),
        )
      ).empty,
    );
  await failure(getDocs(collection(member.db, "boards")), "permission-denied");
  await failure(getDocs(collection(member.db, "tasks")), "permission-denied");
});
test("Rules: every client direct-write path is denied, including own profile and history", async () => {
  for (const c of [
    "users",
    "workspaces",
    "boards",
    "tasks",
    "task_history",
    "invitations",
  ])
    await failure(
      setDoc(doc(owner.db, c, c === "users" ? owner.uid : "forbidden"), {
        role: "admin",
        workspaceId: workspace,
      }),
      "permission-denied",
    );
});
test("Server: members cannot administer boards, invite, archive or delete", async () => {
  const task = await newTask("권한", { status: "done" });
  for (const op of [
    "createBoard",
    "updateBoard",
    "deleteBoard",
    "restoreBoard",
  ])
    await failure(
      mutate(member, op, {
        id: board,
        name: "금지",
        description: "",
        patch: { name: "금지" },
      }),
      "functions/permission-denied",
    );
  await failure(
    member.call("inviteMember", { email: "forbidden@example.com" }),
    "functions/permission-denied",
  );
  for (const op of [
    "archiveTask",
    "deleteTask",
    "restoreTask",
    "unarchiveTask",
  ])
    await failure(
      mutate(member, op, await current(task)),
      "functions/permission-denied",
    );
});
test("Invitation: concurrent duplicate invites have exactly one winner and store only hash", async () => {
  const who = await account("duplicate");
  const result = await Promise.allSettled([invite(who), invite(who)]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  const inv = (await inviteDoc(who.email)).data();
  assert.equal(inv.tokenHash.length, 64);
  assert.equal(inv.token, undefined);
  assert.equal(inv.link, undefined);
  const token = result.find((x) => x.status === "fulfilled").value.token;
  assert.notEqual(inv.tokenHash, token);
  await failure(
    outsider.call("acceptInvitation", { token }),
    "functions/permission-denied",
  );
});
test("Invitation: wrong email, expired and revoked links fail without membership changes", async () => {
  const who = await account("expired"),
    { token } = await invite(who);
  await failure(
    member.call("acceptInvitation", { token }),
    "functions/permission-denied",
  );
  const inv = await inviteDoc(who.email);
  await inv.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await failure(
    who.call("acceptInvitation", { token }),
    "functions/failed-precondition",
  );
  assert.equal((await data(`users/${who.uid}`)).workspaceId, "");
  const fresh = await invite(who);
  await mutate(owner, "revokeInvite", { id: inv.id });
  await failure(
    who.call("acceptInvitation", fresh),
    "functions/failed-precondition",
  );
});
test("Invitation: concurrent single-use acceptance is atomic and grants board access once", async () => {
  const who = await account("accept"),
    payload = await invite(who),
    before = (await data(`workspaces/${workspace}`)).memberCount;
  const r = await Promise.allSettled([
    who.call("acceptInvitation", payload),
    who.call("acceptInvitation", payload),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await data(`workspaces/${workspace}`)).memberCount, before + 1);
  assert.equal((await data(`users/${who.uid}`)).role, "member");
  assert.equal(
    (await data(`boards/${board}`)).memberIds.filter((id) => id === who.uid)
      .length,
    1,
  );
  assert.equal((await inviteDoc(who.email)).data().tokenHash, undefined);
  await failure(invite(who), "functions/already-exists");
});
test("Invitation: revoke/accept race has one terminal outcome without partial membership", async () => {
  const who = await account("revoke-race"),
    payload = await invite(who),
    inv = await inviteDoc(who.email);
  const r = await Promise.allSettled([
    who.call("acceptInvitation", payload),
    mutate(owner, "revokeInvite", { id: inv.id }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const status = (await inv.ref.get()).data().status;
  assert.equal(
    (await data(`users/${who.uid}`)).workspaceId,
    status === "accepted" ? workspace : "",
  );
});
test("Invitation: an account already in another workspace cannot accept", async () => {
  const payload = await invite(outsider);
  await failure(
    outsider.call("acceptInvitation", payload),
    "functions/permission-denied",
  );
});
test("Validation: invalid dates, enum values, protected fields and oversized text are rejected", async () => {
  for (const invalid of [
    { title: " " },
    { title: "x".repeat(151) },
    { description: "x".repeat(5001) },
    { status: "other" },
    { priority: "urgent" },
    { dueDate: "2026-02-30" },
    { dueDate: "invalid" },
    { version: 99 },
    { assigneeId: outsider.uid },
  ])
    await failure(
      mutate(owner, "createTask", {
        boardId: board,
        data: { ...input(), ...invalid },
      }),
      "functions/invalid-argument",
    );
});
test("Board membership changes block reads and writes; other-workspace membership is rejected", async () => {
  const b = (
    await mutate(owner, "createBoard", {
      name: "비공개",
      description: "원자 권한",
    })
  ).id;
  await mutate(owner, "updateBoard", {
    id: b,
    patch: { memberIds: [owner.uid] },
  });
  await failure(getDoc(doc(member.db, "boards", b)), "permission-denied");
  await failure(
    mutate(member, "createTask", { boardId: b, data: input() }),
    "functions/permission-denied",
  );
  await failure(
    mutate(owner, "updateBoard", {
      id: b,
      patch: { memberIds: [owner.uid, outsider.uid] },
    }),
    "functions/invalid-argument",
  );
  await failure(
    mutate(owner, "createTask", {
      boardId: b,
      data: { ...input(), assigneeId: member.uid },
    }),
    "functions/invalid-argument",
  );
});
test("Concurrency: same task edits yield one winner, one conflict, one atomic history change", async () => {
  const task = await newTask("경합"),
    base = await current(task);
  const r = await Promise.allSettled([
    mutate(owner, "updateTask", { ...base, patch: { title: "A" } }),
    mutate(member, "updateTask", { ...base, patch: { title: "B" } }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(
    r.find((x) => x.status === "rejected").reason.message,
    /conflict/,
  );
  const fresh = await data(`tasks/${task}`);
  assert.equal(fresh.version, 2);
  const history = await dbAdmin
    .collection("task_history")
    .where("taskId", "==", task)
    .get();
  assert.equal(history.size, 2);
  assert.equal(
    history.docs.find((d) => d.data().action === "updateTask").data().newValue,
    fresh.title,
  );
});
test("Ordering: same column, cross-column and empty column moves persist dense unique order", async () => {
  const a = await newTask("정렬 A"),
    b = await newTask("정렬 B");
  await mutate(owner, "moveTask", {
    ...(await current(b)),
    status: "todo",
    beforeId: a,
    orderVersion: await order(),
  });
  assert.equal(
    (await dbAdmin.collection("task_history").where("taskId", "==", b).get())
      .size,
    1,
    "pure reorder must not create history",
  );
  assert.ok(
    (await data(`tasks/${b}`)).position < (await data(`tasks/${a}`)).position,
  );
  await mutate(member, "moveTask", {
    ...(await current(a)),
    status: "issue",
    beforeId: null,
    orderVersion: await order(),
  });
  assert.equal((await data(`tasks/${a}`)).status, "issue");
  assert.equal((await data(`tasks/${a}`)).position, 1000);
  await mutate(owner, "moveTask", {
    ...(await current(b)),
    status: "issue",
    beforeId: a,
    orderVersion: await order(),
  });
  assert.equal((await data(`tasks/${b}`)).position, 1000);
  assert.equal((await data(`tasks/${a}`)).position, 2000);
});
test("Ordering: two users moving different cards from the same board version conflict", async () => {
  const a = await newTask("동시 A"),
    b = await newTask("동시 B"),
    orderVersion = await order();
  const r = await Promise.allSettled([
    mutate(owner, "moveTask", {
      ...(await current(a)),
      status: "in_progress",
      beforeId: null,
      orderVersion,
    }),
    mutate(member, "moveTask", {
      ...(await current(b)),
      status: "in_progress",
      beforeId: null,
      orderVersion,
    }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(
    r.find((x) => x.status === "rejected").reason.message,
    /conflict/,
  );
  const active = (
    await dbAdmin.collection("tasks").where("boardId", "==", board).get()
  ).docs
    .map((d) => d.data())
    .filter((t) => !t.deletedAt && !t.isArchived);
  for (const status of ["todo", "in_progress", "done", "issue"]) {
    const p = active.filter((t) => t.status === status).map((t) => t.position);
    assert.equal(new Set(p).size, p.length);
  }
});
test("Ordering: stale target and task versions fail without partial history", async () => {
  const task = await newTask("실패 이동"),
    base = await current(task),
    version = await order();
  await failure(
    mutate(owner, "moveTask", {
      ...base,
      status: "todo",
      beforeId: "missing",
      orderVersion: version,
    }),
    "functions/failed-precondition",
  );
  assert.equal((await current(task)).version, base.version);
  await mutate(member, "updateTask", {
    ...base,
    patch: { description: "새 내용" },
  });
  await failure(
    mutate(owner, "moveTask", {
      ...base,
      status: "done",
      beforeId: null,
      orderVersion: await order(),
    }),
    "functions/failed-precondition",
  );
  const history = await dbAdmin
    .collection("task_history")
    .where("taskId", "==", task)
    .get();
  assert.equal(history.size, 2);
});
test("Lifecycle: archive only Done; restore retains data and all transitions create history", async () => {
  const task = await newTask("복구", {
    assigneeId: member.uid,
    dueDate: "2026-12-31",
  });
  await failure(
    mutate(owner, "archiveTask", await current(task)),
    "functions/failed-precondition",
  );
  await mutate(member, "updateTask", {
    ...(await current(task)),
    patch: { status: "done" },
  });
  await mutate(owner, "archiveTask", await current(task));
  assert.equal((await data(`tasks/${task}`)).isArchived, true);
  await failure(
    mutate(member, "updateTask", {
      ...(await current(task)),
      patch: { title: "금지" },
    }),
    "functions/failed-precondition",
  );
  await mutate(owner, "deleteTask", await current(task));
  await mutate(owner, "restoreTask", await current(task));
  assert.equal((await data(`tasks/${task}`)).isArchived, true);
  await mutate(owner, "unarchiveTask", await current(task));
  const restored = await data(`tasks/${task}`);
  assert.equal(restored.assigneeId, member.uid);
  assert.equal(restored.dueDate, "2026-12-31");
  assert.equal(restored.deletedAt, null);
  const history = (
    await dbAdmin.collection("task_history").where("taskId", "==", task).get()
  ).docs.map((d) => d.data());
  for (const action of [
    "create",
    "updateTask",
    "archiveTask",
    "deleteTask",
    "restoreTask",
    "unarchiveTask",
  ])
    assert.ok(history.some((h) => h.action === action));
});
test("Board delete/restore: child tasks are hidden and cannot be changed until restored", async () => {
  const task = await newTask("보드 복구");
  await mutate(owner, "deleteBoard", { id: board });
  await failure(getDoc(doc(member.db, "tasks", task)), "permission-denied");
  await failure(
    mutate(owner, "deleteTask", await current(task)),
    "functions/permission-denied",
  );
  await mutate(owner, "restoreBoard", { id: board });
  assert.equal(
    (await getDoc(doc(member.db, "tasks", task))).data().title,
    "보드 복구",
  );
});
test("Realtime: two users receive create/update/move/archive/delete/restore plus history without refresh", async () => {
  const watch = (who) => {
    const events = [];
    const stop = onSnapshot(
      query(
        collection(who.db, "tasks"),
        where("workspaceId", "==", workspace),
        where("boardId", "==", board),
      ),
      (s) => events.push(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return { events, stop };
  };
  const a = watch(owner),
    b = watch(member);
  const wait = async (predicate) => {
    const until = Date.now() + 8000;
    while (!predicate()) {
      assert.ok(Date.now() < until, "snapshot timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const task = await newTask("실시간");
  let worst = 0;
  try {
    await wait(() =>
      [a, b].every((w) => w.events.at(-1)?.some((t) => t.id === task)),
    );
    for (const [op, args, check] of [
      [
        "updateTask",
        { patch: { title: "실시간 수정" } },
        (t) => t.title === "실시간 수정",
      ],
      [
        "moveTask",
        { status: "done", beforeId: null, orderVersion: await order() },
        (t) => t.status === "done",
      ],
      ["archiveTask", {}, (t) => t.isArchived],
      ["unarchiveTask", {}, (t) => !t.isArchived],
      ["deleteTask", {}, (t) => !!t.deletedAt],
      ["restoreTask", {}, (t) => t.deletedAt === null],
    ]) {
      const start = performance.now();
      await mutate(owner, op, { ...(await current(task)), ...args });
      await wait(() =>
        [a, b].every((w) => {
          const t = w.events.at(-1)?.find((t) => t.id === task);
          return t && check(t);
        }),
      );
      worst = Math.max(worst, performance.now() - start);
    }
    const hs = await getDocs(
      query(
        collection(member.db, "task_history"),
        where("workspaceId", "==", workspace),
        where("boardId", "==", board),
      ),
    );
    assert.ok(hs.docs.filter((d) => d.data().taskId === task).length >= 7);
    console.log(
      `Realtime worst request+snapshot ${Math.round(worst)}ms (local emulator only)`,
    );
  } finally {
    a.stop();
    b.stop();
  }
});
test("Performance: representative 300-card board is readable and rejects a 301st active task", async () => {
  const b = (
      await mutate(owner, "createBoard", {
        name: "300개 업무",
        description: "성능 기준",
      })
    ).id,
    batch = dbAdmin.batch();
  for (let i = 0; i < 300; i++)
    batch.set(dbAdmin.collection("tasks").doc(), {
      ...input(`부하 ${i}`),
      workspaceId: workspace,
      boardId: b,
      version: 1,
      position: (i + 1) * 1000,
      isArchived: false,
      archivedAt: null,
      deletedAt: null,
      createdBy: owner.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  await batch.commit();
  const start = performance.now(),
    ss = await getDocs(
      query(
        collection(member.db, "tasks"),
        where("workspaceId", "==", workspace),
        where("boardId", "==", b),
      ),
    );
  assert.equal(ss.size, 300);
  console.log(
    `300-card read ${Math.round(performance.now() - start)}ms (local emulator only)`,
  );
  await failure(
    mutate(owner, "createTask", { boardId: b, data: input("301") }),
    "functions/resource-exhausted",
  );
});

test("Board removal preserves assignment validity: reassign active tasks before excluding a participant", async () => {
  const b = (
    await mutate(owner, "createBoard", { name: "담당자 검증", description: "" })
  ).id;
  const t = (
    await mutate(owner, "createTask", {
      boardId: b,
      data: { ...input(), assigneeId: member.uid },
    })
  ).id;
  await failure(
    mutate(owner, "updateBoard", { id: b, patch: { memberIds: [owner.uid] } }),
    "functions/failed-precondition",
  );
  await mutate(owner, "updateTask", {
    ...(await current(t)),
    patch: { assigneeId: null },
  });
  await mutate(owner, "updateBoard", {
    id: b,
    patch: { memberIds: [owner.uid] },
  });
  await failure(getDoc(doc(member.db, "tasks", t)), "permission-denied");
  await failure(
    mutate(owner, "updateTask", {
      ...(await current(t)),
      patch: { assigneeId: member.uid },
    }),
    "functions/invalid-argument",
  );
});
test("Invitation at workspace capacity never grants partial membership", async () => {
  const leader = await account("capacity-owner"),
    who = await account("capacity-member");
  const ws = (await leader.call("createWorkspace", { name: "정원 팀" })).id;
  const payload = await leader.call("inviteMember", { email: who.email });
  await dbAdmin.doc(`workspaces/${ws}`).update({ memberCount: 30 });
  await failure(
    who.call("acceptInvitation", payload),
    "functions/resource-exhausted",
  );
  assert.equal((await data(`users/${who.uid}`)).workspaceId, "");
  assert.equal((await data(`workspaces/${ws}`)).memberCount, 30);
});
