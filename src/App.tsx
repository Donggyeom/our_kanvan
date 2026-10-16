import { useEffect, useMemo, useState, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  LayoutDashboard,
  CheckSquare,
  Archive,
  Trash2,
  Settings,
  Search,
  Plus,
  ChevronDown,
  LogOut,
  Users,
  X,
  CalendarDays,
  AlertTriangle,
  Clock3,
  MoreHorizontal,
  GripVertical,
  Menu,
  Layers3,
  SlidersHorizontal,
  RotateCcw,
  UserPlus,
  ShieldCheck,
  Link2,
  Check,
  Inbox,
} from "lucide-react";
import { BoardEditor } from "./BoardEditor";
import { useDialog } from "./dialog";
import { backend, type Snapshot } from "./store";
import type { Task, Board, User, TaskInput, Status, Priority } from "./types";
import {
  LABELS,
  PRIORITY,
  STATUSES,
  overdue,
  dateText,
  ConflictError,
} from "./types";
import { firebaseEnabled } from "./firebase";
const sharedEnabled = import.meta.env.VITE_SHARED_MODE === "true";
const blank: TaskInput = {
  title: "",
  description: "",
  assigneeId: null,
  status: "todo",
  priority: "medium",
  dueDate: null,
};
const empty: Snapshot = {
  user: null,
  boards: [],
  tasks: [],
  people: [],
  history: [],
  invitations: [],
  loading: true,
  error: null,
};
const initial = (x: User) => x.displayName.slice(0, 1);
const pickColor = (id: string) =>
  ["#ffe4d6", "#e1e8fd", "#dff5ee", "#f5e9ff"][
    Math.max(
      0,
      id.split("").reduce((s, c) => s + c.charCodeAt(0), 0),
    ) % 4
  ];
