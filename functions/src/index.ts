import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { randomBytes, createHash } from "node:crypto";
import { planOrder, statuses, type OrderedTask } from "./ordering";

initializeApp();
const db = getFirestore();
const options = { region: "asia-northeast3", maxInstances: 10 };
type Data = Record<string, any>;
const priorities = ["high", "medium", "low"];
const date = () => new Date().toISOString();
function requireValue(
  condition: unknown,
  message: string,
  code:
    | "invalid-argument"
    | "failed-precondition"
    | "permission-denied"
    | "already-exists"
    | "resource-exhausted" = "invalid-argument",
): asserts condition {
  if (!condition) throw new HttpsError(code, message);
}
function authenticated(req: CallableRequest): string {
  if (!req.auth)
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return req.auth.uid;
}
function id(value: unknown): string {
  requireValue(
    typeof value === "string" && /^[\w-]{1,128}$/.test(value),
    "문서 ID가 올바르지 않습니다.",
  );
  return value;
}
function name(value: unknown, max: number): string {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `1~${max}자로 입력해 주세요.`,
  );
  return value.trim();
}
function patch(value: unknown): Data {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    "업무 필드가 올바르지 않습니다.",
  );
  const p = value as Data;
  requireValue(
    Object.keys(p).every((k) =>
      [
        "title",
        "description",
        "assigneeId",
        "status",
        "priority",
        "dueDate",
      ].includes(k),
    ),
    "허용되지 않은 업무 필드입니다.",
  );
  if ("title" in p) name(p.title, 150);
  if ("description" in p)
    requireValue(
      typeof p.description === "string" && p.description.length <= 5000,
      "설명은 5000자 이하여야 합니다.",
    );
  if ("assigneeId" in p && p.assigneeId !== null) id(p.assigneeId);
  if ("status" in p)
    requireValue(statuses.includes(p.status), "상태가 올바르지 않습니다.");
  if ("priority" in p)
    requireValue(
      priorities.includes(p.priority),
      "우선순위가 올바르지 않습니다.",
    );
  if ("dueDate" in p && p.dueDate !== null) {
    requireValue(
      typeof p.dueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) &&
        !isNaN(Date.parse(p.dueDate)) &&
        new Date(p.dueDate).toISOString().slice(0, 10) === p.dueDate,
      "유효한 날짜를 입력하세요.",
    );
  }
  return { ...p, ...("title" in p ? { title: p.title.trim() } : {}) };
}
async function userIn(tx: Transaction, uid: string): Promise<Data> {
  const s = await tx.get(db.doc(`users/${uid}`));
  requireValue(
    s.exists && s.data()?.workspaceId,
    "워크스페이스에 소속되어 있지 않습니다.",
    "permission-denied",
  );
  return { id: uid, ...s.data()! };
}
function admin(u: Data) {
  requireValue(
    u.role === "admin",
    "관리자 권한이 필요합니다.",
    "permission-denied",
  );
}
function access(u: Data, b: Data, allowDeleted = false) {
  requireValue(
    b &&
      b.workspaceId === u.workspaceId &&
      (allowDeleted || !b.deletedAt) &&
      (u.role === "admin" || b.memberIds.includes(u.id)),
    "보드 접근 권한이 없습니다.",
    "permission-denied",
  );
}
async function assignee(tx: Transaction, u: Data, b: Data, value: unknown) {
  if (value == null) return;
  const s = await tx.get(db.doc(`users/${id(value)}`));
  requireValue(
    s.exists &&
      s.data()?.workspaceId === u.workspaceId &&
      (s.data()?.role === "admin" || b.memberIds.includes(value)),
    "보드에 접근 가능한 팀원만 배정할 수 있습니다.",
  );
}
async function profile(req: CallableRequest) {
  const uid = authenticated(req),
    email = req.auth?.token.email?.toLowerCase();
  requireValue(email, "이메일 계정으로 로그인하세요.", "permission-denied");
  const displayName = name(
    req.data?.displayName || req.auth?.token.name || email.split("@")[0],
    40,
  );
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`),
      s = await tx.get(ref);
    const value = s.exists
      ? s.data()!
      : {
          email,
          displayName,
          workspaceId: "",
          role: "member",
          createdAt: date(),
          updatedAt: date(),
        };
    // bootstrap and registration may arrive together; never overwrite workspace/role.
    if (!s.exists) tx.create(ref, value);
    else if (req.data?.displayName && value.displayName !== displayName) {
      value.displayName = displayName;
      tx.update(ref, { displayName, updatedAt: date() });
    }
    return { user: { id: uid, ...value } };
  });
}
export const bootstrap = onCall(options, profile);
export const registerUser = onCall(options, profile);
export const createWorkspace = onCall(options, async (req) => {
  const uid = authenticated(req),
    wsName = name(req.data?.name, 80);
  const ws = db.collection("workspaces").doc();
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`),
      s = await tx.get(ref);
    requireValue(
      s.exists && !s.data()?.workspaceId,
      "이미 팀에 소속되어 있거나 계정이 없습니다.",
      "failed-precondition",
    );
    tx.create(ws, {
      name: wsName,
      ownerId: uid,
      memberCount: 1,
      createdAt: date(),
      updatedAt: date(),
    });
    tx.update(ref, { workspaceId: ws.id, role: "admin", updatedAt: date() });
    return { id: ws.id };
  });
});
export const inviteMember = onCall(options, async (req) => {
  const uid = authenticated(req),
    email = String(req.data?.email || "")
      .trim()
      .toLowerCase();
  requireValue(
    email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "이메일 형식을 확인하세요.",
  );
  const token = randomBytes(32).toString("hex"),
    tokenHash = createHash("sha256").update(token).digest("hex");
  await db.runTransaction(async (tx) => {
    const u = await userIn(tx, uid);
    admin(u);
    const ref = db.doc(
      "invitations/" +
        createHash("sha256").update(`${u.workspaceId}:${email}`).digest("hex"),
    );
    const [previous, members] = await Promise.all([
      tx.get(ref),
      tx.get(
        db
          .collection("users")
          .where("workspaceId", "==", u.workspaceId)
          .where("email", "==", email),
      ),
    ]);
    requireValue(
      members.empty,
      "이미 팀에 참여한 사용자입니다.",
      "already-exists",
    );
    const inv = previous.data();
    requireValue(
      !(inv?.status === "pending" && inv.expiresAt.toMillis() > Date.now()),
      "이미 대기 중인 초대가 있습니다. 취소 후 다시 초대하세요.",
      "already-exists",
    );
    tx.set(ref, {
      workspaceId: u.workspaceId,
      email,
      tokenHash,
      status: "pending",
      invitedBy: uid,
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
      acceptedAt: null,
      createdAt: date(),
    });
  });
  return { token };
});
export const acceptInvitation = onCall(options, async (req) => {
  const uid = authenticated(req),
    email = req.auth?.token.email?.toLowerCase(),
    token = req.data?.token;
  requireValue(
    typeof token === "string" && /^[a-f0-9]{64}$/.test(token),
    "초대 토큰이 잘못되었습니다.",
  );
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const found = await db
    .collection("invitations")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  requireValue(
    !found.empty,
    "유효하지 않거나 이미 사용된 초대입니다.",
    "failed-precondition",
  );
  const accepted = await db.runTransaction(async (tx) => {
    const invRef = found.docs[0].ref,
      uRef = db.doc(`users/${uid}`);
    const [is, us] = await Promise.all([tx.get(invRef), tx.get(uRef)]),
      inv = is.data(),
      u = us.data();
    requireValue(
      inv && inv.tokenHash === tokenHash && inv.status === "pending",
      "만료되거나 취소된 초대입니다.",
      "failed-precondition",
    );
    if (inv.expiresAt.toMillis() <= Date.now()) {
      tx.update(invRef, { status: "expired", tokenHash: FieldValue.delete() });
      return false;
    }
    requireValue(
      u && !u.workspaceId && email === inv.email,
      "초대받은 이메일의 소속되지 않은 계정으로 로그인하세요.",
      "permission-denied",
    );
    const wsRef = db.doc(`workspaces/${inv.workspaceId}`);
    const [ws, boards] = await Promise.all([
      tx.get(wsRef),
      tx.get(
        db.collection("boards").where("workspaceId", "==", inv.workspaceId),
      ),
    ]);
    requireValue(ws.exists, "팀이 존재하지 않습니다.", "failed-precondition");
    requireValue(
      (ws.data()?.memberCount || 1) < 30,
      "팀은 최대 30명까지 참여할 수 있습니다.",
      "resource-exhausted",
    );
    tx.update(uRef, {
      workspaceId: inv.workspaceId,
      role: "member",
      updatedAt: date(),
    });
    tx.update(wsRef, {
      memberCount: FieldValue.increment(1),
      updatedAt: date(),
    });
    tx.update(invRef, {
      status: "accepted",
      acceptedAt: date(),
      tokenHash: FieldValue.delete(),
    });
    for (const b of boards.docs.filter((b) => !b.data().deletedAt))
      tx.update(b.ref, {
        memberIds: FieldValue.arrayUnion(uid),
        updatedAt: date(),
      });
    return true;
  });
  requireValue(accepted, "만료된 초대입니다.", "failed-precondition");
  return { ok: true };
});

