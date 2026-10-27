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
            Photo name {index + 1}
            <input
              maxLength={100}
              value={field.label}
              placeholder="For example, administrator desk"
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
                aria-label={`Required photo ${index + 1}`}
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
              Required
            </label>
            <button
              className="cp-text-button"
              type="button"
              aria-label={`Remove photo field ${index + 1}`}
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
        <IconPlus size={18} /> Add photo field
      </button>
    </div>
  );
}

function readPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return Promise.reject(new Error("Choose JPG, PNG, or WebP photos."));
  if (file.size > 5 * 1024 * 1024)
    return Promise.reject(new Error("Choose photos under 5 MB each."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("A photo could not be read. Please choose it again."));
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
                  Remove {field.label}
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
          label="Completion photo"
          required={mode === "single"}
          value={photos[0]?.url}
          onError={onError}
          onChange={(url) =>
            onChange([{ url, slot: "", label: "Completion photo" }])
          }
        />
        {photos.length > 0 && (
          <button
            type="button"
            className="cp-text-button"
            onClick={() => remove(0)}
          >
            Remove photo
          </button>
        )}
      </>
    );
  return (
    <>
      {photos.map((photo, index) => (
        <div key={photo.id || `${index}-${photo.url.slice(-30)}`}>
          <Upload
            label={`Completion photo ${index + 1}`}
            value={photo.url}
            onError={onError}
            onChange={(url) =>
              onChange(
                photos.map((item, i) =>
                  i === index
                    ? { url, slot: "", label: `Photo ${index + 1}` }
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
            Remove photo {index + 1}
          </button>
        </div>
      ))}
      <label className="cp-field">
        Completion photos
        <input
          type="file"
          aria-label="Completion photos"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={reading || photos.length >= 10}
          onChange={async (event) => {
            const input = event.currentTarget;
            const selected = Array.from(input.files || []);
            if (!selected.length) return;
            if (photos.length + selected.length > 10) {
              onError("Attach at most 10 photos.");
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
                  label: `Photo ${photos.length + i + 1}`,
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
            ? "Reading photos…"
            : `${photos.length}/10 photos · up to 5 MB each, 15 MB combined`}
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
        <IconArrowLeft size={18} /> Back to more
      </button>
      <div className="cp-page-heading">
        <h1>Report photos</h1>
      </div>
      <p className="cp-field-hint">
        Name the photos administrators should send when closing a shift. Changes
        apply to new shifts; the active shift keeps its current requirements.
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
              "Report photo requirements saved.",
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
            New shifts will not require closing photos.
          </p>
        )}
        {error && (
          <p role="alert" className="cp-inline-error">
            {error}
          </p>
        )}
        <div className="cp-form-actions">
          <button className="cp-button cp-button-primary">
            Save photo requirements
          </button>
        </div>
      </form>
    </div>
  );
}
