import { useCallback, useEffect, useRef, useState } from "react";
import Workspace from "./pages/Workspace";
import type {
  Action,
  EvidencePhoto,
  StaffMember,
  State,
} from "./lib/workspace";
import { ApiError, request } from "./lib/api";
import type { User } from "./lib/types";
import { Loading } from "./components/UI";

interface Snapshot {
  user: StaffMember;
  people: StaffMember[];
  state: State;
}

async function attach(body: FormData, field: string, value?: string) {
  if (!value?.startsWith("data:image/")) return;
  const blob = await (await fetch(value)).blob();
  const extension =
    blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
  body.append(field, blob, `${field}.${extension}`);
}

async function attachPhotos(
  body: FormData,
  photos: EvidencePhoto[],
  retain = false,
) {
  const slots: string[] = [];
  const retained: string[] = [];
  for (const photo of photos) {
    if (photo.url.startsWith("data:image/")) {
      await attach(body, "photos", photo.url);
      slots.push(photo.slot);
    } else if (photo.id) retained.push(photo.id);
  }
  body.append("photo_slots", JSON.stringify(slots));
  if (retain) body.append("retained_photos", JSON.stringify(retained));
}

export default function LiveWorkspace({ account }: { account: User }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const result = await request<Snapshot>("workspace/");
    if (version !== refreshVersion.current) return;
    snapshotRef.current = result;
    setSnapshot(result);
    setError("");
  }, []);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      if (!inFlight.current && document.visibilityState !== "hidden")
        void refresh().catch((e) => {
          if (mounted) setError((e as Error).message);
        });
    };
    update();
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      mounted = false;
      ++refreshVersion.current;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh]);

  const perform = async (action: Action) => {
    if (inFlight.current) throw new Error("Дождитесь завершения сохранения.");
    inFlight.current = true;
    ++refreshVersion.current;
    setBusy(true);
    try {
      let path = "";
      const body = new FormData();
      switch (action.type) {
        case "MARK_CLEANER":
          path = `shifts/${action.shiftId}/cleaner/`;
          body.append("confirmed", "true");
          break;
        case "OPEN_SHIFT":
          path = "shifts/open/";
          body.append("shift_type", action.shiftType);
          break;
        case "CLOSE_SHIFT": {
          const shift = snapshotRef.current?.state.shift;
          if (!shift)
            throw new Error("Эта смена уже закрыта. Обновите приложение.");
          path = `shifts/${shift.id}/close/`;
          body.append("cash", action.cash.toFixed(2));
          body.append("cards", action.cards.toFixed(2));
          body.append("sbp", action.sbp.toFixed(2));
          await attachPhotos(body, action.photos);
          break;
        }
        case "ADD_EXPENSE":
          path = "shift-expenses/";
          body.append("amount", action.amount.toFixed(2));
          body.append("description", action.description);
          await attach(body, "photo", action.photo);
          break;
        case "CREATE_TASK":
          path = "tasks/";
          body.append("title", action.task.title);
          body.append("description", action.task.description);
          body.append("assignee", action.task.adminId);
          body.append("priority", action.task.priority);
          body.append("requires_photo", String(action.task.requiresPhoto));
          body.append(
            "photo_mode",
            action.task.photoMode ||
              (action.task.requiresPhoto ? "single" : "optional"),
          );
          body.append(
            "photo_requirements",
            JSON.stringify(action.task.photoRequirements || []),
          );
          await attach(body, "reference_photo", action.task.referencePhoto);
          break;
        case "SUBMIT_TASK":
          path = `tasks/${action.taskId}/submit/`;
          body.append("note", action.note || "");
          if (action.photos) await attachPhotos(body, action.photos, true);
          else await attach(body, "photo", action.photo);
          break;
        case "SAVE_PHOTO_SETTINGS":
          path = "photo-settings/";
          body.append("report_fields", JSON.stringify(action.fields));
          body.append("version", String(action.version));
          break;
        case "REVIEW_TASK":
          path = `tasks/${action.taskId}/review/`;
          body.append("accept", String(action.accept));
          body.append("reason", action.reason || "");
          body.append("version", String(action.version || 0));
          break;
        default:
          throw new Error(
            "Не удалось выполнить действие. Обновите приложение.",
          );
      }
      const signature = JSON.stringify(action);
      if (retry.current?.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      await request(path, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": retry.current.key },
      });
      retry.current = null;
      // The command succeeded even if refreshing loses connection. Do not invite a duplicate save.
      await refresh().catch(() =>
        setError(
          "Сохранено. Восстанавливаем соединение, чтобы обновить данные…",
        ),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        await refresh().catch(() => {});
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (!snapshot)
    return error ? (
      <main className="auth-panel">
        <p role="alert">{error}</p>
        <button
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Повторить
        </button>
      </main>
    ) : (
      <Loading />
    );
  return (
    <Workspace
      workspace={{ ...snapshot, account, busy, error, perform, refresh }}
    />
  );
}
