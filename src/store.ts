import type {
  Board,
  History,
  Invitation,
  Task,
  TaskInput,
  User,
  Status,
} from "./types";
import { ConflictError, STATUSES } from "./types";
import { auth, db, functions, firebaseEnabled } from "./firebase";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
} from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
export interface Snapshot {
  user: User | null;
  boards: Board[];
  tasks: Task[];
  people: User[];
  history: History[];
  invitations: Invitation[];
  loading: boolean;
  error: string | null;
  workspaceName?: string;
  connection?: "connecting" | "connected" | "offline";
}
export interface Backend {
  subscribe: (fn: (s: Snapshot) => void) => () => void;
  refresh: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reset: (email: string) => Promise<void>;
  createBoard: (name: string, description: string) => Promise<void>;
  updateBoard: (id: string, patch: Partial<Board>) => Promise<void>;
  removeBoard: (id: string, restore?: boolean) => Promise<void>;
  createTask: (boardId: string, data: TaskInput) => Promise<void>;
  updateTask: (
    id: string,
    version: number,
    patch: Partial<TaskInput>,
  ) => Promise<void>;
  moveTask: (
    id: string,
    version: number,
    status: Status,
    beforeId: string | null,
    orderVersion: number,
  ) => Promise<void>;
  archiveTask: (
    id: string,
    version: number,
    restore?: boolean,
  ) => Promise<void>;
  deleteTask: (id: string, version: number, restore?: boolean) => Promise<void>;
  invite: (email: string) => Promise<string>;
  revokeInvite: (id: string) => Promise<void>;
  acceptInvite: (token: string) => Promise<void>;
}
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const demoPeople: User[] = [
  {
    id: "demo",
    email: "demo@flowboard.app",
    displayName: "김동겸",
    workspaceId: "demo-ws",
    role: "admin",
  },
  {
    id: "u2",
    email: "min@flowboard.app",
    displayName: "이지민",
    workspaceId: "demo-ws",
    role: "member",
  },
  {
    id: "u3",
    email: "park@flowboard.app",
    displayName: "박서준",
    workspaceId: "demo-ws",
    role: "member",
  },
  {
    id: "u4",
    email: "choi@flowboard.app",
    displayName: "최유진",
    workspaceId: "demo-ws",
    role: "member",
  },
];
const board0: Board = {
  id: "b1",
  workspaceId: "demo-ws",
  name: "신규 서비스 개발",
  description: "제품 개발 및 디자인 업무",
  memberIds: demoPeople.map((p) => p.id),
  createdBy: "demo",
  deletedAt: null,
  createdAt: now(),
  updatedAt: now(),
};
const board1: Board = {
  ...board0,
  id: "b2",
  name: "운영 및 유지보수",
  description: "운영 개선 및 버그 수정",
};
const ts: Task[] = [
  [
    "메인 대시보드 UI 설계",
    "사용자가 업무 진행 상황을 한눈에 볼 수 있도록 디자인",
    "u2",
    "in_progress",
    "high",
    "2026-10-21",
    "b1",
  ],
  [
    "사용자 인증 화면 개발",
    "로그인 및 회원가입 화면 구성",
    "demo",
    "in_progress",
    "medium",
    "2026-10-22",
    "b1",
  ],
  [
    "서비스 기획안 검토",
    "기능 정의 및 사용자 시나리오 검토",
    "u3",
    "todo",
    "high",
    "2026-10-19",
    "b1",
  ],
  [
    "팀원 초대 플로우 구현",
    "초대 링크 및 가입 처리 구현",
    "u4",
    "todo",
    "medium",
    "2026-10-27",
    "b1",
  ],
  [
    "모바일 레이아웃 개선",
    "390px 환경에서 칸반 레이아웃 점검",
    "u2",
    "todo",
    "low",
    "2026-10-28",
    "b1",
  ],
  [
    "API 구조 설계",
    "데이터 모델과 API 인터페이스 정의",
    "demo",
    "done",
    "medium",
    "2026-10-15",
    "b1",
  ],
  [
    "실시간 동기화 오류 확인",
    "중복 변경 이벤트 발생 원인 확인",
    "u3",
    "issue",
    "high",
    "2026-10-14",
    "b1",
  ],
  [
    "주간 운영 체크리스트",
    "서버 모니터링 및 운영 점검",
    "u4",
    "todo",
    "medium",
    "2026-10-25",
    "b2",
  ],
].map((r, i) => ({
  id: "TASK-" + (1024 + i),
  workspaceId: "demo-ws",
  boardId: r[6],
  title: r[0],
  description: r[1],
  assigneeId: r[2],
  status: r[3] as Status,
  priority: r[4] as Task["priority"],
  dueDate: r[5],
  position: i * 1000,
  version: 1,
  isArchived: false,
  archivedAt: null,
  deletedAt: null,
  createdBy: "demo",
  createdAt: now(),
  updatedAt: now(),
}));
type Data = Omit<
  Snapshot,
  "loading" | "error" | "connection" | "workspaceName"