export const mutate = onCall(options, async (req) => {
  const uid = authenticated(req),
    v = req.data as Data;
  requireValue(v && typeof v === "object", "요청을 확인하세요.");
  const op = v.op;
  requireValue(
    [
      "createBoard",
      "updateBoard",
      "deleteBoard",
      "restoreBoard",
      "revokeInvite",
      "createTask",
      "updateTask",
      "moveTask",
      "archiveTask",
      "unarchiveTask",
      "deleteTask",
      "restoreTask",
    ].includes(op),
    "지원하지 않는 작업입니다.",
  );
  // Stable IDs across transaction retries; the transaction contains every authorization read.
  const newRef = db.collection(op === "createBoard" ? "boards" : "tasks").doc();
  return db.runTransaction(async (tx) => {
    const u = await userIn(tx, uid),
      ts = date();
    if (op === "createBoard") {
      admin(u);
      const boardName = name(v.name, 80);
      requireValue(
        typeof v.description === "string" && v.description.length <= 500,
        "보드 설명은 500자 이하여야 합니다.",
      );
      const members = await tx.get(
        db.collection("users").where("workspaceId", "==", u.workspaceId),
      );
      tx.create(newRef, {
        workspaceId: u.workspaceId,
        name: boardName,
        description: v.description,
        memberIds: members.docs.map((d) => d.id),
        createdBy: uid,
        deletedAt: null,
        orderVersion: 0,
        createdAt: ts,
        updatedAt: ts,
      });
      return { id: newRef.id };
    }
    if (op === "revokeInvite") {
      admin(u);
      const ref = db.doc(`invitations/${id(v.id)}`),
        s = await tx.get(ref),
        inv = s.data();
      requireValue(
        inv && inv.workspaceId === u.workspaceId,
        "초대 접근 권한이 없습니다.",
        "permission-denied",
      );
      requireValue(
        inv.status === "pending",
        "대기 중인 초대만 취소할 수 있습니다.",
        "failed-precondition",
      );
      tx.update(ref, { status: "revoked", tokenHash: FieldValue.delete() });
      return { ok: true };
    }
    const boardOp = ["updateBoard", "deleteBoard", "restoreBoard"].includes(op);
    let task: Data | undefined;
    const taskRef =
      op === "createTask"
        ? newRef
        : !boardOp
          ? db.doc(`tasks/${id(v.id)}`)
          : null;
    if (taskRef && op !== "createTask") {
      const s = await tx.get(taskRef);
      requireValue(s.exists, "업무를 찾을 수 없습니다.", "failed-precondition");
      task = { id: s.id, ...s.data()! };
    }
    const boardRef = db.doc(
      `boards/${id(boardOp ? v.id : op === "createTask" ? v.boardId : task!.boardId)}`,
    );
    const bs = await tx.get(boardRef),
      b = bs.data();
    requireValue(b, "보드를 찾을 수 없습니다.", "permission-denied");
    access(u, b, boardOp);
    if (boardOp) {
      admin(u);
      if (op === "updateBoard") {
        requireValue(
          !b.deletedAt,
          "삭제된 보드를 먼저 복구하세요.",
          "failed-precondition",
        );
        const p = v.patch;
        requireValue(
          p &&
            typeof p === "object" &&
            Object.keys(p).every((k) =>
              ["name", "description", "memberIds"].includes(k),
            ),
          "보드 필드가 잘못되었습니다.",
        );
        const changes: Data = { updatedAt: ts };
        if ("name" in p) changes.name = name(p.name, 80);
        if ("description" in p) {
          requireValue(
            typeof p.description === "string" && p.description.length <= 500,
            "설명은 500자 이하여야 합니다.",
          );
          changes.description = p.description;
        }
        if ("memberIds" in p) {
          requireValue(
            Array.isArray(p.memberIds) &&
              p.memberIds.length <= 30 &&
              p.memberIds.includes(uid),
            "관리자를 포함한 팀원을 선택하세요.",
          );
          const members = await Promise.all(
            p.memberIds.map((x: unknown) => tx.get(db.doc(`users/${id(x)}`))),
          );
          requireValue(
            members.every(
              (s) => s.exists && s.data()?.workspaceId === u.workspaceId,
            ),
            "다른 팀의 사용자는 추가할 수 없습니다.",
          );
          const removed = b.memberIds.filter(
            (member: string) => !p.memberIds.includes(member),
          );
          if (removed.length) {
            const tasks = await tx.get(
              db.collection("tasks").where("boardId", "==", boardRef.id),
            );
            requireValue(
              !tasks.docs.some(
                (d) =>
                  !d.data().deletedAt &&
                  !d.data().isArchived &&
                  removed.includes(d.data().assigneeId),
              ),
              "담당 업무가 있는 팀원은 담당자를 변경한 후 보드에서 제외하세요.",
              "failed-precondition",
            );
          }
          changes.memberIds = [...new Set(p.memberIds)];
        }
        tx.update(boardRef, changes);
      } else
        tx.update(boardRef, {
          deletedAt: op === "deleteBoard" ? ts : null,
          updatedAt: ts,
        });
      return { ok: true };
    }
    const p =
      op === "createTask"
        ? patch(v.data)
        : op === "updateTask"
          ? patch(v.patch)
          : {};
    if (op === "createTask")
      requireValue(
        ["title", "status", "priority"].every((k) => k in p),
        "필수 업무 항목을 확인하세요.",
      );
    if ("assigneeId" in p) await assignee(tx, u, b, p.assigneeId);
    if (task) {
      requireValue(
        Number.isSafeInteger(v.version) && v.version === task.version,
        "conflict: 다른 사용자가 먼저 수정했습니다.",
        "failed-precondition",
      );
      requireValue(
        !task.deletedAt || op === "restoreTask",
        "삭제된 업무입니다.",
        "failed-precondition",
      );
      requireValue(
        !task.isArchived ||
          ["unarchiveTask", "deleteTask", "restoreTask"].includes(op),
        "보관된 업무입니다.",
        "failed-precondition",
      );
    }
    if (
      ["archiveTask", "unarchiveTask", "deleteTask", "restoreTask"].includes(op)
    )
      admin(u);
    if (op === "moveTask") {
      requireValue(
        statuses.includes(v.status) &&
          (v.beforeId === null || typeof v.beforeId === "string"),
        "이동 위치가 올바르지 않습니다.",
      );
      requireValue(
        Number.isSafeInteger(v.orderVersion) &&
          v.orderVersion === (b.orderVersion || 0),
        "conflict: 카드 순서가 변경되었습니다. 최신 순서를 확인하세요.",
        "failed-precondition",
      );
    }
    const changes: Data = { ...p };
    if (op === "moveTask") changes.status = v.status;
    if (op === "archiveTask") {
      requireValue(
        task!.status === "done" && !task!.isArchived,
        "완료된 미보관 업무만 보관할 수 있습니다.",
        "failed-precondition",
      );
      Object.assign(changes, { isArchived: true, archivedAt: ts });
    }
    if (op === "unarchiveTask") {
      requireValue(
        task!.isArchived,
        "보관된 업무가 아닙니다.",
        "failed-precondition",
      );
      Object.assign(changes, { isArchived: false, archivedAt: null });
    }
    if (op === "deleteTask") changes.deletedAt = ts;
    if (op === "restoreTask") {
      requireValue(
        task!.deletedAt,
        "삭제된 업무가 아닙니다.",
        "failed-precondition",
      );
      changes.deletedAt = null;
    }
    const next: Data = task
      ? { ...task, ...changes, version: task.version + 1, updatedAt: ts }
      : {
          id: newRef.id,
          workspaceId: u.workspaceId,
          boardId: boardRef.id,
          description: "",
          assigneeId: null,
          dueDate: null,
          ...p,
          position: 0,
          version: 1,
          isArchived: false,
          archivedAt: null,
          deletedAt: null,
          createdBy: uid,
          createdAt: ts,
          updatedAt: ts,
        };
    const ordering =
      !task ||
      op === "moveTask" ||
      ["status", "isArchived", "deletedAt"].some(
        (k) => k in changes && changes[k] !== task![k],
      );
    if (ordering) {
      const all = await tx.get(
        db.collection("tasks").where("boardId", "==", boardRef.id),
      );
      const planned = planOrder(
        all.docs.map((d) => ({ id: d.id, ...d.data() })) as OrderedTask[],
        next as OrderedTask,
        op === "moveTask" ? v.beforeId : undefined,
      );
      next.position = planned.nextPosition;
      for (const update of planned.updates)
        tx.update(db.doc(`tasks/${update.id}`), { position: update.position });
      tx.update(boardRef, {
        orderVersion: (b.orderVersion || 0) + 1,
        updatedAt: ts,
      });
    }
    const { id: taskId, ...stored } = next;
    if (task) tx.update(taskRef!, stored);
    else tx.create(newRef, stored);
    const changeId = randomBytes(12).toString("hex");
    for (const [field, value] of Object.entries(
      task ? changes : { title: next.title },
    )) {
      if (
        field === "position" ||
        (task && JSON.stringify(task[field]) === JSON.stringify(value))
      )
        continue;
      tx.create(db.collection("task_history").doc(), {
        workspaceId: u.workspaceId,
        boardId: boardRef.id,
        taskId,
        actorId: uid,
        action: task ? op : "create",
        field,
        oldValue: task?.[field] ?? null,
        newValue: value ?? null,
        changeId,
        createdAt: ts,
      });
    }
    return { id: taskId, version: next.version };
  });
});
