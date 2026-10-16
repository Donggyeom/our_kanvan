import type {
  Board,
  History,
  Invitation,
  Task,
  TaskInput,
  User,
  Status,
  ChatMessage,
} from "./types";
import { DemoBackend } from "./local-backend";
import { createSharedBackend } from "./shared-backend";
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
  messages?: ChatMessage[];
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
  sendMessage?: (
    taskId: string,
    text: string,
    clientId: string,
  ) => Promise<void>;
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
export const backend: Backend =
  import.meta.env.VITE_SHARED_MODE === "true"
    ? createSharedBackend()
    : firebaseEnabled
      ? new FirebaseBackend()
      : new DemoBackend();
