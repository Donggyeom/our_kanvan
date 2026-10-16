import { createServer } from "node:http";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
  createReadStream,
} from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoBackend } from "../artifacts/shared-server/local-backend.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "artifacts/shared-dist");
const dataDir = resolve(process.env.DATA_DIR || resolve(root, ".data"));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const file = resolve(dataDir, "flowboard.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const passwordHash = (value, salt) =>
  scryptSync(value, salt, 64).toString("hex");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
let state;
function save(next) {
  const temp = file + ".tmp";
  writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
  const fd = openSync(temp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  const dir = openSync(dataDir, "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
  state = next;
}
if (existsSync(file)) state = JSON.parse(readFileSync(file, "utf8"));
else {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !email.includes("@") || !password || password.length < 10)
    throw Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) for the initial owner.",
    );
  let data;
  new DemoBackend({ getItem: () => null, setItem: () => {} }).subscribe(
    (snapshot) => {
      const { loading, error, ...rest } = snapshot;
      data = rest;
    },
  );
  const owner = {
    id: randomUUID(),
    email,
    displayName: process.env.ADMIN_NAME || "관리자",
    workspaceId: "demo-ws",
    role: "admin",
  };
  data.user = null;
  data.people = [owner];
  for (const board of data.boards) {
    board.memberIds = [owner.id];
    board.createdBy = owner.id;
  }
  for (const task of data.tasks) {
    task.assigneeId = null;
    task.createdBy = owner.id;
  }
  const salt = randomBytes(16).toString("hex");
  save({
    revision: 0,
    data,
    accounts: { [owner.id]: { salt, password: passwordHash(password, salt) } },
    sessions: {},
  });
}
let queue = Promise.resolve();
const rate = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rate) if (value.until < now) rate.delete(key);
}, 60000).unref();
function limited(req) {
  const key = req.socket.remoteAddress;
  const item = rate.get(key);
  if (!item || item.until < Date.now()) {
    rate.set(key, { count: 1, until: Date.now() + 60000 });
    return;
  }
  if (++item.count > 15) throw fail("잠시 후 다시 시도하세요.", 429);
}
const secure = process.env.NODE_ENV === "production";
const cookieName = secure ? "__Host-flowboard" : "flowboard";
function cookie(token, maxAge = 604800) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function session(req, next) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const item = token && next.sessions[hash(token)];
  return item && item.expires > Date.now()
    ? { key: hash(token), id: item.userId }
    : null;
}
function snapshot(data, userId) {
  const user = data.people.find((p) => p.id === userId) || null;
  if (!user)
    return {
      user: null,
      boards: [],
      tasks: [],
      people: [],
      history: [],
      invitations: [],
      loading: false,
      error: null,
    };
  const boards = data.boards.filter(
    (b) =>
      b.workspaceId === user.workspaceId &&
      (user.role === "admin" ||
        (!b.deletedAt && b.memberIds.includes(user.id))),
  );
  const boardIds = new Set(boards.map((b) => b.id));
  const tasks = data.tasks.filter((t) => boardIds.has(t.boardId));
  const taskIds = new Set(tasks.map((t) => t.id));
  return {
    user,
    boards,
    tasks,
    people: data.people.filter(
      (p) =>
        p.id === user.id ||
        (user.workspaceId && p.workspaceId === user.workspaceId),
    ),
    history: data.history.filter((h) => taskIds.has(h.taskId)),
    messages: (data.messages || []).filter((m) => taskIds.has(m.taskId)),
    invitations:
      user.role === "admin"
        ? data.invitations.filter((i) => i.workspaceId === user.workspaceId)
        : [],
    loading: false,
    error: null,
    workspaceName: "우리 팀",
    connection: "connected",
  };
}
function string(v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw fail("입력값을 확인하세요.");
  return v.trim();
}
function integer(v) {
  if (!Number.isSafeInteger(v) || v < 0)
    throw fail("버전이 올바르지 않습니다.");
}
function text(v, max) {
  if (typeof v !== "string" || v.length > max)
    throw fail("입력값을 확인하세요.");
}
function taskInput(p, partial = false) {
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw fail("업무 입력을 확인하세요.");
  const fields = [
    "title",
    "description",
    "assigneeId",
    "status",
    "priority",
    "dueDate",
  ];
  if (Object.keys(p).some((k) => !fields.includes(k)))
    throw fail("허용되지 않은 업무 필드입니다.");
  if (!partial && fields.some((k) => !(k in p)))
    throw fail("필수 입력이 없습니다.");
  if ("title" in p) string(p.title, 200);
  if ("description" in p) text(p.description, 10000);
  if (
    "status" in p &&
    !["todo", "in_progress", "done", "issue"].includes(p.status)
  )
    throw fail("상태를 확인하세요.");
  if ("priority" in p && !["high", "medium", "low"].includes(p.priority))
    throw fail("우선순위를 확인하세요.");
  if (
    "dueDate" in p &&
    p.dueDate !== null &&
    (typeof p.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate))
  )
    throw fail("날짜를 확인하세요.");
  if ("assigneeId" in p && p.assigneeId !== null) string(p.assigneeId);
}
const methods = new Set([
  "createBoard",
  "updateBoard",
  "removeBoard",
  "createTask",
  "updateTask",
  "moveTask",
  "archiveTask",
  "deleteTask",
  "invite",
  "revokeInvite",
  "acceptInvite",
  "sendMessage",
]);
async function rpc(req, res, body) {
  const { method, args } = body;
  if (typeof method !== "string" || !Array.isArray(args) || args.length > 5)
    throw fail("잘못된 요청입니다.");
  const next = structuredClone(state);
  const auth = session(req, next);
  let userId = auth?.id;
  let result = null;
  const email = (v) => {
    const value = string(v, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw fail("이메일을 확인하세요.");
    return value;
  };
  const loginSession = (id) => {
    const token = randomBytes(32).toString("hex");
    next.sessions[hash(token)] = {
      userId: id,
      expires: Date.now() + 604800000,
    };
    res.setHeader("Set-Cookie", cookie(token));
    userId = id;
  };
  if (method === "login") {
    limited(req);
    const address = email(args[0]);
    text(args[1], 1024);
    const user = next.data.people.find((p) => p.email === address);
    const account = user && next.accounts[user.id];
    const salt = account?.salt || "dummy-login-salt";
    const candidate = passwordHash(args[1], salt);
    if (
      !account ||
      !timingSafeEqual(
        Buffer.from(candidate, "hex"),
        Buffer.from(account.password, "hex"),
      )
    )
      throw fail("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
    loginSession(user.id);
  } else if (method === "register") {
    limited(req);
    if (typeof args[3] !== "string" || !args[3].trim())
      throw fail(
        "회원가입에는 초대 링크가 필요합니다. 관리자에게 초대 링크를 받아 그 링크에서 가입해 주세요.",
        403,
      );
    if (
      typeof args[0] !== "string" ||
      !args[0].trim() ||
      args[0].trim().length > 40
    )
      throw fail("이름을 1~40자로 입력해 주세요.");
    const name = string(args[0], 40),
      address = email(args[1]);
    text(args[2], 1024);
    if (args[2].length < 10) throw fail("비밀번호는 10자 이상 입력하세요.");
    const token = string(args[3]);
    const invitation = next.data.invitations.find(
      (i) =>
        i.id === hash(token) &&
        i.email === address &&
        i.status === "pending" &&
        i.expiresAt > new Date().toISOString(),
    );
    if (!invitation) throw fail("유효한 초대 링크에서 가입하세요.", 403);
    if (next.data.people.some((p) => p.email === address))
      throw fail("이미 등록된 이메일입니다.");
    const user = {
      id: randomUUID(),
      email: address,
      displayName: name,
      workspaceId: "",
      role: "member",
    };
    const salt = randomBytes(16).toString("hex");
    next.accounts[user.id] = { salt, password: passwordHash(args[2], salt) };
    next.data.people.push(user);
    loginSession(user.id);
  } else if (method === "logout") {
    if (auth) delete next.sessions[auth.key];
    userId = null;
    res.setHeader("Set-Cookie", cookie("", 0));
  } else if (method === "reset")
    throw fail("비밀번호 재설정은 서버 관리자에게 요청하세요.");
  else {
    if (!auth) throw fail("로그인이 필요합니다.", 401);
    if (!methods.has(method)) throw fail("허용되지 않은 작업입니다.", 403);
    const actor = next.data.people.find((p) => p.id === userId);
    next.data.user = actor;
    if (method === "createBoard") {
      string(args[0], 80);
      text(args[1], 1000);
    } else string(args[0]);
    if (method === "updateBoard") {
      const p = args[1];
      if (
        !p ||
        typeof p !== "object" ||
        Array.isArray(p) ||
        Object.keys(p).some(
          (k) => !["name", "description", "memberIds"].includes(k),
        )
      )
        throw fail("보드 입력을 확인하세요.");
      if ("name" in p) string(p.name, 80);
      if ("description" in p) text(p.description, 1000);
      if (
        "memberIds" in p &&
        (!Array.isArray(p.memberIds) ||
          p.memberIds.length > 30 ||
          p.memberIds.some((id) => typeof id !== "string"))
      )
        throw fail("참여자를 확인하세요.");
    }
    if (
      ["removeBoard"].includes(method) &&
      args[1] !== undefined &&
      typeof args[1] !== "boolean"
    )
      throw fail("잘못된 요청입니다.");
    if (
      ["archiveTask", "deleteTask"].includes(method) &&
      args[2] !== undefined &&
      typeof args[2] !== "boolean"
    )
      throw fail("잘못된 요청입니다.");
    if (method === "createTask") taskInput(args[1]);
    if (method === "sendMessage") {
      if (
        args.length !== 3 ||
        typeof args[1] !== "string" ||
        !args[1].trim() ||
        args[1].length > 2000
      )
        throw fail("메시지를 1~2000자로 입력하세요.");
      if (typeof args[2] !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(args[2]))
        throw fail("메시지 요청이 올바르지 않습니다.");
    }
    if (
      ["updateTask", "moveTask", "archiveTask", "deleteTask"].includes(method)
    )
      integer(args[1]);
    if (method === "updateTask") {
      taskInput(args[2], true);
      const task = next.data.tasks.find((t) => t.id === args[0]);
      const board = task && next.data.boards.find((b) => b.id === task.boardId);
      const assignee = args[2].assigneeId;
      if (
        assignee &&
        !next.data.people.some(
          (p) =>
            p.id === assignee &&
            p.workspaceId === actor.workspaceId &&
            (p.role === "admin" || board?.memberIds.includes(p.id)),
        )
      )
        throw fail("담당자를 확인하세요.");
    }
    if (method === "moveTask") {
      if (!["todo", "in_progress", "done", "issue"].includes(args[2]))
        throw fail("상태를 확인하세요.");
      if (args[3] !== null) string(args[3]);
      integer(args[4]);
    }
    // Restrict administration and cross-workspace operations before the shared domain runs.
    if (
      [
        "createBoard",
        "updateBoard",
        "removeBoard",
        "archiveTask",
        "deleteTask",
        "invite",
        "revokeInvite",
      ].includes(method) &&
      actor.role !== "admin"
    )
      throw fail("관리자 권한이 필요합니다.", 403);
    if (
      ["updateBoard", "removeBoard"].includes(method) &&
      !next.data.boards.some(
        (b) => b.id === args[0] && b.workspaceId === actor.workspaceId,
      )
    )
      throw fail("보드 접근 권한이 없습니다.", 403);
    if (method === "invite") {
      const address = email(args[0]);
      if (
        next.data.people.filter((p) => p.workspaceId === actor.workspaceId)
          .length +
          next.data.invitations.filter(
            (i) =>
              i.status === "pending" && i.expiresAt > new Date().toISOString(),
          ).length >=
        30
      )
        throw fail("팀은 최대 30명입니다.");
      if (
        next.data.people.some(
          (p) => p.email === address && p.workspaceId === actor.workspaceId,
        ) ||
        next.data.invitations.some(
          (i) =>
            i.email === address &&
            i.status === "pending" &&
            i.expiresAt > new Date().toISOString(),
        )
      )
        throw fail("이미 참여 중이거나 초대된 이메일입니다.");
      const token = randomBytes(32).toString("hex");
      next.data.invitations.push({
        id: hash(token),
        workspaceId: actor.workspaceId,
        email: address,
        status: "pending",
        invitedBy: actor.id,
        expiresAt: new Date(Date.now() + 604800000).toISOString(),
        acceptedAt: null,
        createdAt: new Date().toISOString(),
      });
      result = "/?invite=" + token;
    } else {
      let emitted;
      const domain = new DemoBackend({
        getItem: () => JSON.stringify(next.data),
        setItem: (_key, value) => {
          emitted = JSON.parse(value);
        },
      });
      if (method === "acceptInvite") {
        const invitation = next.data.invitations.find(
          (i) => i.id === hash(args[0]),
        );
        if (!invitation || invitation.workspaceId !== "demo-ws")
          throw fail("유효하지 않은 초대입니다.");
        args[0] = hash(args[0]);
      }
      if (
        method === "revokeInvite" &&
        !next.data.invitations.some(
          (i) => i.id === args[0] && i.workspaceId === actor.workspaceId,
        )
      )
        throw fail("초대 접근 권한이 없습니다.", 403);
      await domain[method](...args);
      if (emitted) next.data = emitted;
    }
  }
  next.data.user = null;
  for (const [key, item] of Object.entries(next.sessions))
    if (item.expires < Date.now()) delete next.sessions[key];
  next.revision++;
  save(next);
  return {
    revision: state.revision,
    snapshot: snapshot(state.data, userId),
    result,
  };
}
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw fail("요청이 너무 큽니다.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw fail("잘못된 JSON 요청입니다.");
  }
}
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (url.pathname === "/api/snapshot" && req.method === "GET") {
      await queue;
      json(res, 200, {
        revision: state.revision,
        snapshot: snapshot(state.data, session(req, state)?.id),
      });
      return;
    }
    if (url.pathname === "/api/rpc" && req.method === "POST") {
      const origin = req.headers.origin;
      const expected =
        process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
      const allowed = expected
        ? new URL(expected).origin
        : `http://${req.headers.host}`;
      if (!origin || origin !== allowed)
        throw fail("허용되지 않은 요청 출처입니다.", 403);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw fail("JSON 요청만 허용합니다.", 415);
      const parsed = await body(req);
      const operation = queue.then(() => rpc(req, res, parsed));
      queue = operation.catch(() => {});
      json(res, 200, await operation);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      json(res, 404, { error: "요청을 찾을 수 없습니다." });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method))
      throw fail("허용되지 않은 요청입니다.", 405);
    let path = resolve(publicDir, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(publicDir + sep) && path !== publicDir)
      throw fail("접근할 수 없습니다.", 403);
    if (!existsSync(path) || !statSync(path).isFile())
      path = resolve(publicDir, "index.html");
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
      "Cache-Control":
        extname(path) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(path).pipe(res);
  } catch (error) {
    if (!res.headersSent)
      json(res, error.name === "ConflictError" ? 409 : error.status || 400, {
        error: error.message || "요청에 실패했습니다.",
      });
    else res.end();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Flowboard shared server ready"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
  });
