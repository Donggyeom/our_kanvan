import type { Backend, Snapshot } from "./store";
import { ConflictError } from "./types";

export function createSharedBackend(): Backend {
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let current: Snapshot = {
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
  let revision = -1;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  const emit = () => listeners.forEach((fn) => fn(structuredClone(current)));
  async function request(method: string, args: unknown[] = []) {
    const response = await fetch(
      method === "snapshot" ? "/api/snapshot" : "/api/rpc",
      {
        method: method === "snapshot" ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        ...(method === "snapshot"
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ method, args }),
            }),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        await refresh();
        throw new ConflictError();
      }
      throw Error(body.error || "서버 요청에 실패했습니다.");
    }
    if (body.revision >= revision) {
      revision = body.revision;
      current = {
        ...body.snapshot,
        loading: false,
        error: null,
        connection: "connected",
      };
      emit();
    }
    return body.result;
  }
  async function refresh() {
    if (pending) return pending;
    pending = request("snapshot")
      .catch(() => {
        current = {
          ...current,
          loading: false,
          error: current.user
            ? null
            : "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
          connection: "offline",
        };
        emit();
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  const backend = {
    refresh,
    subscribe(fn: (snapshot: Snapshot) => void) {
      listeners.add(fn);
      fn(structuredClone(current));
      if (!timer) {
        void refresh();
        timer = setInterval(() => void refresh(), 1000);
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  } as Backend;
  for (const method of [
    "createWorkspace",
    "login",
    "register",
    "logout",
    "reset",
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
  ] as const) {
    Object.assign(backend, {
      [method]: async (...args: unknown[]) => {
        if (method === "register")
          args.push(new URLSearchParams(location.search).get("invite") || "");
        const result = await request(method, args);
        return method === "invite"
          ? new URL(result, location.origin).href
          : result;
      },
    });
  }
  return backend;
}
