import { useEffect, useState, type FormEvent } from "react";
import {
  IconArrowLeft,
  IconChevronRight,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { request } from "../lib/api";
import { useDraft } from "../lib/useDraft";
import "./personnel.css";

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  role: "admin" | "manager";
  is_active: boolean;
  registered: boolean;
}
type Draft = Omit<Employee, "id" | "registered">;
const emptyDraft: Draft = {
  first_name: "",
  last_name: "",
  phone_number: "",
  role: "admin",
  is_active: true,
};
const roles = { admin: "Администратор", manager: "Управляющий" };

export function PersonnelPage({
  onBack,
  onChanged,
}: {
  onBack: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [selected, setSelected] = useState<Employee | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  useDraft(dirty, busy, "personnel");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<{ results: Employee[] }>("personnel/", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setEmployees(data.results);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [refresh]);

  function edit(employee: Employee | "new") {
    setSelected(employee);
    setDraft(
      employee === "new"
        ? { ...emptyDraft }
        : {
            first_name: employee.first_name,
            last_name: employee.last_name,
            phone_number: employee.phone_number,
            role: employee.role,
            is_active: employee.is_active,
          },
    );
    setDirty(false);
    setError("");
    setMessage("");
  }
  function change(values: Partial<Draft>) {
    setDraft((value) => ({ ...value, ...values }));
    setDirty(true);
  }
  function cancel() {
    if (
      dirty &&
      !window.confirm("Закрыть без сохранения изменений сотрудника?")
    )
      return;
    setSelected(null);
    setDirty(false);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setError("");
    if (!draft.first_name.trim() || !draft.last_name.trim()) {
      setError("Укажите имя и фамилию сотрудника.");
      return;
    }
    const digits = draft.phone_number.replace(/[+\s().-]/g, "");
    const needsPhone = selected === "new" || Boolean(selected.phone_number);
    if ((needsPhone || digits) && !/^(?:[78])?[0-9]{10}$/.test(digits)) {
      setError("Укажите 10 цифр телефона либо номер с кодом +7 или 8.");
      return;
    }
    setBusy(true);
    try {
      const body: Partial<Draft> = {
        ...draft,
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
      };
      if (!needsPhone && !digits) delete body.phone_number;
      const result = await request<Employee>(
        selected === "new"
          ? "personnel/"
          : `personnel/${encodeURIComponent(selected.id)}/`,
        {
          method: selected === "new" ? "POST" : "PATCH",
          body: JSON.stringify(body),
        },
      );
      setEmployees((list) =>
        [
          ...(list || []).filter(
            (item) => item.id !== (selected === "new" ? null : selected.id),
          ),
          result,
        ].sort((a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`,
            "ru",
          ),
        ),
      );
      setSelected(null);
      setDirty(false);
      setMessage("Сотрудник сохранён.");
      // Saving the card has already succeeded; a workspace refresh is separate.
      void Promise.resolve(onChanged?.()).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-personnel">
      <button
        className="cp-back"
        disabled={busy}
        onClick={selected ? cancel : onBack}
      >
        <IconArrowLeft size={18} />
        {selected ? "К списку сотрудников" : "Назад в «Ещё»"}
      </button>
      <div className="cp-page-heading">
        <h1>
          {selected
            ? selected === "new"
              ? "Новый сотрудник"
              : "Редактировать сотрудника"
            : "Персонал"}
        </h1>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="cp-inline-error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <form className="cp-form-panel" onSubmit={save} noValidate>
          <fieldset disabled={busy}>
            <label className="cp-field">
              Имя
              <input
                autoComplete="given-name"
                maxLength={30}
                value={draft.first_name}
                onChange={(e) => change({ first_name: e.target.value })}
                required
              />
            </label>
            <label className="cp-field">
              Фамилия
              <input
                autoComplete="family-name"
                maxLength={30}
                value={draft.last_name}
                onChange={(e) => change({ last_name: e.target.value })}
                required
              />
            </label>
            <label className="cp-field">
              Телефон
              <input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={32}
                value={draft.phone_number}
                onChange={(e) => change({ phone_number: e.target.value })}
                required={selected === "new" || Boolean(selected.phone_number)}
                placeholder="+7 999 123-45-67"
              />
            </label>
            {selected !== "new" && !selected.phone_number && (
              <p className="cp-field-hint">
                У этой учётной записи пока нет телефона. Можно добавить его для
                входа через Telegram.
              </p>
            )}
            <label className="cp-field">
              Роль
              <select
                aria-label="Роль"
                value={draft.role}
                onChange={(e) =>
                  change({ role: e.target.value as Draft["role"] })
                }
              >
                <option value="admin">Администратор</option>
                <option value="manager">Управляющий</option>
              </select>
            </label>
            <label className="cp-toggle-field">
              <span>
                <strong>Активен</strong>
                <small>
                  Отключённый сотрудник не сможет войти в приложение.
                </small>
              </span>
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => change({ is_active: e.target.checked })}
              />
              <span className="cp-toggle" aria-hidden="true" />
            </label>
            {selected === "new" && (
              <p className="cp-field-hint">
                Сотрудник откроет Mini App, поделится своим контактом и создаст
                учётную запись.
              </p>
            )}
            <div className="cp-form-actions">
              <button
                type="button"
                className="cp-button cp-button-secondary"
                onClick={cancel}
              >
                Отмена
              </button>
              <button className="cp-button cp-button-primary">
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          {employees ? (
            <>
              <button
                className="cp-button cp-button-primary"
                onClick={() => edit("new")}
              >
                <IconPlus size={18} />
                Добавить сотрудника
              </button>
              {!employees.length ? (
                <p className="cp-field-hint">
                  Сотрудников пока нет. Добавьте администратора или
                  управляющего.
                </p>
              ) : (
                <div className="cp-personnel-list">
                  {employees.map((employee) => (
                    <button
                      className="cp-personnel-row"
                      key={employee.id}
                      onClick={() => edit(employee)}
                    >
                      <span>
                        <strong>
                          {`${employee.first_name} ${employee.last_name}`.trim() ||
                            "Сотрудник без имени"}
                        </strong>
                        <small>
                          {roles[employee.role]} ·{" "}
                          {employee.is_active ? "Активен" : "Отключён"}
                          {employee.registered ? "" : " · Ожидает регистрации"}
                        </small>
                      </span>
                      <IconChevronRight size={18} />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : error ? (
            <button
              className="cp-button cp-button-secondary"
              onClick={() => setRefresh((value) => value + 1)}
            >
              <IconRefresh size={18} />
              Повторить
            </button>
          ) : (
            <p role="status">Загружаем сотрудников…</p>
          )}
        </>
      )}
    </section>
  );
}
