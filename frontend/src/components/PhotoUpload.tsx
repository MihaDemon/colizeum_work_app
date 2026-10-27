import { useState } from "react";
import { IconCamera, IconCircleCheck, IconUpload } from "@tabler/icons-react";
import { PrivateImage } from "./PrivateImage";

export default function Upload({
  label,
  value,
  onChange,
  onError,
  required = false,
}: {
  label: string;
  value?: string;
  onChange: (url: string, name: string) => void;
  onError: (error: string) => void;
  required?: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <label className={`cp-upload${value ? " cp-upload-done" : ""}`}>
      {value ? (
        <PrivateImage src={value} alt={label} />
      ) : (
        <IconCamera size={24} stroke={1.4} />
      )}
      <span>
        <strong>
          {label}
          {required && <span className="cp-required"> *</span>}
        </strong>
        <small>
          {busy
            ? "Читаем фотографию…"
            : value
              ? name || "Фотография добавлена · Нажмите, чтобы заменить"
              : "JPG, PNG или WebP · до 5 МБ"}
        </small>
      </span>
      {value ? <IconCircleCheck size={21} /> : <IconUpload size={18} />}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            onError("Выберите изображение в формате JPG, PNG или WebP.");
            e.target.value = "";
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            onError(
              "Фотография слишком большая. Выберите изображение не более 5 МБ.",
            );
            e.target.value = "";
            return;
          }
          setBusy(true);
          const reader = new FileReader();
          reader.onload = () => {
            onChange(String(reader.result), file.name);
            setName(file.name);
            setBusy(false);
            onError("");
          };
          reader.onerror = () => {
            setBusy(false);
            onError("Не удалось прочитать фотографию. Выберите её ещё раз.");
          };
          reader.readAsDataURL(file);
        }}
      />
    </label>
  );
}
