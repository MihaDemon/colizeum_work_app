import { useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconHistory,
  IconWand,
} from "@tabler/icons-react";
import { request } from "../lib/api";
import { cleanerDateTime } from "../lib/format";
import type { StaffMember } from "../lib/workspace";
import { useDraft } from "../lib/useDraft";
import { PrivateImage } from "./PrivateImage";
import "./schedule.css";

type Plan = Record<string, StaffMember | null>;
interface Period {
  id: string;
  start: string;
  end: string;
  version: number;
  editable: boolean;
  sendAt: string;
  image: string | null;
}
interface Overview {
  current: Period;
  future: Period;
  archive: Period[];
  admins: StaffMember[];
  settings: { defaultAdminId: string | null; version: number };
}
interface Actual {
  id: string;
  adminId: string;
  adminName: string;
  openedAt: string;
  closedAt: string | null;
  proposed: StaffMember | null;
  revision: number | null;
}
interface Detail extends Period {
  viewVersion: number;
  canEdit: boolean;
  plan: Plan;
  actual: Record<string, Actual[]>;
  unavailable: string[];
  revisions: {
    number: number;
    source: string;
    createdAt: string;
    author: string;
    restoredFrom: number | null;
  }[];
}
const displayDate = (day: string) => day.split("-").reverse().join(".");
const sourceNames: Record<string, string> = {
  initial: "Создание",
  manual: "Вручную",
  automatic: "Автозаполнение",
  restore: "Восстановление",
};