const timestamp = (s: string) => {
  try {
    return new Date(s).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
};
const errMessage = (e: unknown) => {
  const error = e as Error & { code?: string };
  const authErrors: Record<string, string> = {
    "auth/invalid-credential": "이메일 또는 비밀번호를 확인해 주세요.",
    "auth/wrong-password": "비밀번호를 확인해 주세요.",
    "auth/user-not-found": "이메일 또는 비밀번호를 확인해 주세요.",
    "auth/email-already-in-use": "이미 가입한 이메일입니다.",
    "auth/weak-password": "비밀번호는 6자 이상으로 입력하세요.",
    "auth/network-request-failed": "네트워크 연결을 확인해 주세요.",
    "auth/too-many-requests": "요청이 많습니다. 잠시 후 다시 시도하세요.",
  };
  if (error.code && authErrors[error.code]) return authErrors[error.code];
  return error instanceof ConflictError || error.message?.includes("conflict")
    ? "다른 사용자가 먼저 수정했습니다. 최신 내용을 확인하고 다시 수정해 주세요."
    : error.message || "요청을 처리하지 못했습니다.";
};
const historyAction: Record<string, string> = {
  create: "생성",
  update: "수정",
  updateTask: "수정",
  move: "상태 변경",
  moveTask: "상태 변경",
  archive: "보관",
  archiveTask: "보관",
  unarchive: "보관 해제",
  unarchiveTask: "보관 해제",
  delete: "삭제",
  deleteTask: "삭제",
  restore: "복구",
  restoreTask: "복구",
};
const historyField: Record<string, string> = {
  title: "제목",
  description: "설명",
  assigneeId: "담당자",
  status: "상태",
  priority: "우선순위",
  dueDate: "완료기한",
  isArchived: "보관 여부",
  archivedAt: "보관 일시",
  deletedAt: "삭제 일시",
};
function historyValue(field: string | null, value: unknown, people: User[]) {
  if (value === null || value === undefined || value === "") return "없음";
  if (field === "assigneeId")
    return people.find((p) => p.id === value)?.displayName || "이전 팀원";
  if (field === "status") return LABELS[value as Status] || String(value);
  if (field === "priority") return PRIORITY[value as Priority] || String(value);
  if (field === "isArchived") return value ? "보관됨" : "미보관";
  if (field === "deletedAt" || field === "archivedAt")
    return timestamp(String(value));
  return String(value).slice(0, 100);
}
function Avatar({ user, size = 32 }: { user?: User; size?: number }) {
  return (
    <span
      title={user?.displayName || "미지정"}
      className="avatar"
      style={{
        width: size,
        height: size,
        background: user ? pickColor(user.id) : "#e8ebef",
        color: user ? "#46516b" : "#94a3b8",
      }}
    >
      {user ? initial(user) : "?"}
    </span>
  );
}
function Card({
  task,
  people,
  onClick,
  disabled,
}: {
  task: Task;
  people: User[];
  onClick: () => void;
  disabled: boolean;
}) {
  const drag = useSortable({ id: task.id, disabled });
  const style = {
    transform: CSS.Transform.toString(drag.transform),
    transition: drag.transition,
    opacity: drag.isDragging ? 0.55 : 1,
  };
  const person = people.find((p) => p.id === task.assigneeId);
  return (
    <article
      tabIndex={0}
      role="button"
      aria-label={task.title}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onClick();
        }
      }}
      ref={drag.setNodeRef}
      style={style}
      className={"task-card " + (drag.isDragging ? "dragged" : "")}
      onClick={onClick}
    >
      <div className="card-top">
        <span className="task-key">{task.id.slice(0, 13)}</span>
        <span className={"priority " + task.priority}>
          <span className="priority-dot" />
          {PRIORITY[task.priority]}
        </span>
      </div>
      <div className="card-title">{task.title}</div>
      <div className="card-desc">{task.description || "설명 없음"}</div>
      <div className="card-bottom">
        <div className="person">
          <Avatar user={person} size={26} />
          <span>{person?.displayName || "담당자 미지정"}</span>
        </div>
        <div className={"due " + (overdue(task) ? "overdue" : "")}>
          <CalendarDays size={14} />
          {dateText(task.dueDate)}
        </div>
      </div>
      {overdue(task) && (
        <span className="late-text">
          <AlertTriangle size={12} /> 기한 초과
        </span>
      )}
      <button
        className="drag-grip"
        title="카드 이동"
        aria-label="카드 이동"
        {...drag.attributes}
        {...drag.listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={17} />
      </button>
    </article>
  );
}
function Column({
  status,
  tasks,
  people,
  onCard,
  dragDisabled,
}: {
  status: Status;
  tasks: Task[];
  people: User[];
  onCard: (t: Task) => void;
  dragDisabled: boolean;
}) {
  const drop = useDroppable({ id: status });
  const config: { [key in Status]: { color: string; bg: string } } = {
    todo: { color: "#6c7a90", bg: "#e9edf3" },
    in_progress: { color: "#4f7fe9", bg: "#e6efff" },
    done: { color: "#16a27d", bg: "#dcf6ec" },
    issue: { color: "#ef7951", bg: "#fff0e6" },
  };
  const c = config[status];
  return (
    <section
      className={"kanban-column " + (drop.isOver ? "drop-active" : "")}
      data-status={status}
    >
      <div className="column-title">
        <span
          className="status-mark"
          style={{ background: c.bg, color: c.color }}
        >
          {status === "done" ? (
            <Check size={14} />
          ) : status === "issue" ? (
            <AlertTriangle size={14} />
          ) : status === "in_progress" ? (
            <Clock3 size={14} />
          ) : (
            <Layers3 size={14} />
          )}
        </span>
        <b>{LABELS[status]}</b>
        <span className="count">{tasks.length}</span>
        <span className="column-spacer" />
        <MoreHorizontal size={18} color="#94a3b8" />
      </div>
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="column-body" ref={drop.setNodeRef}>
          {tasks.map((t) => (
            <Card
              key={t.id}
              task={t}
              people={people}
              onClick={() => onCard(t)}
              disabled={dragDisabled}
            />
          ))}
          {!tasks.length && <div className="no-cards">업무가 없습니다</div>}
        </div>
      </SortableContext>
    </section>
  );
}
function AuthScreen({
  onAction,
}: {
  onAction: (f: () => Promise<void>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(
    firebaseEnabled || sharedEnabled ? "" : "demo@flowboard.app",
  );
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onAction(async () => {
      if (mode === "register" && sharedEnabled) {
        if (!new URLSearchParams(location.search).get("invite"))
          throw Error(
            "회원가입에는 초대 링크가 필요합니다. 관리자에게 초대 링크를 받아 그 링크에서 가입해 주세요.",
          );
        if (!name.trim()) throw Error("이름을 입력해 주세요.");
        if (pw.length < 10) throw Error("비밀번호는 10자 이상 입력해 주세요.");
      }
      if (mode === "login") await backend.login(email, pw);
      if (mode === "register") await backend.register(name, email, pw);
      if (mode === "reset") {
        await backend.reset(email);
        alert(
          firebaseEnabled
            ? "비밀번호 재설정 안내가 발송되었습니다."
            : "데모 모드에서는 이메일이 발송되지 않습니다.",
        );
      }
    });
    setBusy(false);
  }
  return (
    <div className="auth-layout">
      <div className="auth-brand">
        <span className="brand-tile">F</span>
        <h1>
          좋은 팀워크는
          <br />
          <em>명확한 흐름</em>에서 시작됩니다.
        </h1>
        <p>
          흩어진 업무를 하나로.
          <br />
          팀의 모든 진행 상황을 한눈에 확인하세요.
        </p>
        <div className="auth-illustration">
          <div className="illus-title">
            이번 주 진행 상황 <span>↗</span>
          </div>
          {["서비스 기획", "디자인 작업", "개발 진행"].map((n, i) => (
            <div className="illus-row" key={n}>
              <span className="illus-bullet" />
              <b>{n}</b>
              <span
                className="illus-progress"
                style={{
                  width: `${90 - i * 22}px`,
                  background: ["#fed3b0", "#d1e2ff", "#d5f6e8"][i],
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="auth-right">
        <form className="auth-form" onSubmit={submit}>
          <div className="mobile-brand">
            <span className="brand-tile">F</span> flowboard
          </div>
          <div className="eyebrow">WELCOME TO FLOWBOARD</div>
          <h2>
            {mode === "login"
              ? "다시 만나서 반가워요 👋"
              : mode === "register"
                ? "계정 만들기"
                : "비밀번호 재설정"}
          </h2>
          <p>간편하게 로그인하고 팀 업무를 관리하세요.</p>
          {mode === "register" && (
            <label>
              이름
              <input
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
              />
            </label>
          )}
          <label>
            이메일
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </label>
          {mode !== "reset" && (
            <label>
              비밀번호
              <input
                required={firebaseEnabled || sharedEnabled || mode !== "login"}
                minLength={sharedEnabled ? 10 : firebaseEnabled ? 6 : undefined}
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={
                  sharedEnabled
                    ? "10자 이상 입력하세요"
                    : "비밀번호를 입력하세요"
                }
              />
            </label>
          )}
          <button className="primary full" disabled={busy} type="submit">
            {busy
              ? "처리 중..."
              : mode === "login"
                ? "로그인"
                : mode === "register"
                  ? "회원가입"
                  : "재설정 메일 보내기"}
          </button>
          {!firebaseEnabled && !sharedEnabled && (
            <p className="demo-note">
              데모 모드: demo@flowboard.app 으로 로그인하세요. 비밀번호는
              필요하지 않습니다.
            </p>
          )}
          {sharedEnabled && mode === "register" && (
            <p className="demo-note">
              {new URLSearchParams(location.search).get("invite")
                ? "초대받은 이메일로 가입하세요. 비밀번호는 10자 이상이어야 합니다."
                : "관리자에게 초대 링크를 받아 해당 링크에서 가입해 주세요. 일반 접속 주소에서는 가입할 수 없습니다."}
            </p>
          )}
          <div className="auth-links">
            <button
              type="button"
              onClick={() =>
                setMode(mode === "register" ? "login" : "register")
              }
            >
              {mode === "register" ? "로그인으로 돌아가기" : "회원가입"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "reset" ? "login" : "reset")}
            >
              {mode === "reset"
                ? "로그인으로 돌아가기"
                : "비밀번호를 잊으셨나요?"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function TaskModal({
  task,
  latestTask,
  boardId,
  people,
  history,
  onClose,
  onReload,
  onAction,
  isAdmin,
}: {
  task: Task | null;
  latestTask?: Task;
  onReload: (t: Task) => void;
  boardId: string;
  people: User[];
  history: Snapshot["history"];
  onClose: () => void;
  onAction: (f: () => Promise<void>) => Promise<void>;
  isAdmin: boolean;
}) {
  const [form, setForm] = useState<TaskInput>(
    task
      ? {
          title: task.title,
          description: task.description,
          assigneeId: task.assigneeId,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
        }
      : blank,
  );
  const [tab, setTab] = useState<"details" | "history">("details");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const close = () => {
    if (dirty && !confirm("저장하지 않은 변경 사항을 버리시겠습니까?")) return;
    onClose();
  };
  const dialogRef = useDialog(close);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      alert("제목을 입력해 주세요.");
      return;
    }
    setBusy(true);
    await onAction(async () => {
      if (task) await backend.updateTask(task.id, task.version, form);
      else await backend.createTask(boardId, form);
      setDirty(false);
      onClose();
    });
    setBusy(false);
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-label={task ? "업무 상세" : "새 업무"}
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">{task ? task.id : "NEW TASK"}</div>
            <h2>{task ? "업무 상세" : "새 업무 등록"}</h2>
          </div>
          <button className="icon-btn" aria-label="닫기" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {task && (
          <div className="modal-tabs">
            <button
              className={tab === "details" ? "active" : ""}
              onClick={() => setTab("details")}
            >
              업무 정보
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              변경 이력{" "}
              <span>{history.filter((h) => h.taskId === task.id).length}</span>
            </button>
          </div>
        )}
        {task && latestTask && latestTask.version !== task.version && (
          <div className="conflict-banner" role="alert">
            다른 사용자가 수정한 최신 내용이 있습니다. 입력한 내용을 확인한 후
            다시 불러오세요.
            <button
              className="secondary small"
              onClick={() => {
                if (
                  !dirty ||
                  confirm("작성 중인 내용을 최신 내용으로 바꿀까요?")
                )
                  onReload(latestTask);
              }}
            >
              최신 내용 불러오기
            </button>
          </div>
        )}
        {tab === "details" ? (
          <form className="task-form" onSubmit={save}>
            <label>
              업무 제목 <b>*</b>
              <input
                maxLength={150}
                required
                value={form.title}
                placeholder="무엇을 해야 하나요?"
                onChange={(e) => update("title", e.target.value)}
              />
            </label>
            <label>
              상세 설명
              <textarea
                rows={4}
                maxLength={5000}
                value={form.description}
                placeholder="업무 내용을 입력해 주세요."
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                담당자
                <select
                  aria-label="담당자"
                  value={form.assigneeId || ""}
                  onChange={(e) => update("assigneeId", e.target.value || null)}
                >
                  <option value="">담당자 미지정</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <select
                  aria-label="상태"
                  value={form.status}
                  onChange={(e) => update("status", e.target.value as Status)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                우선순위
                <select
                  aria-label="우선순위"
                  value={form.priority}
                  onChange={(e) =>
                    update("priority", e.target.value as Priority)
                  }
                >
                  <option value="high">높음</option>
                  <option value="medium">보통</option>
                  <option value="low">낮음</option>
                </select>
              </label>
              <label>
                완료기한
                <input
                  type="date"
                  value={form.dueDate || ""}
                  onChange={(e) => update("dueDate", e.target.value || null)}
                />
              </label>
            </div>
            {task && (
              <div className="task-meta">
                등록자:{" "}
                {people.find((p) => p.id === task.createdBy)?.displayName ||
                  "팀원"}
                　·　등록: {timestamp(task.createdAt)}　·　최근 수정:{" "}
                {timestamp(task.updatedAt)}　·　버전 {task.version}
              </div>
            )}
            <div className="modal-actions">
              {task && isAdmin && !task.isArchived && !task.deletedAt && (
                <div className="danger-actions">
                  {task.status === "done" && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        onAction(async () => {
                          await backend.archiveTask(task.id, task.version);
                          onClose();
                        })
                      }
                    >
                      <Archive size={15} />
                      보관
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-btn danger"
                    onClick={() => {
                      if (confirm("업무를 휴지통으로 이동할까요?"))
                        onAction(async () => {
                          await backend.deleteTask(task.id, task.version);
                          onClose();
                        });
                    }}
                  >
                    <Trash2 size={15} />
                    삭제
                  </button>
                </div>
              )}
              <button type="button" className="secondary" onClick={close}>
                취소
              </button>
              <button
                type="submit"
                disabled={
                  busy || (!!task && (task.isArchived || !!task.deletedAt))
                }
                className="primary"
              >
                {busy ? "저장 중..." : task ? "변경사항 저장" : "업무 등록"}
              </button>
            </div>
          </form>
        ) : (
          <div className="history-list">
            {history
              .filter((h) => h.taskId === task?.id)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((h) => (
                <div className="history-item" key={h.id}>
                  <div className="history-dot" />
                  <div>
                    <strong>
                      {people.find((p) => p.id === h.actorId)?.displayName ||
                        "사용자"}{" "}
                      · {historyAction[h.action] || "변경"}
                    </strong>
                    <p>
                      {historyField[h.field || ""] || h.field}:{" "}
                      {historyValue(h.field, h.oldValue, people)} →{" "}
                      {historyValue(h.field, h.newValue, people)}
                    </p>
                    <small>{timestamp(h.createdAt)}</small>
                  </div>
                </div>
              ))}
            {!history.some((h) => h.taskId === task?.id) && (
              <div className="empty-state">변경 이력이 없습니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function App() {
  const [state, setState] = useState<Snapshot>(empty);
  const [view, setView] = useState<
    "board" | "mine" | "archive" | "trash" | "settings"
  >("board");
  const [boardId, setBoardId] = useState("");
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [lateOnly, setLateOnly] = useState(false);
  const [sort, setSort] = useState("position");
  const [mobileStatus, setMobileStatus] = useState<Status>("todo");
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [boardEditor, setBoardEditor] = useState<Board | null | undefined>(
    undefined,
  );
  const [pending, setPending] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const dragStart = useRef<{ task: Task; board: Board; tasks: Task[] } | null>(
    null,
  );
  useEffect(() => backend.subscribe(setState), []);
  useEffect(() => {
    if (!boardId && state.boards.length)
      setBoardId(state.boards.find((b) => !b.deletedAt)?.id || "");
  }, [state.boards, boardId]);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (token && state.user) {
      run(async () => {
        await backend.acceptInvite(token);
        history.replaceState({}, "", location.pathname);
      }, "초대 수락 완료");
    }
  }, [state.user?.id]);
  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  }
  async function run(fn: () => Promise<void>, success?: string) {
    setPending((n) => n + 1);
    try {
      await fn();
      if (success) notify(success);
    } catch (e) {
      notify(errMessage(e));
      if (
        (e as Error).message?.includes("conflict") ||
        e instanceof ConflictError
      )
        await backend.refresh().catch((e) => notify(errMessage(e)));
    } finally {
      setPending((n) => n - 1);
    }
  }
  const admin = state.user?.role === "admin";
  const accessible = state.boards.filter(
    (b) =>
      !b.deletedAt && (admin || b.memberIds.includes(state.user?.id || "")),
  );
  const current = accessible.find((b) => b.id === boardId) || accessible[0];
  useEffect(() => {
    if (editing && !accessible.some((b) => b.id === editing.boardId))
      setEditing(undefined);
  }, [editing, state.boards, state.user]);
  const persons = state.people.filter(
    (p) => p.workspaceId === state.user?.workspaceId,
  );
  const visible = useMemo(
    () =>
      state.tasks
        .filter((t) => {
          const b = accessible.find((b) => b.id === t.boardId);
          if (!b) return false;
          if (view === "board" && t.boardId !== current?.id) return false;
          if (view === "mine" && t.assigneeId !== state.user?.id) return false;
          if (view === "archive" && !t.isArchived) return false;
          if (view === "trash" && !t.deletedAt) return false;
          if (["board", "mine"].includes(view) && (t.isArchived || t.deletedAt))
            return false;
          if (view === "archive" && t.deletedAt) return false;
          if (view === "trash" && !t.deletedAt) return false;
          if (statusFilter !== "all" && t.status !== statusFilter) return false;
          if (priorityFilter !== "all" && t.priority !== priorityFilter)
            return false;
          if (assigneeFilter !== "all" && t.assigneeId !== assigneeFilter)
            return false;
          if (lateOnly && !overdue(t)) return false;
          const q = search.trim().toLowerCase();
          return (
            !q ||
            [
              t.title,
              t.id,
              persons.find((p) => p.id === t.assigneeId)?.displayName,
            ].some((x) => x?.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => {
          if (sort === "dueAsc" || sort === "dueDesc") {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return sort === "dueAsc"
              ? a.dueDate.localeCompare(b.dueDate)
              : b.dueDate.localeCompare(a.dueDate);
          }
          if (sort === "high")
            return (
              { high: 0, medium: 1, low: 2 }[a.priority] -
              { high: 0, medium: 1, low: 2 }[b.priority]
            );
          if (sort === "new") return b.createdAt.localeCompare(a.createdAt);
          if (sort === "recent") return b.updatedAt.localeCompare(a.updatedAt);
          return a.position - b.position;
        }),
    [
      state.tasks,
      accessible,
      current?.id,
      view,
      state.user?.id,
      statusFilter,
      priorityFilter,
      assigneeFilter,
      lateOnly,
      search,
      persons,
      sort,
    ],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const dragDisabled =
    sort !== "position" ||
    view !== "board" ||
    !!search ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    assigneeFilter !== "all" ||
    lateOnly ||
    pending > 0;
  function dragEnd(e: DragEndEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || !e.over || e.active.id === e.over.id) return;
    const active = start.task;
    const hovered = start.tasks.find((t) => t.id === String(e.over?.id));
    const target = (hovered?.status ||
      (STATUSES.includes(String(e.over.id) as Status)
        ? String(e.over.id)
        : active.status)) as Status;
    const original = start.tasks
      .filter((t) => t.status === target)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const same = original.filter((t) => t.id !== active.id);
    let at = hovered ? same.findIndex((t) => t.id === hovered.id) : same.length;
    if (
      hovered &&
      target === active.status &&
      original.findIndex((t) => t.id === active.id) <
        original.findIndex((t) => t.id === hovered.id)
    )
      at++;
    if (at < 0) at = same.length;
    const beforeId = same[at]?.id || null;
    run(
      () =>
        backend.moveTask(
          active.id,
          active.version,
          target,
          beforeId,
          start.board.orderVersion || 0,
        ),
      "카드 위치가 변경되었습니다.",
    );
  }
  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setLateOnly(false);
    setSort("position");
  }
  function nav(next: typeof view, id?: string) {
    setView(next);
    if (id) setBoardId(id);
    setSidebar(false);
    resetFilters();
  }
  if (state.loading)
    return (
      <div className="loading">
        <div className="brand-tile">F</div>
        <p>업무 공간을 불러오는 중...</p>
      </div>
    );
  if (!state.user)
    return (
      <>
        <AuthScreen onAction={run} />
        {state.error && (
          <div role="alert" className="error-banner">
            {state.error}
            <button onClick={() => location.reload()}>다시 연결</button>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  if (!state.user.workspaceId)
    return (
      <div className="welcome-setup">
        <div className="setup-card">
          <span className="brand-tile">F</span>
          <div className="eyebrow">GET STARTED</div>
          <h1>함께 일할 공간을 만들어 보세요</h1>
          <p>새로운 팀을 만들거나 초대 링크로 기존 팀에 참여하세요.</p>
          <button
            className="primary full"
            onClick={() => {
              const name = prompt("워크스페이스 이름", "우리 팀");
              if (name?.trim())
                run(
                  () => backend.createWorkspace(name.trim()),
                  "팀이 생성되었습니다.",
                );
            }}
          >
            새 워크스페이스 만들기
          </button>
          <button
            className="secondary full"
            onClick={() => run(() => backend.logout())}
          >
            다른 계정으로 로그인
          </button>
          {new URLSearchParams(location.search).has("invite") && (
            <p>초대 링크로 로그인했다면 잠시 후 참여 처리가 진행됩니다.</p>
          )}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <div className="sidebar-brand">
          <span className="brand-tile">F</span>
          <span>
            flowboard<span className="brand-period">.</span>
          </span>
          <button
            aria-label="메뉴 닫기"
            className="mobile-close icon-btn"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-icon">W</span>
          <span>
            <b>
              {state.user.workspaceId
                ? state.workspaceName || "우리 팀 워크스페이스"
                : "팀 참여 대기 중"}
            </b>
            <small>Team workspace</small>
          </span>
          <ChevronDown size={16} />
        </div>
        <div className="nav-category">WORKSPACE</div>
        <nav className="nav-links">
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => nav("board")}
          >
            <LayoutDashboard size={18} /> 전체 보드
          </button>
          <button
            className={view === "mine" ? "active" : ""}
            onClick={() => nav("mine")}
          >
            <CheckSquare size={18} /> 내 업무{" "}
            <span className="nav-pill">
              {
                state.tasks.filter(
                  (t) =>
                    t.assigneeId === state.user?.id &&
                    !t.deletedAt &&
                    !t.isArchived,
                ).length
              }
            </span>
          </button>
          <button
            className={view === "archive" ? "active" : ""}
            onClick={() => nav("archive")}
          >
            <Archive size={18} /> 보관함
          </button>
          {admin && (
            <button
              className={view === "trash" ? "active" : ""}
              onClick={() => nav("trash")}
            >
              <Trash2 size={18} /> 휴지통
            </button>
          )}
        </nav>
        <div className="nav-category project-label">
          PROJECTS{" "}
          {admin && (
            <button title="프로젝트 추가" onClick={() => setBoardEditor(null)}>
              <Plus size={17} />
            </button>
          )}
        </div>
        <nav className="nav-links project-nav">
          {accessible.map((b) => (
            <button
              key={b.id}
              className={
                view === "board" && current?.id === b.id
                  ? "selected-project"
                  : ""
              }
              onClick={() => nav("board", b.id)}
            >
              <span className="project-dot" />
              {b.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {admin && (
            <button
              onClick={() => nav("settings")}
              className={view === "settings" ? "active" : ""}
            >
              <Settings size={18} /> 팀 설정
            </button>
          )}
          <div className="sidebar-user">
            <Avatar user={state.user} size={36} />
            <span>
              <b>{state.user.displayName}</b>
              <small>
                {admin ? "관리자" : "팀원"}{" "}
                {firebaseEnabled || sharedEnabled ? "" : "· 데모"}
              </small>
            </span>
            <button
              title="로그아웃"
              onClick={() => run(() => backend.logout())}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <div className="sidebar-overlay" onClick={() => setSidebar(false)} />
      )}
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              aria-label="메뉴 열기"
              className="menu-toggle icon-btn"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>워크스페이스</span>
            <span className="slash">/</span>
            <strong>
              {view === "board"
                ? current?.name
                : view === "mine"
                  ? "내 업무"
                  : view === "archive"
                    ? "보관함"
                    : view === "trash"
                      ? "휴지통"
                      : "팀 설정"}
            </strong>
          </div>
          <div className="topbar-right">
            <span
              role="status"
              className={
                "sync-indicator " +
                (state.connection === "offline" ? "offline" : "")
              }
            >
              <span />{" "}
              {pending
                ? "저장 중..."
                : !firebaseEnabled && !sharedEnabled
                  ? "데모 모드"
                  : state.connection === "connected"
                    ? sharedEnabled
                      ? "서버 연결"
                      : "실시간 연결"
                    : state.connection === "offline"
                      ? "연결 끊김"
                      : "다시 연결 중..."}
            </span>
            <Avatar user={state.user} size={32} />
          </div>
        </header>
        <div className="page-content">
          {view !== "settings" ? (
            <>
              <div className="page-header">
                <div>
                  <div className="eyebrow">
                    {view === "board"
                      ? "PROJECT BOARD"
                      : view === "mine"
                        ? "MY TASKS"
                        : view === "archive"
                          ? "ARCHIVED TASKS"
                          : "TRASH"}
                  </div>
                  <h1>
                    {view === "board"
                      ? current?.name || "프로젝트 보드"
                      : view === "mine"
                        ? "내 업무"
                        : view === "archive"
                          ? "보관함"
                          : "휴지통"}{" "}
                    <span className="heading-spark">✳</span>
                  </h1>
                  <p>
                    {view === "board"
                      ? current?.description ||
                        "팀의 모든 업무를 한눈에 확인하세요."
                      : view === "mine"
                        ? "나에게 배정된 업무를 확인해 보세요."
                        : view === "archive"
                          ? "완료 후 보관한 업무를 확인하고 복원할 수 있습니다."
                          : "삭제된 업무를 복구할 수 있습니다."}
                  </p>
                </div>
                <div className="header-actions">
                  {view === "board" && current && (
                    <>
                      <button
                        className="secondary small"
                        onClick={() => nav("mine")}
                      >
                        <CheckSquare size={16} />내 업무
                      </button>
                      <button
                        className="primary"
                        onClick={() => setEditing(null)}
                      >
                        <Plus size={18} /> 새 업무
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "전체 업무",
                    n: visible.length,
                    icon: <Layers3 size={18} />,
                    tone: "orange",
                  },
                  {
                    label: "진행 중",
                    n: visible.filter((t) => t.status === "in_progress").length,
                    icon: <Clock3 size={18} />,
                    tone: "blue",
                  },
                  {
                    label: "완료",
                    n: visible.filter((t) => t.status === "done").length,
                    icon: <Check size={18} />,
                    tone: "green",
                  },
                  {
                    label: "이슈 / 지연",
                    n: visible.filter((t) => t.status === "issue" || overdue(t))
                      .length,
                    icon: <AlertTriangle size={18} />,
                    tone: "red",
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <strong>
                        {s.n}
                        <small>건</small>
                      </strong>
                    </div>
                    <div className={"stat-icon " + s.tone}>{s.icon}</div>
                  </div>
                ))}
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    aria-label="업무 검색"
                    placeholder="업무명, 담당자, 업무 ID 검색..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button onClick={() => setSearch("")}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="filter-fields">
                  <label>
                    <span>상태</span>
                    <select
                      aria-label="상태"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">전체 상태</option>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>우선순위</span>
                    <select
                      aria-label="우선순위"
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                    >
                      <option value="all">전체</option>
                      <option value="high">높음</option>
                      <option value="medium">보통</option>
                      <option value="low">낮음</option>
                    </select>
                  </label>
                  <label>
                    <span>담당자</span>
                    <select
                      aria-label="담당자"
                      value={assigneeFilter}
                      onChange={(e) => setAssigneeFilter(e.target.value)}
                    >
                      <option value="all">전체</option>
                      {persons.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>정렬</span>
                    <select
                      aria-label="정렬"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="position">사용자 지정</option>
                      <option value="dueAsc">마감일 빠른 순</option>
                      <option value="dueDesc">마감일 늦은 순</option>
                      <option value="high">우선순위 높은 순</option>
                      <option value="new">최근 등록</option>
                      <option value="recent">최근 수정</option>
                    </select>
                  </label>
                </div>
                <div className="filter-bottom">
                  <button
                    className={"filter-button " + (lateOnly ? "selected" : "")}
                    onClick={() => setLateOnly(!lateOnly)}
                  >
                    <SlidersHorizontal size={15} /> 기한 초과만
                  </button>
                  <button className="reset-button" onClick={resetFilters}>
                    <RotateCcw size={14} /> 초기화
                  </button>
                </div>
              </div>
              {["board", "mine"].includes(view) ? (
                <>
                  <div className="board-bar">
                    <span>
                      <span className="board-dot" />{" "}
                      {view === "board" ? "칸반보드" : "내 업무 보드"}{" "}
                      <b>{visible.length}개 업무</b>
                    </span>
                    <span>
                      {dragDisabled
                        ? "카드 상세에서 상태를 변경하세요"
                        : "드래그하여 상태와 순서를 변경하세요"}
                    </span>
                  </div>
                  {visible.length === 0 && (
                    <p className="empty-results" role="status">
                      조건에 맞는 업무가 없습니다.
                    </p>
                  )}
                  <div className="mobile-status-tabs">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        className={mobileStatus === s ? "active" : ""}
                        onClick={() => setMobileStatus(s)}
                      >
                        {LABELS[s]}{" "}
                        <span>
                          {visible.filter((t) => t.status === s).length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <DndContext
                    onDragStart={(e) => {
                      const task = state.tasks.find(
                        (t) => t.id === e.active.id,
                      );
                      const board = state.boards.find(
                        (b) => b.id === task?.boardId,
                      );
                      if (task && board)
                        dragStart.current = {
                          task: { ...task },
                          board: { ...board },
                          tasks: state.tasks
                            .filter(
                              (t) =>
                                t.boardId === board.id &&
                                !t.deletedAt &&
                                !t.isArchived,
                            )
                            .map((t) => ({ ...t })),
                        };
                    }}
                    onDragCancel={() => {
                      dragStart.current = null;
                    }}
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragEnd={dragEnd}
                  >
                    <div className="board-grid">
                      {STATUSES.map((s) => (
                        <div
                          key={s}
                          className={
                            "status-wrap " +
                            (mobileStatus === s ? "mobile-current" : "")
                          }
                        >
                          <Column
                            status={s}
                            tasks={visible.filter((t) => t.status === s)}
                            people={persons}
                            onCard={setEditing}
                            dragDisabled={dragDisabled}
                          />
                        </div>
                      ))}
                    </div>
                  </DndContext>
                </>
              ) : (
                <div className="list-panel">
                  {visible.length ? (
                    visible.map((t) => (
                      <div className="list-row" key={t.id}>
                        <div>
                          <span className="task-key">{t.id}</span>
                          <h3>{t.title}</h3>
                          <p>
                            {LABELS[t.status]} · {PRIORITY[t.priority]} ·{" "}
                            {dateText(t.dueDate)}
                          </p>
                        </div>
                        <div className="list-actions">
                          <Avatar
                            user={persons.find((p) => p.id === t.assigneeId)}
                          />
                          {admin && (
                            <button
                              className="secondary small"
                              onClick={() =>
                                run(
                                  async () =>
                                    view === "archive"
                                      ? backend.archiveTask(
                                          t.id,
                                          t.version,
                                          true,
                                        )
                                      : backend.deleteTask(
                                          t.id,
                                          t.version,
                                          true,
                                        ),
                                  "복원되었습니다.",
                                )
                              }
                            >
                              <RotateCcw size={15} /> 복원
                            </button>
                          )}
                          {view === "archive" && (
                            <button
                              className="secondary small"
                              onClick={() => setEditing(t)}
                            >
                              보기
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <Inbox size={34} />
                      <h3>표시할 업무가 없습니다</h3>
                      <p>다른 검색 조건을 선택해 보세요.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <section className="settings-panel">
              <div className="page-header">
                <div>
                  <div className="eyebrow">TEAM MANAGEMENT</div>
                  <h1>팀 설정</h1>
                  <p>팀원과 프로젝트를 관리하세요.</p>
                </div>
              </div>
              <div className="setting-card">
                <div className="setting-head">
                  <div>
                    <h2>
                      <Users size={19} /> 팀원 관리
                    </h2>
                    <p>현재 워크스페이스에 참여한 팀원입니다.</p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => {
                      const email = prompt(
                        "초대할 팀원의 이메일을 입력하세요.",
                      );
                      if (email?.trim())
                        run(
                          async () =>
                            setInviteLink(
                              await backend.invite(email.trim().toLowerCase()),
                            ),
                          "초대 링크가 생성되었습니다.",
                        );
                    }}
                  >
                    <UserPlus size={16} /> 팀원 초대
                  </button>
                </div>
                {inviteLink && (
                  <div className="invite-generated">
                    <Link2 size={16} />
                    <input aria-label="초대 링크" readOnly value={inviteLink} />
                    <button
                      className="secondary small"
                      onClick={() => {
                        run(async () => {
                          await navigator.clipboard.writeText(inviteLink);
                        }, "초대 링크를 복사했습니다.");
                      }}
                    >
                      복사
                    </button>
                  </div>
                )}
                {persons.map((p) => (
                  <div className="member-row" key={p.id}>
                    <Avatar user={p} />
                    <div>
                      <b>{p.displayName}</b>
                      <small>{p.email}</small>
                    </div>
                    <span className="member-role">
                      {p.role === "admin" ? "관리자" : "팀원"}
                    </span>
                  </div>
                ))}
                <h3>초대 현황</h3>
                {state.invitations.map((i) => (
                  <div className="member-row" key={i.id}>
                    <span>{i.email}</span>
                    <small>
                      {i.status === "pending" &&
                      i.expiresAt < new Date().toISOString()
                        ? "만료"
                        : {
                            pending: "대기",
                            accepted: "수락",
                            revoked: "취소",
                            expired: "만료",
                          }[i.status]}{" "}
                      · {timestamp(i.expiresAt)}
                    </small>
                    {i.status === "pending" &&
                      i.expiresAt > new Date().toISOString() && (
                        <button
                          className="text-btn danger"
                          onClick={() => run(() => backend.revokeInvite(i.id))}
                        >
                          취소
                        </button>
                      )}
                  </div>
                ))}
              </div>
              <div className="setting-card">
                <div className="setting-head">
                  <div>
                    <h2>
                      <Layers3 size={19} /> 프로젝트 관리
                    </h2>
                    <p>보드를 생성하고 참여자를 관리합니다.</p>
                  </div>
                  <button
                    className="secondary small"
                    onClick={() => setBoardEditor(null)}
                  >
                    <Plus size={15} /> 보드 추가
                  </button>
                </div>
                {state.boards.map((b) => (
                  <div className="project-setting-row" key={b.id}>
                    <span className="project-dot" />
                    <strong>{b.name}</strong>
                    {b.deletedAt && <span className="small-muted">삭제됨</span>}
                    <span className="flex-space" />
                    <button
                      className="text-btn"
                      onClick={() =>
                        b.deletedAt
                          ? run(() => backend.removeBoard(b.id, true))
                          : setBoardEditor(b)
                      }
                    >
                      {b.deletedAt ? "복구" : "편집 · 참여자"}
                    </button>
                    {!b.deletedAt && (
                      <button
                        className="text-btn danger"
                        onClick={() => {
                          if (
                            confirm(
                              "보드를 삭제하시겠습니까? 복구할 수 있습니다.",
                            )
                          )
                            run(() => backend.removeBoard(b.id));
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      {boardEditor !== undefined && (
        <BoardEditor
          board={boardEditor}
          people={persons}
          userId={state.user.id}
          onClose={() => setBoardEditor(undefined)}
          onAction={run}
        />
      )}{" "}
      {editing !== undefined && (
        <TaskModal
          key={(editing?.id || "new") + reloadKey}
          task={editing || null}
          latestTask={state.tasks.find((t) => t.id === editing?.id)}
          onReload={(t) => {
            setEditing(t);
            setReloadKey((k) => k + 1);
          }}
          boardId={editing?.boardId || current?.id || ""}
          people={persons.filter(
            (p) =>
              p.role === "admin" ||
              state.boards
                .find((b) => b.id === (editing?.boardId || current?.id))
                ?.memberIds.includes(p.id),
          )}
          history={state.history}
          isAdmin={!!admin}
          onClose={() => setEditing(undefined)}
          onAction={run}
        />
      )}{" "}
      {toast && (
        <div className="toast">
          <ShieldCheck size={17} />
          {toast}
          <button onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {state.error && (
        <div role="alert" className="error-banner">
          {state.error}
          <button onClick={() => run(() => backend.refresh())}>
            다시 연결
          </button>
        </div>
      )}
    </div>
  );
}
export default App;
