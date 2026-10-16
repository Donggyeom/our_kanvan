import { useState } from "react";
import { X } from "lucide-react";
import type { Board, User } from "./types";
import { backend } from "./store";
import { useDialog } from "./dialog";
export function BoardEditor({
  board,
  people,
  userId,
  onClose,
  onAction,
}: {
  board: Board | null;
  people: User[];
  userId: string;
  onClose: () => void;
  onAction: (f: () => Promise<void>) => Promise<void>;
}) {
  const [name, setName] = useState(board?.name || ""),
    [description, setDescription] = useState(board?.description || ""),
    [members, setMembers] = useState(
      board?.memberIds || people.map((p) => p.id),
    ),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const close = () => {
    if (!dirty || confirm("저장하지 않은 변경 사항을 버리시겠습니까?"))
      onClose();
  };
  const ref = useDialog(close);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-label="프로젝트 편집"
      >
        <div className="modal-head">
          <h2>{board ? "프로젝트 편집" : "새 프로젝트"}</h2>
          <button className="icon-btn" aria-label="닫기" onClick={close}>
            <X />
          </button>
        </div>
        <form
          className="task-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onAction(async () => {
              if (board)
                await backend.updateBoard(board.id, {
                  name,
                  description,
                  memberIds: members,
                });
              else await backend.createBoard(name, description);
              onClose();
            });
            setBusy(false);
          }}
        >
          <label>
            보드 이름
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            보드 설명
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {board && (
            <fieldset className="member-picker">
              <legend>보드 참여자</legend>
              {people.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={members.includes(p.id)}
                    disabled={p.id === userId}
                    onChange={(e) => {
                      setMembers(
                        e.target.checked
                          ? [...members, p.id]
                          : members.filter((id) => id !== p.id),
                      );
                      setDirty(true);
                    }}
                  />
                  <span>
                    {p.displayName} <small>{p.email}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="task-meta">
            관리자는 모든 보드에 접근할 수 있습니다. 새 보드에는 현재 팀원이
            기본 참여합니다.
          </p>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              취소
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "저장 중..." : "보드 저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
