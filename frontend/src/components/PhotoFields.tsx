import { useState } from "react";
import { IconArrowLeft, IconPlus, IconTrash } from "@tabler/icons-react";
import Upload from "./PhotoUpload";
import {
  photoFieldsError,
  type Action,
  type EvidencePhoto,
  type PhotoMode,
  type PhotoRequirement,
  type PhotoSettings,
} from "../lib/workspace";

export function PhotoFieldsEditor({
  fields,
  onChange,
}: {
  fields: PhotoRequirement[];
  onChange: (fields: PhotoRequirement[]) => void;
}) {
  return (
    <div className="cp-photo-fields">
      {fields.map((field, index) => (
        <div className="cp-photo-field-row" key={field.id}>
          <label className="cp-field">
            Название фотографии {index + 1}
            <input
              maxLength={100}
              value={field.label}
              placeholder="Например, стол администратора"
              onChange={(event) =>
                onChange(
                  fields.map((item) =>
                    item.id === field.id
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <div className="cp-photo-field-actions">
            <label>
              <input
                type="checkbox"
                aria-label={`Обязательное фото ${index + 1}`}
                checked={field.required}
                onChange={(event) =>
                  onChange(
                    fields.map((item) =>
                      item.id === field.id
                        ? { ...item, required: event.target.checked }
                        : item,
                    ),
                  )
                }
              />{" "}
              Обязательно
            </label>
            <button
              className="cp-text-button"
              type="button"
              aria-label={`Удалить поле для фото ${index + 1}`}
              onClick={() =>
                onChange(fields.filter((item) => item.id !== field.id))
              }
            >
              <IconTrash size={18} />
            </button>
          </div>
        </div>
      ))}
      <button
        className="cp-button cp-button-secondary"
        type="button"
        disabled={fields.length >= 10}
        onClick={() =>
          onChange([
            ...fields,
            { id: crypto.randomUUID(), label: "", required: true },
          ])
        }
      >
        <IconPlus size={18} /> Добавить поле для фото
      </button>
    </div>
  );
}

function readPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return Promise.reject(
      new Error("Выберите фотографии в формате JPG, PNG или WebP."),
    );
  if (file.size > 5 * 1024 * 1024)
    return Promise.reject(
      new Error("Размер каждой фотографии должен быть не более 5 МБ."),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(
        new Error("Не удалось прочитать фотографию. Выберите её ещё раз."),
      );
    reader.readAsDataURL(file);
  });
}

export function EvidenceUploads({
  mode,
  fields = [],
  photos,
  onChange,
  onError,
}: {
  mode: PhotoMode;
  fields?: PhotoRequirement[];
  photos: EvidencePhoto[];
  onChange: (photos: EvidencePhoto[]) => void;
  onError: (message: string) => void;
}) {
  const [reading, setReading] = useState(false);
  const remove = (index: number) =>
    onChange(photos.filter((_, i) => i !== index));
  if (mode === "named")
    return (
      <>
        {fields.map((field) => {
          const existing = photos.find((photo) => photo.slot === field.id);
          return (
            <div key={field.id}>
              <Upload
                label={field.label}
                required={field.required}
                value={existing?.url}
                onError={onError}
                onChange={(url) =>
                  onChange([
                    ...photos.filter((photo) => photo.slot !== field.id),
                    { url, slot: field.id, label: field.label },
                  ])
                }
              />
              {existing && (
                <button
                  type="button"
                  className="cp-text-button"
                  onClick={() =>
                    onChange(photos.filter((photo) => photo.slot !== field.id))
                  }
                >
                  Удалить {field.label}
                </button>
              )}
            </div>
          );
        })}
      </>
    );
  if (mode !== "multiple")
    return (
      <>
        <Upload
          label="Фото выполнения"
          required={mode === "single"}
          value={photos[0]?.url}
          onError={onError}
          onChange={(url) =>
            onChange([{ url, slot: "", label: "Фото выполнения" }])
          }
        />
        {photos.length > 0 && (
          <button
            type="button"
            className="cp-text-button"
            onClick={() => remove(0)}
          >
            Удалить фото
          </button>
        )}
      </>
    );
  return (
    <>
      {photos.map((photo, index) => (
        <div key={photo.id || `${index}-${photo.url.slice(-30)}`}>
          <Upload
            label={`Фото выполнения ${index + 1}`}
            value={photo.url}
            onError={onError}
            onChange={(url) =>
              onChange(
                photos.map((item, i) =>
                  i === index
                    ? { url, slot: "", label: `Фото ${index + 1}` }
                    : item,
                ),
              )
            }
          />
          <button
            className="cp-text-button"
            type="button"
            onClick={() => remove(index)}
          >
            Удалить фото {index + 1}
          </button>
        </div>
      ))}
      <label className="cp-field">
        Фотографии выполнения
        <input
          type="file"
          aria-label="Фотографии выполнения"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={reading || photos.length >= 10}
          onChange={async (event) => {
            const input = event.currentTarget;
            const selected = Array.from(input.files || []);
            if (!selected.length) return;
            if (photos.length + selected.length > 10) {
              onError("Можно прикрепить не более 10 фотографий.");
              input.value = "";
              return;
            }
            setReading(true);
            try {
              const urls = await Promise.all(selected.map(readPhoto));
              onChange([
                ...photos,
                ...urls.map((url, i) => ({
                  url,
                  slot: "",
                  label: `Фото ${photos.length + i + 1}`,
                })),
              ]);
              onError("");
            } catch (error) {
              onError((error as Error).message);
            } finally {
              input.value = "";
              setReading(false);
            }
          }}
        />
        <small>
          {reading
            ? "Читаем фотографии…"
            : `${photos.length}/10 фото · до 5 МБ каждое, до 15 МБ всего`}
        </small>
      </label>
    </>
  );
}

export function PhotoSettingsPage({
  settings,
  actorId,
  onBack,
  onSave,
  onDirty,
}: {
  settings: PhotoSettings;
  actorId: string;
  onBack: () => void;
  onSave: (action: Action, message: string) => Promise<boolean>;
  onDirty: () => void;
}) {
  const [fields, setFields] = useState(
    settings.reportFields.map((field) => ({ ...field })),
  );
  const [version, setVersion] = useState(settings.version);
  const [error, setError] = useState("");
  return (
    <div className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} /> Назад в «Ещё»
      </button>
      <div className="cp-page-heading">
        <h1>Фотографии отчёта</h1>
      </div>
      <p className="cp-field-hint">
        Укажите, какие фотографии администраторы должны отправлять при закрытии
        смены. Изменения применяются к новым сменам; в текущей смене требования
        сохраняются.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const message = photoFieldsError(fields);
          setError(message);
          if (
            !message &&
            (await onSave(
              {
                type: "SAVE_PHOTO_SETTINGS",
                actorId,
                version,
                fields: fields.map((field) => ({
                  ...field,
                  label: field.label.trim(),
                })),
              },
              "Требования к фотографиям отчёта сохранены.",
            ))
          )
            setVersion(version + 1);
        }}
      >
        <PhotoFieldsEditor
          fields={fields}
          onChange={(next) => {
            setFields(next);
            onDirty();
          }}
        />
        {!fields.length && (
          <p className="cp-field-hint">
            Для новых смен фотографии закрытия не потребуются.
          </p>
        )}
        {error && (
          <p role="alert" className="cp-inline-error">
            {error}
          </p>
        )}
        <div className="cp-form-actions">
          <button className="cp-button cp-button-primary">
            Сохранить требования к фото
          </button>
        </div>
      </form>
    </div>
  );
}