>;
const seed: Data = {
  user: demoPeople[0],
  boards: [board0, board1],
  tasks: ts,
  people: demoPeople,
  history: [],
  invitations: [],
};
class DemoBackend implements Backend {
  private data: Data;
  private listeners = new Set<(s: Snapshot) => void>();
  constructor() {
    try {
      this.data =
        JSON.parse(localStorage.getItem("flowboard-demo") || "null") ||
        structuredClone(seed);
    } catch {
      this.data = structuredClone(seed);
    }
  }
  async refresh() {
    this.emit();
  }
  private emit() {
    localStorage.setItem("flowboard-demo", JSON.stringify(this.data));
    this.listeners.forEach((fn) =>
      fn({ ...structuredClone(this.data), loading: false, error: null }),
    );
  }
  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn);
    fn({ ...structuredClone(this.data), loading: false, error: null });
    return () => {
      this.listeners.delete(fn);
    };
  }
  async createWorkspace(name: string) {
    const u = this.actor();
    if (u.workspaceId) throw Error("이미 팀에 소속되어 있습니다.");
    u.workspaceId = "demo-ws";
    u.role = "admin";
    const profile = this.data.people.find((p) => p.id === u.id);
    if (profile) Object.assign(profile, u);
    this.data.boards.push({
      ...board0,
      id: uid(),
      name,
      createdBy: u.id,
      memberIds: [u.id],
    });
    this.emit();
  }
  async login(email: string, _password: string) {
    const p = this.data.people.find(
      (p) => p.email.toLowerCase() === email.toLowerCase(),
    );
    if (!p) throw Error("데모 계정 이메일을 확인해 주세요.");
    this.data.user = p;
    this.emit();
  }
  async register(name: string, email: string, _password: string) {
    if (this.data.people.some((p) => p.email === email))
      throw Error("이미 등록된 이메일입니다.");
    const p = {
      id: uid(),
      email,
      displayName: name,
      workspaceId: "",
      role: "member" as const,
    };
    this.data.people.push(p);
    this.data.user = p;
    this.emit();
  }
  async logout() {
    this.data.user = null;
    this.emit();
  }
  async reset(_email: string) {
    return;
  }
  private actor() {
    if (!this.data.user) throw Error("로그인이 필요합니다.");
    return this.data.user;
  }
  private admin() {
    if (this.actor().role !== "admin") throw Error("관리자 권한이 필요합니다.");
  }
  private access(boardId: string) {
    const user = this.actor(),
      b = this.data.boards.find((b) => b.id === boardId && !b.deletedAt);
    if (
      !b ||
      user.workspaceId !== b.workspaceId ||
      (user.role !== "admin" && !b.memberIds.includes(user.id))
    )
      throw Error("보드에 접근할 권한이 없습니다.");
    return b;
  }
  private log(
    task: Task,
    action: string,
    patch: Record<string, unknown>,
    before: Task | null,
  ) {
    for (const [field, value] of Object.entries(patch)) {
      if (
        before &&
        JSON.stringify(
          (before as unknown as Record<string, unknown>)[field],
        ) === JSON.stringify(value)
      )
        continue;
      this.data.history.push({
        id: uid(),
        taskId: task.id,
        actorId: this.actor().id,
        action,
        field,
        oldValue: before
          ? (before as unknown as Record<string, unknown>)[field]
          : null,
        newValue: value,
        createdAt: now(),
      });
    }
  }
  async createBoard(name: string, description: string) {
    this.admin();
    const b: Board = {
      id: uid(),
      workspaceId: this.actor().workspaceId,
      name,
      description,
      memberIds: this.data.people
        .filter((p) => p.workspaceId === this.actor().workspaceId)
        .map((p) => p.id),
      createdBy: this.actor().id,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.data.boards.push(b);
    this.emit();
  }
  async updateBoard(id: string, patch: Partial<Board>) {
    this.admin();
    const b = this.access(id);
    if (
      patch.memberIds &&
      (!patch.memberIds.includes(this.actor().id) ||
        patch.memberIds.some(
          (id) =>
            !this.data.people.some(
              (p) => p.id === id && p.workspaceId === this.actor().workspaceId,
            ),
        ))
    )
      throw Error("현재 팀의 참여자를 선택하세요.");
    if (
      patch.memberIds &&
      this.data.tasks.some(
        (t) =>
          t.boardId === id &&
          !t.deletedAt &&
          !t.isArchived &&
          t.assigneeId &&
          !patch.memberIds!.includes(t.assigneeId),
      )
    )
      throw Error(
        "담당 업무가 있는 팀원은 담당자를 변경한 후 보드에서 제외하세요.",
      );
    Object.assign(b, {
      name: patch.name ?? b.name,
      description: patch.description ?? b.description,
      memberIds: patch.memberIds ?? b.memberIds,
      updatedAt: now(),
    });
    this.emit();
  }
  async removeBoard(id: string, restore = false) {
    this.admin();
    const b = this.data.boards.find((b) => b.id === id);
    if (!b) throw Error("보드 없음");
    b.deletedAt = restore ? null : now();
    this.emit();
  }
  async createTask(boardId: string, data: TaskInput) {
    const b = this.access(boardId);
    if (
      this.data.tasks.filter(
        (t) => t.boardId === boardId && !t.isArchived && !t.deletedAt,
      ).length >= 300
    )
      throw Error("보드의 활성 업무는 최대 300개입니다.");
    if (
      !STATUSES.includes(data.status) ||
      !["high", "medium", "low"].includes(data.priority) ||
      (data.assigneeId &&
        !this.data.people.some(
          (p) =>
            p.id === data.assigneeId &&
            (p.role === "admin" || b.memberIds.includes(p.id)),
        ))
    )
      throw Error("업무 입력을 확인하세요.");
    b.orderVersion = (b.orderVersion || 0) + 1;
    if (
      !data.title.trim() ||
      data.title.length > 150 ||
      data.description.length > 5000
    )
      throw Error("입력 내용을 확인해 주세요.");
    const task: Task = {
      ...data,
      title: data.title.trim(),
      id: "TASK-" + Math.floor(1000 + Math.random() * 89000),
      workspaceId: this.actor().workspaceId,
      boardId,
      position: Date.now(),
      version: 1,
      isArchived: false,
      archivedAt: null,
      deletedAt: null,
      createdBy: this.actor().id,
      createdAt: now(),
      updatedAt: now(),
    };
    this.data.tasks.push(task);
    this.log(task, "create", { title: task.title }, null);
    this.emit();
  }
  async updateTask(id: string, version: number, patch: Partial<TaskInput>) {
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) throw Error("업무 없음");
    this.access(t.boardId);
    if (t.isArchived || t.deletedAt)
      throw Error("보관되거나 삭제된 업무는 수정할 수 없습니다.");
    if (t.version !== version) throw new ConflictError();
    const before = { ...t };
    if (patch.status && patch.status !== t.status) {
      const b = this.access(t.boardId);
      b.orderVersion = (b.orderVersion || 0) + 1;
      patch = { ...patch };
      t.position =
        Math.max(
          0,
          ...this.data.tasks
            .filter(
              (x) =>
                x.boardId === t.boardId &&
                x.status === patch.status &&
                !x.deletedAt &&
                !x.isArchived,
            )
            .map((x) => x.position),
        ) + 1000;
    }
    Object.assign(t, patch, { version: t.version + 1, updatedAt: now() });
    this.log(t, "update", patch, before);
    this.emit();
  }
  async moveTask(
    id: string,
    version: number,
    status: Status,
    beforeId: string | null,
    orderVersion: number,
  ) {
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) throw Error("업무 없음");
    const b = this.access(t.boardId);
    if (t.isArchived || t.deletedAt)
      throw Error("보관되거나 삭제된 업무입니다.");
    if (t.version !== version || (b.orderVersion || 0) !== orderVersion)
      throw new ConflictError();
    const before = { ...t };
    const target = this.data.tasks
      .filter(
        (x) =>
          x.boardId === t.boardId &&
          x.status === status &&
          x.id !== id &&
          !x.isArchived &&
          !x.deletedAt,
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const at =
      beforeId === null
        ? target.length
        : target.findIndex((x) => x.id === beforeId);
    if (at < 0) throw new ConflictError();
    target.splice(at, 0, t);
    Object.assign(t, { status, version: t.version + 1, updatedAt: now() });
    target.forEach((x, i) => (x.position = (i + 1) * 1000));
    b.orderVersion = (b.orderVersion || 0) + 1;
    if (before.status !== status) this.log(t, "moveTask", { status }, before);
    this.emit();
  }
  async archiveTask(id: string, version: number, restore = false) {
    this.admin();
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) throw Error("업무 없음");
    const b = this.access(t.boardId);
    if (t.deletedAt) throw Error("삭제된 업무입니다.");
    b.orderVersion = (b.orderVersion || 0) + 1;
    if (t.version !== version) throw new ConflictError();
    if (!restore && t.status !== "done")
      throw Error("완료된 업무만 보관할 수 있습니다.");
    const before = { ...t };
    Object.assign(t, {
      isArchived: !restore,
      archivedAt: restore ? null : now(),
      version: t.version + 1,
      updatedAt: now(),
    });
    this.log(
      t,
      restore ? "unarchive" : "archive",
      { isArchived: t.isArchived },
      before,
    );
    this.emit();
  }
  async deleteTask(id: string, version: number, restore = false) {
    this.admin();
    const t = this.data.tasks.find((t) => t.id === id);
    if (!t) throw Error("업무 없음");
    const b = this.access(t.boardId);
    b.orderVersion = (b.orderVersion || 0) + 1;
    if (t.version !== version) throw new ConflictError();
    const before = { ...t };
    t.deletedAt = restore ? null : now();
    t.version++;
    t.updatedAt = now();
    this.log(
      t,
      restore ? "restore" : "delete",
      { deletedAt: t.deletedAt },
      before,
    );
    this.emit();
  }
  async invite(email: string) {
    this.admin();
    if (
      this.data.invitations.some(
        (i) =>
          i.email === email && i.status === "pending" && i.expiresAt > now(),
      )
    )
      throw Error("이미 대기 중인 초대가 있습니다.");
    if (
      this.data.people.some(
        (p) => p.workspaceId === this.actor().workspaceId && p.email === email,
      )
    )
      throw Error("이미 팀에 참여한 사용자입니다.");
    const token = uid();
    this.data.invitations.push({
      id: token,
      email,
      workspaceId: this.actor().workspaceId,
      status: "pending",
      invitedBy: this.actor().id,
      createdAt: now(),
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      link: location.origin + "/?invite=" + token,
    });
    this.emit();
    return location.origin + "/?invite=" + token;
  }
  async revokeInvite(id: string) {
    this.admin();
    const i = this.data.invitations.find((i) => i.id === id);
    if (i) i.status = "revoked";
    this.emit();
  }
  async acceptInvite(token: string) {
    const i = this.data.invitations.find((i) => i.id === token);
    if (!i || i.status !== "pending" || i.expiresAt < now())
      throw Error("초대 링크가 만료되었거나 유효하지 않습니다.");
    const user = this.actor();
    if (user.workspaceId) throw Error("이미 팀에 소속되어 있습니다.");
    if (user.email.toLowerCase() !== i.email.toLowerCase())
      throw Error("초대받은 이메일로 로그인해야 합니다.");
    user.workspaceId = i.workspaceId;
    i.status = "accepted";
    i.acceptedAt = now();
    this.data.boards
      .filter((b) => b.workspaceId === i.workspaceId)
      .forEach((b) => b.memberIds.push(user.id));
    this.emit();
  }
}
// Convert Firestore timestamps at the boundary; UI models use ISO strings.
function value<T>(id: string, data: Record<string, unknown>): T {
  const result: Record<string, unknown> = { id, ...data };
  for (const [key, v] of Object.entries(result))
    if (v && typeof v === "object" && "toDate" in v)
      result[key] = (v as { toDate: () => Date }).toDate().toISOString();
  return result as T;
}
class FirebaseBackend implements Backend {
  private snap: Snapshot = {
    user: null,
    boards: [],
    tasks: [],
    people: [],
    history: [],
    invitations: [],
    loading: true,
    error: null,
    connection: "connecting",
  };
  private subscribers = new Set<(s: Snapshot) => void>();
  private stopData: (() => void)[] = [];
  private stopUser: () => void = () => {};
  private epoch = 0;
  private activeWorkspace = "";
  private emit() {
    this.subscribers.forEach((fn) => fn({ ...this.snap }));
  }
  private stop() {
    this.stopData.splice(0).forEach((fn) => fn());
    this.activeWorkspace = "";
  }
  private error = (e: Error) => {
    this.snap.error = e.message;
    this.snap.connection = "offline";
    this.emit();
  };
  constructor() {
    window.addEventListener("offline", () => {
      this.snap.connection = "offline";
      this.emit();
    });
    window.addEventListener("online", () => {
      void this.refresh();
    });
    onAuthStateChanged(auth!, async (u) => {
      const epoch = ++this.epoch;
      this.stop();
      this.stopUser();
      this.snap = {
        user: null,
        boards: [],
        tasks: [],
        people: [],
        history: [],
        invitations: [],
        loading: !!u,
        error: null,
        connection: navigator.onLine ? "connecting" : "offline",
      };
      this.emit();
      if (!u) return;
      try {
        await httpsCallable(functions!, "bootstrap")({});
        if (epoch !== this.epoch) return;
        this.stopUser = onSnapshot(
          doc(db!, "users", u.uid),
          (s) => {
            if (epoch !== this.epoch) return;
            const previousRole = this.snap.user?.role;
            this.snap.user = s.exists() ? value<User>(s.id, s.data()) : null;
            this.snap.loading = false;
            this.emit();
            const wid = this.snap.user?.workspaceId || "";
            if (
              wid &&
              (wid !== this.activeWorkspace ||
                previousRole !== this.snap.user?.role)
            )
              this.listen(wid);
          },
          (e) => {
            if (epoch === this.epoch) {
              this.snap.loading = false;
              this.error(e);
            }
          },
        );
      } catch (e) {
        if (epoch === this.epoch) {
          this.snap.loading = false;
          this.error(e as Error);
        }
      }
    });
  }
  private listen(wid: string) {
    this.stop();
    this.activeWorkspace = wid;
    this.snap.error = null;
    this.snap.connection = navigator.onLine ? "connecting" : "offline";
    const epoch = this.epoch,
      user = this.snap.user!;
    const boardQuery =
      user.role === "admin"
        ? query(collection(db!, "boards"), where("workspaceId", "==", wid))
        : query(
            collection(db!, "boards"),
            where("workspaceId", "==", wid),
            where("memberIds", "array-contains", user.id),
          );
    const childStops = new Map<string, (() => void)[]>(),
      tasks = new Map<string, Task[]>(),
      history = new Map<string, History[]>();
    const refresh = () => {
      if (epoch !== this.epoch) return;
      this.snap.tasks = [...tasks.values()].flat();
      this.snap.history = [...history.values()].flat();
      this.emit();
    };
    const stopBoards = onSnapshot(
      boardQuery,
      { includeMetadataChanges: true },
      (bs) => {
        if (epoch !== this.epoch) return;
        const boards = bs.docs.map((d) => value<Board>(d.id, d.data()));
        this.snap.boards = boards;
        this.snap.connection =
          navigator.onLine && !bs.metadata.fromCache
            ? "connected"
            : navigator.onLine
              ? "connecting"
              : "offline";
        const active = boards.filter((b) => !b.deletedAt);
        for (const [bid, stops] of childStops)
          if (!active.some((b) => b.id === bid)) {
            stops.forEach((s) => s());
            childStops.delete(bid);
            tasks.delete(bid);
            history.delete(bid);
          }
        for (const b of active)
          if (!childStops.has(b.id)) {
            const readError = (e: Error) => {
              tasks.delete(b.id);
              history.delete(b.id);
              refresh();
              this.error(e);
            };
            childStops.set(b.id, [
              onSnapshot(
                query(
                  collection(db!, "tasks"),
                  where("workspaceId", "==", wid),
                  where("boardId", "==", b.id),
                ),
                (ss) => {
                  tasks.set(
                    b.id,
                    ss.docs.map((d) => value<Task>(d.id, d.data())),
                  );
                  refresh();
                },
                readError,
              ),
              onSnapshot(
                query(
                  collection(db!, "task_history"),
                  where("workspaceId", "==", wid),
                  where("boardId", "==", b.id),
                ),
                (ss) => {
                  history.set(
                    b.id,
                    ss.docs.map((d) => value<History>(d.id, d.data())),
                  );
                  refresh();
                },
                readError,
              ),
            ]);
          }
        refresh();
      },
      (e) => {
        this.snap.boards = [];
        tasks.clear();
        history.clear();
        refresh();
        this.error(e);
      },
    );
    this.stopData.push(
      onSnapshot(
        doc(db!, "workspaces", wid),
        (s) => {
          if (epoch !== this.epoch) return;
          this.snap.workspaceName = String(
            s.data()?.name || "우리 팀 워크스페이스",
          );
          this.emit();
        },
        this.error,
      ),
    );
    this.stopData.push(stopBoards, () => {
      childStops.forEach((stops) => stops.forEach((s) => s()));
      childStops.clear();
    });
    this.stopData.push(
      onSnapshot(
        query(collection(db!, "users"), where("workspaceId", "==", wid)),
        (ss) => {
          if (epoch !== this.epoch) return;
          this.snap.people = ss.docs.map((d) => value<User>(d.id, d.data()));
          this.emit();
        },
        this.error,
      ),
    );
    if (user.role === "admin")
      this.stopData.push(
        onSnapshot(
          query(
            collection(db!, "invitations"),
            where("workspaceId", "==", wid),
          ),
          (ss) => {
            if (epoch !== this.epoch) return;
            this.snap.invitations = ss.docs.map((d) =>
              value<Invitation>(d.id, d.data()),
            );
            this.emit();
          },
          this.error,
        ),
      );
  }
  async refresh() {
    if (this.snap.user?.workspaceId) this.listen(this.snap.user.workspaceId);
    else if (auth!.currentUser) {
      await this.call("bootstrap");
    }
  }
  subscribe(fn: (s: Snapshot) => void) {
    this.subscribers.add(fn);
    fn({ ...this.snap });
    return () => {
      this.subscribers.delete(fn);
    };
  }
  private async call(name: string, data: Record<string, unknown> = {}) {
    await httpsCallable(functions!, name)(data);
  }
  async createWorkspace(name: string) {
    await this.call("createWorkspace", { name });
  }
  async login(email: string, password: string) {
    await signInWithEmailAndPassword(auth!, email, password);
  }
  async register(name: string, email: string, password: string) {
    const result = await createUserWithEmailAndPassword(auth!, email, password);
    await updateProfile(result.user, { displayName: name });
    await this.call("registerUser", { displayName: name });
  }
  async logout() {
    await signOut(auth!);
  }
  async reset(email: string) {
    await sendPasswordResetEmail(auth!, email);
  }
  async createBoard(name: string, description: string) {
    await this.call("mutate", { op: "createBoard", name, description });
  }
  async updateBoard(id: string, patch: Partial<Board>) {
    await this.call("mutate", { op: "updateBoard", id, patch });
  }
  async removeBoard(id: string, restore = false) {
    await this.call("mutate", {
      op: restore ? "restoreBoard" : "deleteBoard",
      id,
    });
  }
  async createTask(boardId: string, data: TaskInput) {
    await this.call("mutate", { op: "createTask", boardId, data });
  }
  async updateTask(id: string, version: number, patch: Partial<TaskInput>) {
    await this.call("mutate", { op: "updateTask", id, version, patch });
  }
  async moveTask(
    id: string,
    version: number,
    status: Status,
    beforeId: string | null,
    orderVersion: number,
  ) {
    await this.call("mutate", {
      op: "moveTask",
      id,
      version,
      status,
      beforeId,
      orderVersion,
    });
  }
  async archiveTask(id: string, version: number, restore = false) {
    await this.call("mutate", {
      op: restore ? "unarchiveTask" : "archiveTask",
      id,
      version,
    });
  }
  async deleteTask(id: string, version: number, restore = false) {
    await this.call("mutate", {
      op: restore ? "restoreTask" : "deleteTask",
      id,
      version,
    });
  }
  async invite(email: string) {
    const res = await httpsCallable(functions!, "inviteMember")({ email });
    return `${location.origin}/?invite=${(res.data as { token: string }).token}`;
  }
  async revokeInvite(id: string) {
    await this.call("mutate", { op: "revokeInvite", id });
  }
  async acceptInvite(token: string) {
    await this.call("acceptInvitation", { token });
  }
}
export const backend: Backend = firebaseEnabled
  ? new FirebaseBackend()
  : new DemoBackend();
