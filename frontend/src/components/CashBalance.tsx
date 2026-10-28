import { useEffect, useRef, useState, type FormEvent } from "react";
import { IconPencil } from "@tabler/icons-react";
import { ApiError, request } from "../lib/api";
import { money, validAmount } from "../lib/format";
import { useDraft } from "../lib/useDraft";
import "./cash-balance.css";

export function CashBalance({
  balance,
  editable,
  onSaved,
  onRefresh,
  onDirty,
  onBusy,
}: {
  balance: number;
  editable: boolean;
  onSaved: () => Promise<void>;
  onRefresh?: () => Promise<void>;
  onDirty?: (value: boolean) => void;
  onBusy?: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const running = useRef(false);
  const pending = useRef<{ body: string; key: string } | null>(null);
  const dirty = editing && amount.replace(",", ".") !== expected;
  useDraft(dirty, busy, "cash");

  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);

  if (!editable) return <strong>{money(balance)}</strong>;

  const close = () => {
    setEditing(false);
    setError("");
    setConflict(false);
    pending.current = null;
  };
  const open = () => {
    const current = balance.toFixed(2);
    setExpected(current);
    setAmount(current.replace(".", ","));
    setSaved(false);
    setError("");
    setConflict(false);
    setEditing(true);
    pending.current = null;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (running.current || conflict) return;
    const value = amount.trim();
    if (!validAmount(value) || value.split(/[.,]/)[0].length > 18) {
      setError("Введите сумму от 0 с точностью до двух знаков после запятой.");
      return;
    }
    const body = JSON.stringify({
      balance: value.replace(",", "."),
      expected_balance: expected,
    });
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await request("cash-adjustment/", {
        method: "POST",
        headers: { "Idempotency-Key": pending.current.key },
        body,
      });
      setSaved(true);
      await onSaved();
      close();
    } catch (caught) {
      setError((caught as Error).message);
      setConflict(caught instanceof ApiError && caught.status === 409);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (!onRefresh || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onRefresh();
      close();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="cp-cash-control">
      {!editing ? (
        <button
          className="cp-cash-amount"
          type="button"
          aria-label={`Изменить остаток кассы: ${money(balance)}`}
          onClick={open}
        >
          <strong>{money(balance)}</strong>
          <IconPencil size={16} aria-hidden="true" />
        </button>
      ) : (
        <form className="cp-cash-editor" onSubmit={submit}>
          <label className="cp-field">
            Новый остаток кассы, ₽
            <input
              autoFocus
              inputMode="decimal"
              maxLength={21}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={busy || saved}
            />
          </label>
          <p className="cp-field-hint">
            Остаток при открытии: {money(Number(expected))}
          </p>
          {saved && (
            <p role="status">Остаток сохранён. Обновляем данные приложения.</p>
          )}
          {error && (
            <p className="cp-error" role="alert">
              {error}
            </p>
          )}
          <div className="cp-form-actions">
            <button
              className="cp-button cp-button-secondary"
              type="button"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </button>
            {(conflict || saved) && onRefresh ? (
              <button
                className="cp-button cp-button-primary"
                type="button"
                disabled={busy}
                onClick={refresh}
              >
                {busy ? "Обновляем…" : "Обновить данные"}
              </button>
            ) : (
              <button
                className="cp-button cp-button-primary"
                type="submit"
                disabled={busy || conflict}
              >
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
