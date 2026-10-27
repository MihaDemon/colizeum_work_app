import { useEffect, useRef, type ReactNode } from "react";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { telegram, inTelegram } from "../lib/telegram";

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="error-notice" role="alert">
      <IconAlertCircle size={20} />
      <div>{message}</div>
      {retry && (
        <button className="text-button" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty-state" role="status">
      <IconLoader2 className="spin" size={28} />
      <p>Загружаем данные…</p>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Back({ onClick }: { onClick: () => void }) {
  useEffect(() => {
    const app = telegram();
    if (!inTelegram() || !app?.isVersionAtLeast("6.1")) return;
    app.BackButton.show();
    app.BackButton.onClick(onClick);
    return () => {
      app.BackButton.offClick(onClick);
      app.BackButton.hide();
    };
  }, [onClick]);
  return (
    <button type="button" className="back-button" onClick={onClick}>
      <IconArrowLeft size={20} />
      Назад
    </button>
  );
}
export function Confirm({
  title,
  children,
  busy,
  onCancel,
  onConfirm,
  confirmLabel = "Удалить",
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          aria-label="Закрыть"
          className="icon-button"
          disabled={busy}
          onClick={onCancel}
        >
          <IconX size={22} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      <div className="button-row">
        <button className="secondary-button" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
        <button className="danger-button" disabled={busy} onClick={onConfirm}>
          {busy ? "Подождите…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
