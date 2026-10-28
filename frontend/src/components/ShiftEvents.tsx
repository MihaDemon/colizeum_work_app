import { useEffect, useState } from "react";
import {
  IconArrowLeft,
  IconCalendarMonth,
  IconRefresh,
} from "@tabler/icons-react";
import { request } from "../lib/api";
import { cleanerDateTime, money, time } from "../lib/format";
import type { Expense, Shift } from "../lib/workspace";
import { PrivateImage } from "./PrivateImage";

export type RecordTarget = { kind: "shift" | "expense"; id: string };
export function notificationTarget(search: string): RecordTarget | null {
  const params = new URLSearchParams(search);
  for (const kind of ["shift", "expense"] as const) {
    const id = params.get(kind);
    if (id && /^[1-9]\d*$/.test(id)) return { kind, id };
  }
  return null;
}
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export function currentMonth() {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Moscow",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

function useRecord<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void request<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, retry: () => setRevision((value) => value + 1) };
}
function FetchState({ error, retry }: { error: string; retry: () => void }) {
  return error ? (
    <div role="alert">
      <p className="cp-inline-error">Не удалось загрузить запись. {error}</p>
      <button className="cp-button cp-button-secondary" onClick={retry}>
        <IconRefresh size={18} />
        Повторить
      </button>
    </div>
  ) : (
    <p role="status">Загружаем…</p>
  );
}

export function NotificationDetails({
  target,
  onBack,
}: {
  target: RecordTarget;
  onBack: () => void;
}) {
  const { data, error, retry } = useRecord<Shift | Expense>(
    target.kind === "shift"
      ? `shifts/${target.id}/`
      : `shift-expenses/${target.id}/`,
  );
  const shift = target.kind === "shift" ? (data as Shift | null) : null;
  const expense = target.kind === "expense" ? (data as Expense | null) : null;
  return (
    <section className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад
      </button>
      <div className="cp-page-heading">
        <h1>{target.kind === "shift" ? "Детали смены" : "Расход из кассы"}</h1>
      </div>
      {!data ? (
        <FetchState error={error} retry={retry} />
      ) : (
        <div className="cp-form-panel">
          <p>{data.adminName || "Сотрудник"}</p>
          {shift && (
            <>
              <h2>{shift.type === "day" ? "Дневная смена" : "Ночная смена"}</h2>
              <p>
                Открыта: {date(shift.openedAt)} в {time(shift.openedAt)}
              </p>
              <p>
                {shift.closedAt
                  ? `Закрыта: ${date(shift.closedAt)} в ${time(shift.closedAt)}`
                  : "Смена открыта"}
              </p>
              {shift.closedAt ? (
                <>
                  <div className="cp-history-details">
                    <span>
                      Наличные<strong>{money(shift.cash ?? 0)}</strong>
                    </span>
                    <span>
                      Карта<strong>{money(shift.cards ?? 0)}</strong>
                    </span>
                    <span>
                      СБП<strong>{money(shift.sbp ?? 0)}</strong>
                    </span>
                  </div>
                  <div className="cp-form-total">
                    <span>Общая выручка за смену</span>
                    <strong>
                      {money(
                        Number(
                          shift.total ??
                            (shift.cash ?? 0) +
                              (shift.cards ?? 0) +
                              (shift.sbp ?? 0),
                        ),
                      )}
                    </strong>
                  </div>
                </>
              ) : (
                <div className="cp-register-strip">
                  <span>Наличные в кассе</span>
                  <strong>{money(shift.balance ?? 0)}</strong>
                </div>
              )}
              {shift.cleanerVisitedAt && (
                <p>Уборщица пришла {cleanerDateTime(shift.cleanerVisitedAt)}</p>
              )}
              {Object.entries(shift.photos || {}).map(([label, src]) => (
                <figure key={label}>
                  <PrivateImage className="cp-receipt" src={src} alt={label} />
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </>
          )}
          {expense && (
            <>
              <div className="cp-form-total">
                <span>Сумма расхода</span>
                <strong>{money(expense.amount)}</strong>
              </div>
              <p>{expense.description}</p>
              <p>
                {date(expense.createdAt)} в {time(expense.createdAt)}
              </p>
              {(expense.photos || []).map((photo) => (
                <figure key={photo.url}>
                  <PrivateImage
                    className="cp-receipt"
                    src={photo.url}
                    alt={photo.label}
                  />
                  <figcaption>{photo.label}</figcaption>
                </figure>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

interface CleanerVisit {
  id: string;
  adminName: string;
  occurredAt: string;
}
export function CleanerHistory({
  initialMonth,
  onMonthChange,
  onBack,
}: {
  initialMonth?: string;
  onMonthChange: (value: string) => void;
  onBack: () => void;
}) {
  const [month, setMonth] = useState(
    initialMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth)
      ? initialMonth
      : currentMonth(),
  );
  const [year, number] = month.split("-");
  const periodLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  })
    .format(new Date(`${year}-${number}-15T12:00:00+03:00`))
    .replace(/ г\.$/, "");
  const changePeriod = (value: string) => {
    setMonth(value);
    onMonthChange(value);
  };
  const { data, error, retry } = useRecord<{ results: CleanerVisit[] }>(
    `cleaner-visits/?year=${year}&month=${number}`,
  );
  return (
    <section>
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад в «Ещё»
      </button>
      <div className="cp-page-heading">
        <h1>Уборщица</h1>
      </div>
      <label className="cp-field">
        Месяц и год
        <span className="cp-month-picker">
          <span className="cp-month-value" aria-hidden="true">
            {periodLabel}
            <IconCalendarMonth size={20} />
          </span>
          <input
            type="month"
            aria-label="Месяц и год"
            value={month}
            required
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                /* Use the native field if this WebView restricts showPicker. */
              }
            }}
            onChange={(event) => {
              if (event.target.value) changePeriod(event.target.value);
            }}
          />
        </span>
      </label>
      {!data ? (
        <FetchState error={error} retry={retry} />
      ) : data.results.length ? (
        <div className="cp-records">
          {data.results.map((visit) => (
            <div className="cp-cleaner-record" key={visit.id}>
              <strong>
                Уборщица пришла {cleanerDateTime(visit.occurredAt)}
              </strong>
              <p>Отметил(а): {visit.adminName}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="cp-empty">
          <h3>За этот месяц отметок нет</h3>
          <p>Выберите другой месяц или дождитесь отметки администратора.</p>
        </div>
      )}
    </section>
  );
}