export function SchedulePage({
  user,
  initialId,
  onBack,
  onDirty,
  onOpenShift,
}: {
  user: StaffMember;
  initialId?: string;
  onBack: () => void;
  onDirty: (value: boolean) => void;
  onOpenShift: (id: string, periodId: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [period, setPeriod] = useState<Detail | null>(null);
  const [mode, setMode] = useState<"current" | "future" | "archive">(
    initialId ? "archive" : "current",
  );
  const [archiveId, setArchiveId] = useState(initialId || "");
  const [viewVersion, setViewVersion] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Plan>({});
  const [selectedAdmin, setSelectedAdmin] = useState("");
  const [autoIds, setAutoIds] = useState<string[]>([]);
  const [source, setSource] = useState<"manual" | "automatic">("manual");
  const [cell, setCell] = useState<string | null>(null);
  const [defaultId, setDefaultId] = useState("");
  const [showImage, setShowImage] = useState(false);
  const retryKey = useRef<{ signature: string; key: string } | null>(null);
  const periodId =
    mode === "current"
      ? overview?.current.id
      : mode === "future"
        ? overview?.future.id
        : archiveId;
  const markDirty = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  useDraft(dirty, busy, "schedule");
  useEffect(() => {
    const controller = new AbortController();
    void request<Overview>("schedules/", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setOverview(data);
        setDefaultId(data.settings.defaultAdminId || "");
        if (initialId === data.current.id) setMode("current");
        else if (initialId === data.future.id) setMode("future");
        setAutoIds(data.admins.slice(0, 4).map((p) => p.id));
        setSelectedAdmin(data.admins[0]?.id || "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!periodId) {
      setPeriod(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void request<Detail>(
      `schedules/${periodId}/${viewVersion ? `?revision=${viewVersion}` : ""}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setPeriod(data);
        setDraft(data.plan);
        setCell(null);
        setShowImage(false);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [periodId, viewVersion, refresh]);
  useEffect(() => {
    const update = () => {
      if (!dirty && !busy && !editing) setRefresh((value) => value + 1);
    };
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [dirty, busy, editing]);
  const discard = () =>
    !dirty || window.confirm("Отменить несохранённые изменения графика?");
  const switchMode = (next: typeof mode) => {
    if (busy || !discard()) return;
    markDirty(false);
    setEditing(false);
    setViewVersion("");
    setMode(next);
    setMessage("");
    if (next === "archive" && !archiveId)
      setArchiveId(overview?.archive[0]?.id || "");
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    const signature = path + JSON.stringify(body);
    if (retryKey.current?.signature !== signature)
      retryKey.current = { signature, key: crypto.randomUUID() };
    const result = await request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": retryKey.current.key },
    });
    retryKey.current = null;
    return result;
  }
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    perform(async () => {
      if (!period) return;
      const result = await post<Detail>(`schedules/${period.id}/`, {
        version: period.version,
        source,
        admins: autoIds.map(Number),
        slots: Object.entries(draft).map(([key, person]) => {
          const [date, type] = key.split("/");
          return { date, type, admin_id: person ? Number(person.id) : null };
        }),
      });
      setPeriod(result);
      setDraft(result.plan);
      setEditing(false);
      markDirty(false);
      setMessage("График сохранён. Создана новая версия.");
    });
  const generate = () =>
    perform(async () => {
      if (!period) return;
      const result = await post<{
        plan: Plan;
        warning: string;
        admins: string[];
      }>(`schedules/${period.id}/generate/`, {
        version: period.version,
        admins: autoIds.map(Number),
      });
      setDraft(result.plan);
      setAutoIds(result.admins);
      setSource("automatic");
      markDirty(true);
      setMessage(
        result.warning ||
          "Черновик 2/2 готов. Проверьте назначения и нажмите «Сохранить».",
      );
    });
  const restore = () =>
    perform(async () => {
      if (
        !period ||
        !viewVersion ||
        !window.confirm(
          `Восстановить версию ${viewVersion}? Она станет новой текущей версией графика.`,
        )
      )
        return;
      const result = await post<Detail>(`schedules/${period.id}/restore/`, {
        version: period.version,
        revision: Number(viewVersion),
      });
      setPeriod(result);
      setDraft(result.plan);
      setViewVersion("");
      markDirty(false);
      setMessage("Версия восстановлена. Фактические смены сохранены.");
    });
  const startEdit = () => {
    if (!period) return;
    setDraft(period.plan);
    setEditing(true);
    setSource("manual");
    setCell(null);
  };
  const selectCell = (key: string) => {
    if (editing) {
      const person =
        overview?.admins.find((p) => p.id === selectedAdmin) || null;
      setDraft((value) => ({ ...value, [key]: person }));
      markDirty(true);
    } else setCell(key);
  };
  const plan = editing ? draft : period?.plan || {};
  const days = Array.from(
    new Set(Object.keys(plan).map((key) => key.split("/")[0])),
  ).sort();
  const selectedActual = cell ? period?.actual[cell] || [] : [];
  return (
    <section className="schedule-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад в «Ещё»
      </button>
      <div className="cp-page-heading">
        <h1>График смен</h1>
      </div>
      {error && (
        <div role="alert" className="cp-inline-error">
          <p>{error}</p>
          <button
            className="cp-button cp-button-secondary"
            disabled={busy}
            onClick={() => {
              if (discard()) {
                markDirty(false);
                setEditing(false);
                setViewVersion("");
                setRefresh((v) => v + 1);
              }
            }}
          >
            Обновить график
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {!overview ? (
        <p role="status">Загружаем графики…</p>
      ) : (
        <fieldset disabled={busy} className="cp-workspace-controls">
          <div className="cp-tabs" aria-label="Период графика">
            <button
              className={mode === "current" ? "cp-tab-active" : ""}
              onClick={() => switchMode("current")}
            >
              <IconChevronLeft size={16} />
              Текущий
            </button>
            <button
              className={mode === "future" ? "cp-tab-active" : ""}
              onClick={() => switchMode("future")}
            >
              Следующий
              <IconChevronRight size={16} />
            </button>
            <button
              className={mode === "archive" ? "cp-tab-active" : ""}
              onClick={() => switchMode("archive")}
            >
              <IconHistory size={16} />
              Архив
            </button>
          </div>
          {mode === "archive" && (
            <label className="cp-field">
              Период
              <select
                aria-label="Архивный период"
                value={archiveId}
                onChange={(e) => {
                  if (discard()) {
                    markDirty(false);
                    setEditing(false);
                    setViewVersion("");
                    setArchiveId(e.target.value);
                  }
                }}
              >
                <option value="">Выберите период</option>
                {overview.archive.map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayDate(p.start)} — {displayDate(p.end)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loading ? (
            <p role="status">Загружаем период…</p>
          ) : period && period.id === periodId ? (
            <>
              <h2 className="schedule-period-title">
                {displayDate(period.start)} — {displayDate(period.end)}
              </h2>
              <p className="cp-list-hint">
                Версия {period.viewVersion}. Итог отправляется{" "}
                {cleanerDateTime(period.sendAt)} по Москве. До этого времени
                завершённый период можно исправлять.
              </p>
              {period.unavailable.length > 0 && (
                <p className="cp-inline-error">
                  В графике есть недоступные сотрудники. Проверьте назначения.
                </p>
              )}
              {!editing && (
                <label className="cp-field">
                  Версии графика
                  <select
                    aria-label="Версия графика"
                    value={viewVersion}
                    onChange={(e) => setViewVersion(e.target.value)}
                  >
                    <option value="">Текущая версия · {period.version}</option>
                    {period.revisions.map((r) => (
                      <option value={r.number} key={r.number}>
                        №{r.number} · {sourceNames[r.source]} · {r.author} ·{" "}
                        {cleanerDateTime(r.createdAt)}
                        {r.restoredFrom ? ` · из №${r.restoredFrom}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {period.canEdit && !editing && (
                <div className="schedule-actions">
                  {!viewVersion && (
                    <button
                      className="cp-button cp-button-primary"
                      onClick={startEdit}
                    >
                      Редактировать график
                    </button>
                  )}
                  {viewVersion && (
                    <button
                      className="cp-button cp-button-primary"
                      onClick={restore}
                    >
                      Восстановить эту версию
                    </button>
                  )}
                </div>
              )}
              {editing && (
                <div className="schedule-editor">
                  <label className="cp-field">
                    Назначаемый администратор
                    <select
                      aria-label="Назначаемый администратор"
                      value={selectedAdmin}
                      onChange={(e) => setSelectedAdmin(e.target.value)}
                    >
                      <option value="">Очистить ячейку</option>
                      {overview.admins.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Нажимайте на дневные и ночные ячейки, затем сохраните
                    изменения.
                  </p>
                  {mode === "future" && (
                    <details>
                      <summary>Автозаполнение 2/2</summary>
                      <p>
                        Четыре позиции: два администратора работают два дня,
                        затем их сменяет вторая пара. Цикл продолжается между
                        периодами. Выберите до четырёх сотрудников.
                      </p>
                      {overview.admins.map((p) => (
                        <label className="schedule-choice" key={p.id}>
                          <input
                            type="checkbox"
                            checked={autoIds.includes(p.id)}
                            disabled={
                              !autoIds.includes(p.id) && autoIds.length >= 4
                            }
                            onChange={(e) =>
                              setAutoIds((value) =>
                                e.target.checked
                                  ? [...value, p.id]
                                  : value.filter((id) => id !== p.id),
                              )
                            }
                          />
                          {p.name}
                        </label>
                      ))}
                      <p>
                        Для недостающих позиций:{" "}
                        {overview.admins.find(
                          (p) => p.id === overview.settings.defaultAdminId,
                        )?.name || "сотрудник по умолчанию не выбран"}
                        .
                      </p>
                      <button
                        className="cp-button cp-button-secondary"
                        onClick={generate}
                      >
                        <IconWand size={18} />
                        Заполнить 2/2
                      </button>
                    </details>
                  )}
                  <div className="schedule-actions">
                    <button
                      className="cp-button cp-button-primary"
                      disabled={!dirty}
                      onClick={save}
                    >
                      Сохранить график
                    </button>
                    <button
                      className="cp-button cp-button-secondary"
                      onClick={() => {
                        if (discard()) {
                          setEditing(false);
                          setDraft(period.plan);
                          markDirty(false);
                        }
                      }}
                    >
                      Отменить изменения
                    </button>
                  </div>
                </div>
              )}
              <table className="schedule-grid">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>День</th>
                    <th>Ночь</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day}>
                      <th scope="row">{displayDate(day).slice(0, 5)}</th>
                      {["day", "night"].map((kind) => {
                        const key = `${day}/${kind}`;
                        const planned = plan[key];
                        const actual = period.actual[key] || [];
                        const closed = actual.filter((s) => s.closedAt);
                        const shown = closed.length ? closed : actual;
                        return (
                          <td key={kind}>
                            <button
                              type="button"
                              aria-label={`${displayDate(day)} ${kind === "day" ? "День" : "Ночь"}`}
                              aria-pressed={cell === key}
                              className={shown.length ? "schedule-actual" : ""}
                              onClick={() => selectCell(key)}
                            >
                              <span>
                                {!editing && shown.length
                                  ? Array.from(
                                      new Set(shown.map((s) => s.adminName)),
                                    ).join(", ")
                                  : planned?.name || "Не назначен"}
                              </span>
                              {!editing && shown.length > 0 && (
                                <small>
                                  {closed.length ? "Факт" : "На смене"}
                                </small>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {cell && !editing && (
                <section
                  className="schedule-cell-detail"
                  aria-label="Детали ячейки графика"
                >
                  <h3>
                    {displayDate(cell.split("/")[0])} ·{" "}
                    {cell.endsWith("/day") ? "Дневная смена" : "Ночная смена"}
                  </h3>
                  <p>
                    Назначен в выбранной версии:{" "}
                    <strong>{period.plan[cell]?.name || "Не назначен"}</strong>
                  </p>
                  {selectedActual.length ? (
                    selectedActual.map((shift) => (
                      <div className="cp-cleaner-record" key={shift.id}>
                        <p>
                          Фактически: <strong>{shift.adminName}</strong>
                        </p>
                        <p>
                          План при открытии:{" "}
                          {shift.proposed?.name || "Не назначен"}
                          {shift.revision ? ` · версия ${shift.revision}` : ""}
                        </p>
                        <p>
                          Открыта: {cleanerDateTime(shift.openedAt)}
                          {shift.closedAt
                            ? ` · закрыта: ${cleanerDateTime(shift.closedAt)}`
                            : " · ещё открыта"}
                        </p>
                        {(user.role !== "admin" ||
                          shift.adminId === user.id) && (
                          <button
                            className="cp-button cp-button-secondary"
                            onClick={() => onOpenShift(shift.id, period.id)}
                          >
                            Открыть отчёт смены
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>Фактическая смена ещё не зарегистрирована.</p>
                  )}
                </section>
              )}
              {period.image && (
                <>
                  <button
                    className="cp-button cp-button-secondary"
                    onClick={() => setShowImage((v) => !v)}
                  >
                    Итоговое изображение
                  </button>
                  {showImage && (
                    <PrivateImage
                      className="schedule-summary"
                      src={period.image}
                      alt="Итоговый график смен"
                    />
                  )}
                </>
              )}
            </>
          ) : mode === "archive" && !archiveId ? (
            <p>Завершённых графиков пока нет.</p>
          ) : null}
          {user.role === "superuser" && (
            <details className="schedule-default">
              <summary>Администратор по умолчанию</summary>
              <p>
                Назначается на свободные позиции автозаполнения, если выбрано
                меньше четырёх сотрудников.
              </p>
              <label className="cp-field">
                Сотрудник
                <select
                  aria-label="Администратор по умолчанию"
                  value={defaultId}
                  onChange={(e) => setDefaultId(e.target.value)}
                >
                  <option value="">Не выбран</option>
                  {overview.admins.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="cp-button cp-button-secondary"
                onClick={() =>
                  perform(async () => {
                    const config = await post<Overview["settings"]>(
                      "schedules/settings/",
                      {
                        version: overview.settings.version,
                        default_admin: defaultId ? Number(defaultId) : null,
                      },
                    );
                    setOverview({ ...overview, settings: config });
                    setMessage("Администратор по умолчанию сохранён.");
                  })
                }
              >
                Сохранить сотрудника по умолчанию
              </button>
            </details>
          )}
        </fieldset>
      )}
    </section>
  );
}
