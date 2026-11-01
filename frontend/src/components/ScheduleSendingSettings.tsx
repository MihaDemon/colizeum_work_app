import { useRef, useState } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { request } from "../lib/api";
import { useDraft } from "../lib/useDraft";

export type ScheduleContent = "both" | "plan" | "actual";
export const scheduleContentNames: Record<ScheduleContent, string> = {
  both: "План и факт",
  plan: "Только план",
  actual: "Только факт",
};
export interface ScheduleSettings {
  defaultAdminId: string | null;
  version: number;
  automaticEnabled: boolean;
  automaticContent: ScheduleContent;
  manualContent: ScheduleContent;
}

export function ScheduleSendingSettings({
  settings,
  onBack,
  onSave,
  onDirty,
}: {
  settings: ScheduleSettings;
  onBack: () => void;
  onSave: (settings: ScheduleSettings) => void;
  onDirty: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const retry = useRef<{ signature: string; key: string } | null>(null);
  useDraft(dirty, busy, "schedule-sending");
  const change = (values: Partial<ScheduleSettings>) => {
    setDraft({ ...draft, ...values });
    setDirty(true);
    onDirty(true);
    setError("");
    setMessage("");
  };
  return (
    <section className="cp-form-page schedule-sending">
      <button
        className="cp-back"
        disabled={busy}
        onClick={() => {
          if (
            !dirty ||
            window.confirm("Отменить несохранённые настройки отправки?")
          ) {
            onDirty(false);
            onBack();
          }
        }}
      >
        <IconArrowLeft size={18} />
        Назад к графику
      </button>
      <div className="cp-page-heading">
        <h1>Отправка графиков</h1>
      </div>
      <p className="cp-field-hint">
        Выберите, что включать в график. Эти настройки действуют для всего
        клуба.
      </p>
      <form
        className="cp-form-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          setMessage("");
          const body = JSON.stringify({
            version: draft.version,
            automatic_enabled: draft.automaticEnabled,
            automatic_content: draft.automaticContent,
            manual_content: draft.manualContent,
          });
          if (retry.current?.signature !== body)
            retry.current = { signature: body, key: crypto.randomUUID() };
          try {
            const saved = await request<ScheduleSettings>(
              "schedules/settings/",
              {
                method: "POST",
                body,
                headers: { "Idempotency-Key": retry.current.key },
              },
            );
            retry.current = null;
            setDraft(saved);
            setDirty(false);
            onDirty(false);
            onSave(saved);
            setMessage("Настройки отправки сохранены.");
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="cp-workspace-controls" disabled={busy}>
          <h2>Отправка кнопкой</h2>
          <label className="cp-field">
            Содержание ручной отправки
            <select
              value={draft.manualContent}
              onChange={(event) =>
                change({ manualContent: event.target.value as ScheduleContent })
              }
            >
              {Object.entries(scheduleContentNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="cp-field-hint">
            Кнопка отправляет изображение только нажавшему её сотруднику в
            личный чат с ботом.
          </p>
          <h2>Автоматическая рассылка</h2>
          <p className="cp-field-hint">
            После периода исправлений — управляющим и суперпользователям.
          </p>
          <label className="schedule-choice">
            Отправлять автоматически
            <input
              type="checkbox"
              checked={draft.automaticEnabled}
              onChange={(event) =>
                change({ automaticEnabled: event.target.checked })
              }
            />
          </label>
          <label className="cp-field">
            Содержание автоматической отправки
            <select
              disabled={!draft.automaticEnabled}
              value={draft.automaticContent}
              onChange={(event) =>
                change({
                  automaticContent: event.target.value as ScheduleContent,
                })
              }
            >
              {Object.entries(scheduleContentNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="cp-field-hint">
            План — назначения в выбранной версии графика. Факт — сотрудники,
            которые действительно открывали смены; незакрытые смены отмечены
            отдельно.
          </p>
          {error && (
            <p role="alert" className="cp-inline-error">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="cp-form-actions">
            <button className="cp-button cp-button-primary" disabled={!dirty}>
              {busy ? "Сохраняем…" : "Сохранить настройки отправки"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
