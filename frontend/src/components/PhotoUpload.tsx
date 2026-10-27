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
            ? "Reading photo…"
            : value
              ? name || "Photo attached · Click to replace"
              : "JPG, PNG or WebP · up to 5 MB"}
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
            onError("Choose a JPG, PNG, or WebP image.");
            e.target.value = "";
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            onError("This photo is too large. Choose an image under 5 MB.");
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
            onError("The photo could not be read. Please choose it again.");
          };
          reader.readAsDataURL(file);
        }}
      />
    </label>
  );
}
