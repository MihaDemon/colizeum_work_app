import { useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconPlus, IconPencil } from "@tabler/icons-react";
import { request } from "../lib/api";
import { useDraft } from "../lib/useDraft";
import {
  photoFieldsError,
  type PhotoMode,
  type PhotoRequirement,
} from "../lib/workspace";
import Upload from "./PhotoUpload";
import { PhotoFieldsEditor } from "./PhotoFields";
import "./automatic-tasks.css";

interface Template {
  id: string;
  title: string;
  description: string;
  shiftType: "both" | "day" | "night";
  enabled: boolean;
  priority: "normal" | "high" | "low";
  photoMode: PhotoMode;
  photoRequirements: PhotoRequirement[];
  referencePhoto: string | null;
  version: number;
  creatorName: string;
  canEdit: boolean;
}
const shiftNames = {
  both: "Любая смена",
  day: "Дневная смена",
  night: "Ночная смена",
};

export function AutomaticTasksPage({
  onBack,
  onDirty,
}: {
  onBack: () => void;
  onDirty: (value: boolean) => void;
}) {
  const [items, setItems] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void request<Template[]>("automatic-tasks/", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems(data);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  return (
    <section className="cp-form-page automatic-tasks">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад в «Ещё»
      </button>
      <div className="cp-page-heading">
        <h1>Автоматические задачи</h1>
        {editing === undefined && (
          <button
            className="cp-button cp-button-primary"
            onClick={() => setEditing(null)}
          >
            <IconPlus size={18} />
            Создать автозадачу
          </button>
        )}
      </div>
      <p className="cp-field-hint">
        Задачи создаются при открытии подходящей смены. Перед её закрытием их
        нужно отправить на проверку; ждать принятия не требуется. Изменения
        шаблонов применяются к следующим сменам.
      </p>
      {error && (
        <div role="alert" className="cp-inline-error">
          {error}{" "}
          <button
            className="cp-button cp-button-secondary"
            onClick={() => setReload((v) => v + 1)}
          >
            Обновить список
          </button>
        </div>
      )}
      {editing !== undefined ? (
        <TemplateForm
          key={editing?.id || "new"}
          template={editing}
          onDirty={onDirty}
          onCancel={() => {
            onDirty(false);
            setEditing(undefined);
          }}
          onSaved={(saved) => {
            setItems((current) => [
              ...current.filter((item) => item.id !== saved.id),
              saved,
            ]);
            onDirty(false);
            setEditing(undefined);
          }}
        />
      ) : loading ? (
        <p role="status">Загружаем автоматические задачи…</p>
      ) : items.length ? (
        <div className="cp-records">
          {items.map((item) => (
            <section className="automatic-template" key={item.id}>
              <div className="cp-section-heading">
                <h2>{item.title}</h2>
                {item.canEdit && (
                  <button
                    className="cp-button cp-button-secondary"
                    aria-label={`Изменить: ${item.title}`}
                    onClick={() => setEditing(item)}
                  >
                    <IconPencil size={17} />
                    Изменить
                  </button>
                )}
              </div>
              <p>
                {shiftNames[item.shiftType]} ·{" "}
                {item.enabled ? "Включена" : "Выключена"}
              </p>
              {item.description && (
                <p className="cp-description">{item.description}</p>
              )}
              <p className="cp-field-hint">
                Постановщик: {item.creatorName}
                {item.photoMode !== "optional"
                  ? " · Нужны фотографии выполнения"
                  : ""}
              </p>
            </section>
          ))}
        </div>
      ) : (
        <div className="cp-empty">
          <h2>Автоматических задач пока нет</h2>
          <p>Создайте первую задачу для дневных, ночных или всех смен.</p>
        </div>
      )}
    </section>
  );
}

function TemplateForm({
  template,
  onCancel,
  onSaved,
  onDirty,
}: {
  template: Template | null;
  onCancel: () => void;
  onSaved: (template: Template) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(template?.title || "");
  const [description, setDescription] = useState(template?.description || "");
  const [shiftType, setShiftType] = useState(template?.shiftType || "both");
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const [priority, setPriority] = useState(template?.priority || "normal");
  const [mode, setMode] = useState<PhotoMode>(
    template?.photoMode || "optional",
  );
  const [fields, setFields] = useState<PhotoRequirement[]>(
    template?.photoRequirements || [],
  );
  const [reference, setReference] = useState(template?.referencePhoto || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  useDraft(dirty, busy, "automatic-tasks");
  const changed = () => {
    setDirty(true);
    onDirty(true);
    setError("");
  };
  return (
    <form
      className="cp-form-panel"
      onChange={changed}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const validation =
          mode === "named"
            ? photoFieldsError(fields) ||
              (!fields.length ? "Добавьте поля фотографий." : "")
            : "";
        if (!title.trim() || validation) {
          setError(validation || "Укажите название задачи.");
          return;
        }
        const values = {
          title: title.trim(),
          description: description.trim(),
          shift_type: shiftType,
          enabled,
          priority,
          photo_mode: mode,
          photo_requirements: mode === "named" ? fields : [],
          clear_reference_photo: Boolean(
            template?.referencePhoto && !reference,
          ),
          ...(template ? { version: template.version } : {}),
        };
        const signature = JSON.stringify({ ...values, reference });
        if (retry.current?.signature !== signature)
          retry.current = { signature, key: crypto.randomUUID() };
        setBusy(true);
        setError("");
        try {
          const body = new FormData();
          Object.entries(values).forEach(([key, value]) =>
            body.append(
              key,
              typeof value === "object" ? JSON.stringify(value) : String(value),
            ),
          );
          if (reference.startsWith("data:image/")) {
            const image = await (await fetch(reference)).blob();
            body.append(
              "reference_photo",
              image,
              `reference.${image.type.split("/")[1]}`,
            );
          }
          const saved = await request<Template>(
            `automatic-tasks/${template ? `${template.id}/` : ""}`,
            {
              method: "POST",
              body,
              headers: { "Idempotency-Key": retry.current.key },
            },
          );
          retry.current = null;
          onSaved(saved);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="cp-workspace-controls" disabled={busy}>
        <label className="cp-field">
          Название задачи
          <input
            aria-label="Название автоматической задачи"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="cp-field">
          Инструкции
          <textarea
            aria-label="Инструкции автоматической задачи"
            rows={4}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="cp-field">
          Создавать для смен
          <select
            aria-label="Смена автоматической задачи"
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as typeof shiftType)}
          >
            {Object.entries(shiftNames).map(([value, text]) => (
              <option value={value} key={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="automatic-task-toggle">
          <span>Создавать автоматически</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>
        <label className="cp-field">
          Приоритет
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
            <option value="low">Низкий</option>
          </select>
        </label>
        <label className="cp-field">
          Фотографии выполнения
          <select
            aria-label="Фото автоматической задачи"
            value={mode}
            onChange={(e) => setMode(e.target.value as PhotoMode)}
          >
            <option value="optional">Необязательное фото</option>
            <option value="single">Одно обязательное фото</option>
            <option value="multiple">Несколько обязательных фото</option>
            <option value="named">Фото по указанным полям</option>
          </select>
        </label>
        {mode === "named" && (
          <PhotoFieldsEditor
            fields={fields}
            onChange={(next) => {
              setFields(next);
              changed();
            }}
          />
        )}
        <Upload
          label="Фото-пример"
          value={reference}
          onError={setError}
          onChange={(value) => {
            setReference(value);
            changed();
          }}
        />
        {reference && (
          <button
            type="button"
            className="cp-text-button"
            onClick={() => {
              setReference("");
              changed();
            }}
          >
            Убрать фото-пример
          </button>
        )}
        {error && (
          <p role="alert" className="cp-inline-error">
            {error}
          </p>
        )}
        <div className="cp-form-actions">
          <button
            type="button"
            className="cp-button cp-button-secondary"
            onClick={() => {
              if (!dirty || window.confirm("Отменить несохранённые изменения?"))
                onCancel();
            }}
          >
            Отмена
          </button>
          <button className="cp-button cp-button-primary">
            {busy ? "Сохраняем…" : "Сохранить автозадачу"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
