import { useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { request } from "../lib/api";
import { confirmAction, haptic } from "../lib/telegram";
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
  onEditorBackChange,
}: {
  onBack: () => void;
  onDirty: (value: boolean) => void;
  onEditorBackChange: (handler: (() => void) | null) => void;
}) {
  const [items, setItems] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const retries = useRef(new Map<string, { signature: string; key: string }>());
  useDraft(false, pending !== null, "automatic-task-list");
  useEffect(() => {
    onEditorBackChange(
      editing === undefined
        ? null
        : () => {
            onDirty(false);
            setEditing(undefined);
          },
    );
    return () => onEditorBackChange(null);
  }, [editing, onDirty, onEditorBackChange]);

  const changeTemplate = async (
    item: Template,
    action: "toggle" | "delete",
  ) => {
    if (running.current) return;
    running.current = true;
    try {
      if (
        action === "delete" &&
        !(await confirmAction(
          `Удалить автозадачу «${item.title.length > 80 ? `${item.title.slice(0, 80)}…` : item.title}»? Новые задачи создаваться не будут. Уже выданные задачи останутся у сотрудников.`,
        ))
      )
        return;
      setPending(item.id);
      setError("");
      setNotice("");
      const body = JSON.stringify({
        version: item.version,
        ...(action === "toggle" ? { enabled: !item.enabled } : {}),
      });
      const signature = `${action}:${body}`;
      if (retries.current.get(item.id)?.signature !== signature)
        retries.current.set(item.id, { signature, key: crypto.randomUUID() });
      const saved = await request<Template>(`automatic-tasks/${item.id}/`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        body,
        headers: { "Idempotency-Key": retries.current.get(item.id)!.key },
      });
      retries.current.delete(item.id);
      setItems((current) =>
        action === "delete"
          ? current.filter((value) => value.id !== item.id)
          : current.map((value) => (value.id === item.id ? saved : value)),
      );
      setNotice(
        action === "delete"
          ? "Автозадача удалена. Уже выданные задачи сохранены."
          : saved.enabled
            ? "Автосоздание включено для следующих смен."
            : "Автосоздание выключено. Уже выданные задачи сохранены.",
      );
      haptic("success");
    } catch (err) {
      setError((err as Error).message);
      haptic("error");
    } finally {
      setPending(null);
      running.current = false;
    }
  };
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
      <button className="cp-back" onClick={onBack} disabled={pending !== null}>
        <IconArrowLeft size={18} />
        {editing === undefined ? "Назад в «Ещё»" : "Назад к списку"}
      </button>
      <div className="cp-page-heading">
        <h1>Автоматические задачи</h1>
      </div>
      <p className="automatic-tasks-intro">
        {editing === undefined
          ? "Задачи для каждой смены. Администратор отправляет их на проверку перед закрытием — ждать принятия не требуется."
          : "Настройте задачу и требования к выполнению. Изменения применятся к следующим сменам."}
      </p>
      {editing === undefined && (
        <div className="automatic-tasks-toolbar">
          <button
            className="cp-button cp-button-primary"
            onClick={() => {
              setNotice("");
              setEditing(null);
            }}
            disabled={pending !== null || loading}
          >
            <IconPlus size={18} />
            Создать автозадачу
          </button>
          <p className="cp-field-hint">
            Включайте и выключайте автосоздание прямо в списке.
          </p>
        </div>
      )}
      {notice && (
        <p className="automatic-tasks-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="cp-inline-error">
          {error}{" "}
          <button
            className="cp-button cp-button-secondary"
            onClick={() => setReload((v) => v + 1)}
            disabled={pending !== null}
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
            <section
              className="automatic-template"
              key={item.id}
              aria-label={item.title}
              aria-busy={pending === item.id}
            >
              <div className="automatic-template-heading">
                <h2>{item.title}</h2>
                <span
                  className={`automatic-template-state${item.enabled ? " is-enabled" : ""}`}
                >
                  {item.enabled ? "Включена" : "Выключена"}
                </span>
              </div>
              <p className="automatic-template-meta">
                {shiftNames[item.shiftType]} ·{" "}
                {
                  {
                    normal: "Обычный приоритет",
                    high: "Высокий приоритет",
                    low: "Низкий приоритет",
                  }[item.priority]
                }
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
              <div className="automatic-template-controls">
                <label className="automatic-template-switch">
                  <span>Создавать автоматически</span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Создавать автоматически: ${item.title}`}
                    checked={item.enabled}
                    disabled={!item.canEdit || pending !== null}
                    onChange={() => void changeTemplate(item, "toggle")}
                  />
                </label>
                {item.canEdit && (
                  <div className="automatic-template-actions">
                    <button
                      className="cp-button cp-button-secondary"
                      aria-label={`Изменить: ${item.title}`}
                      disabled={pending !== null}
                      onClick={() => {
                        setNotice("");
                        setEditing(item);
                      }}
                    >
                      <IconPencil size={17} />
                      Изменить
                    </button>
                    <button
                      className="cp-button cp-button-secondary automatic-template-delete"
                      aria-label={`Удалить: ${item.title}`}
                      disabled={pending !== null}
                      onClick={() => void changeTemplate(item, "delete")}
                    >
                      <IconTrash size={17} />
                      Удалить
                    </button>
                  </div>
                )}
              </div>
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
          enabled: template?.enabled ?? true,
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
