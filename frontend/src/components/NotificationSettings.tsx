import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useDraft } from "../lib/useDraft";
import "./notification-settings.css";

const categories = [
  ["task_assigned", "Новые задачи"],
  ["task", "Задачи на проверке"],
  ["shift_open", "Открытие смены"],
  ["shift_close", "Закрытие смены"],
  ["expense", "Расходы из кассы"],
  ["cleaner", "Приход уборщицы"],
  ["schedule", "Итоговый график смен"],
] as const;
type Kind = (typeof categories)[number][0];
type Preferences = Record<Kind, boolean>;

export function NotificationSettings({
  isSuperuser,
}: {
  isSuperuser: boolean;
}) {
  const availableCategories = categories.filter(
    ([kind]) => !isSuperuser || kind !== "task_assigned",
  );
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<Preferences>("notification-settings/", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSaved(value);
          setDraft(value);
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [revision]);
  const changed =
    draft &&
    saved &&
    availableCategories.some(([kind]) => draft[kind] !== saved[kind]);
  useDraft(Boolean(changed), busy, "notification-settings");
  return (
    <section
      className="cp-telegram-settings"
      aria-labelledby="telegram-settings-title"
    >
      <h2 id="telegram-settings-title">Сообщения в Telegram</h2>
      <p className="cp-field-hint">
        Выберите, о чём бот будет писать вам в личный чат. Все события останутся
        в уведомлениях приложения.
      </p>
      {error && (
        <p className="cp-inline-error" role="alert">
          {error}
        </p>
      )}
      {!draft ? (
        error ? (
          <button
            className="cp-button cp-button-secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку
          </button>
        ) : (
          <p role="status">Загружаем настройки…</p>
        )
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !changed) return;
            setBusy(true);
            setError("");
            setSuccess(false);
            const patch = Object.fromEntries(
              availableCategories
                .filter(([kind]) => draft[kind] !== saved?.[kind])
                .map(([kind]) => [kind, draft[kind]]),
            );
            try {
              const value = await request<Preferences>(
                "notification-settings/",
                { method: "PATCH", body: JSON.stringify(patch) },
              );
              setSaved(value);
              setDraft(value);
              setSuccess(true);
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Не удалось сохранить настройки. Повторите попытку.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="cp-telegram-options">
            {availableCategories.map(([kind, label]) => (
              <label className="cp-telegram-option" key={kind}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={draft[kind]}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...draft, [kind]: event.target.checked });
                    setSuccess(false);
                  }}
                />
              </label>
            ))}
          </div>
          <button
            className="cp-button cp-button-primary"
            type="submit"
            disabled={busy || !changed}
          >
            {busy ? "Сохраняем…" : "Сохранить настройки"}
          </button>
          {success && <p role="status">Настройки сохранены.</p>}
        </form>
      )}
    </section>
  );
}
