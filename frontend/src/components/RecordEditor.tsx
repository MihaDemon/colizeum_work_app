import { useEffect, useState } from "react";
import { IconArrowLeft, IconPlus } from "@tabler/icons-react";
import Upload from "./PhotoUpload";
import { money, parseAmount, validAmount } from "../lib/format";
import type {
  Action,
  EvidencePhoto,
  Expense,
  Shift,
  StaffMember,
} from "../lib/workspace";

export type EditableRecord =
  { kind: "expense"; record: Expense } | { kind: "shift"; record: Shift };

const moscowInput = (value?: string) =>
  value
    ? new Date(new Date(value).getTime() + 3 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 23)
    : "";

export function RecordEditor({
  target,
  user,
  people,
  balance,
  onBack,
  onDirty,
  onSave,
}: {
  target: EditableRecord;
  user: StaffMember;
  people: StaffMember[];
  balance: number;
  onBack: () => void;
  onDirty: () => void;
  onSave: (action: Action, message: string) => Promise<boolean>;
}) {
  // Keep the record being corrected stable while background refreshes continue.
  const [initial] = useState(target);
  const shift = initial.kind === "shift" ? initial.record : null;
  const expense = initial.kind === "expense" ? initial.record : null;
  const [cash, setCash] = useState(String(expense?.amount ?? shift?.cash ?? 0));
  const [cards, setCards] = useState(String(shift?.cards ?? 0));
  const [sbp, setSbp] = useState(String(shift?.sbp ?? 0));
  const [description, setDescription] = useState(
    expense?.description ?? shift?.info ?? "",
  );
  const [photo, setPhoto] = useState(expense?.photo || "");
  const [photos, setPhotos] = useState<EvidencePhoto[]>(
    shift?.reportPhotos?.map((p) => ({ ...p })) || [],
  );
  const [adminId, setAdminId] = useState(initial.record.adminId);
  const [shiftType, setShiftType] = useState(shift?.type || "day");
  const [scheduleDate, setScheduleDate] = useState(shift?.scheduleDate || "");
  const [openedAt, setOpenedAt] = useState(moscowInput(shift?.openedAt));
  const [closedAt, setClosedAt] = useState(moscowInput(shift?.closedAt));
  const [reason, setReason] = useState(shift?.forcedCloseReason || "");
  const [error, setError] = useState("");
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  const total = parseAmount(cash) + parseAmount(cards) + parseAmount(sbp);
  const submit = async () => {
    setError("");
    if (!(expense ? [cash] : [cash, cards, sbp]).every(validAmount)) {
      setError(
        "Укажите суммы с точностью до копеек, без отрицательных значений.",
      );
      return;
    }
    if (expense) {
      if (parseAmount(cash) <= 0 || !description.trim()) {
        setError("Укажите сумму больше нуля и комментарий к расходу.");
        return;
      }
      await onSave(
        {
          type: "EDIT_EXPENSE",
          actorId: user.id,
          expenseId: expense.id,
          version: expense.editingVersion!,
          amount: parseAmount(cash),
          description: description.trim(),
          photo,
          removePhoto: !photo,
        },
        "Расход обновлён. Остаток кассы пересчитан.",
      );
    } else if (shift) {
      if (
        !scheduleDate ||
        (!shift.legacy && (!openedAt || !closedAt || closedAt < openedAt))
      ) {
        setError(
          "Укажите дату по графику и время: закрытие не раньше открытия.",
        );
        return;
      }
      if (photos.some((p) => !p.url || !p.label.trim())) {
        setError(
          "Добавьте фото и название в каждое поле либо удалите пустое поле.",
        );
        return;
      }
      await onSave(
        {
          type: "EDIT_SHIFT",
          actorId: user.id,
          shiftId: shift.id,
          version: shift.editingVersion!,
          adminId: /^\d+$/.test(adminId) ? adminId : null,
          shiftType,
          scheduleDate,
          openedAt: shift.legacy
            ? undefined
            : openedAt === moscowInput(shift.openedAt)
              ? shift.openedAt
              : `${openedAt}+03:00`,
          closedAt: shift.legacy
            ? undefined
            : closedAt === moscowInput(shift.closedAt)
              ? shift.closedAt
              : `${closedAt}+03:00`,
          cash: parseAmount(cash),
          cards: parseAmount(cards),
          sbp: parseAmount(sbp),
          info: description,
          forcedCloseReason: reason,
          photos,
        },
        "Закрытая смена обновлена. Остаток кассы пересчитан.",
      );
    }
  };
  return (
    <section className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={18} /> Назад
      </button>
      <div className="cp-page-heading">
        <h1>
          {expense ? "Редактирование расхода" : "Редактирование закрытой смены"}
        </h1>
      </div>
      <form
        className="cp-form-panel"
        onChange={onDirty}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {shift && (
          <>
            <label className="cp-field">
              Администратор
              <select
                aria-label="Администратор смены"
                value={adminId}
                disabled={user.role === "admin"}
                onChange={(e) => setAdminId(e.target.value)}
              >
                {!people.some(
                  (p) =>
                    p.id === adminId &&
                    !p.deleted &&
                    p.isActive !== false &&
                    p.role === "admin",
                ) && (
                  <option value={adminId}>
                    {shift.adminName ||
                      people.find((p) => p.id === adminId)?.name ||
                      "Удалённый сотрудник"}
                  </option>
                )}
                {people
                  .filter(
                    (p) =>
                      p.role === "admin" && !p.deleted && p.isActive !== false,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="cp-field">
              Тип смены
              <select
                aria-label="Тип смены"
                value={shiftType}
                onChange={(e) =>
                  setShiftType(e.target.value as "day" | "night")
                }
              >
                <option value="day">Дневная</option>
                <option value="night">Ночная</option>
              </select>
            </label>
            <label className="cp-field">
              Дата по графику
              <input
                aria-label="Дата по графику"
                type="date"
                required
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </label>
            {!shift.legacy && (
              <>
                <p className="cp-field-hint">Время указано по Москве.</p>
                <label className="cp-field">
                  Открыта
                  <input
                    aria-label="Время открытия"
                    type="datetime-local"
                    step="0.001"
                    required
                    value={openedAt}
                    onChange={(e) => setOpenedAt(e.target.value)}
                  />
                </label>
                <label className="cp-field">
                  Закрыта
                  <input
                    aria-label="Время закрытия"
                    type="datetime-local"
                    step="0.001"
                    required
                    value={closedAt}
                    onChange={(e) => setClosedAt(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        <div className={shift ? "cp-money-grid" : undefined}>
          {(expense
            ? [["Сумма расхода", cash, setCash] as const]
            : ([
                ["Наличные", cash, setCash],
                ["Карта", cards, setCards],
                ["СБП", sbp, setSbp],
              ] as const)
          ).map(([label, value, setter]) => (
            <label className="cp-field" key={label}>
              {label}
              <span className="cp-input-money">
                <input
                  aria-label={label}
                  inputMode="decimal"
                  required
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                />
                <span>₽</span>
              </span>
            </label>
          ))}
        </div>
        {shift && (
          <div className="cp-form-total">
            <span>Общая выручка</span>
            <strong>{money(total || 0)}</strong>
          </div>
        )}
        <label className="cp-field">
          Комментарий
          <textarea
            aria-label="Комментарий"
            rows={4}
            maxLength={expense ? 5000 : 10000}
            required={Boolean(expense)}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {shift?.forcedCloseReason && (
          <label className="cp-field">
            Причина принудительного закрытия
            <textarea
              aria-label="Причина принудительного закрытия"
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        {expense ? (
          <>
            <Upload
              label="Фотография чека"
              value={photo}
              onError={setError}
              onChange={(url) => {
                setPhoto(url);
                onDirty();
              }}
            />
            {photo && (
              <button
                type="button"
                className="cp-text-button"
                onClick={() => {
                  setPhoto("");
                  onDirty();
                }}
              >
                Удалить фото чека
              </button>
            )}
          </>
        ) : (
          <>
            <h2 className="cp-form-section-title">Фотографии отчёта</h2>
            {photos.map((item, index) => (
              <div key={index}>
                <label className="cp-field">
                  Название фото {index + 1}
                  <input
                    aria-label={`Название фото ${index + 1}`}
                    maxLength={100}
                    required
                    value={item.label}
                    onChange={(e) =>
                      setPhotos((prev) =>
                        prev.map((p, i) =>
                          i === index ? { ...p, label: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
                <Upload
                  label={`Фото отчёта ${index + 1}`}
                  value={item.url}
                  onError={setError}
                  onChange={(url) => {
                    setPhotos((prev) =>
                      prev.map((p, i) =>
                        i === index ? { ...p, id: undefined, url } : p,
                      ),
                    );
                    onDirty();
                  }}
                />
                <button
                  type="button"
                  className="cp-text-button"
                  onClick={() => {
                    setPhotos((prev) => prev.filter((_, i) => i !== index));
                    onDirty();
                  }}
                >
                  Удалить фото {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cp-button cp-button-secondary"
              disabled={photos.length >= 10}
              onClick={() => {
                setPhotos((prev) => [
                  ...prev,
                  { slot: "", label: `Фото ${prev.length + 1}`, url: "" },
                ]);
                onDirty();
              }}
            >
              <IconPlus size={18} />
              Добавить фото
            </button>
            <p className="cp-field-hint">
              До 10 фотографий, до 5 МБ каждая и до 15 МБ новых файлов за одно
              сохранение.
            </p>
          </>
        )}
        <p className="cp-field-hint">
          Изменение {expense ? "суммы расхода" : "наличной выручки"}{" "}
          скорректирует текущий остаток кассы. Сейчас в кассе {money(balance)}.
        </p>
        {error && (
          <p className="cp-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="cp-form-actions">
          <button className="cp-button cp-button-primary" type="submit">
            Сохранить изменения
          </button>
          <button
            className="cp-button cp-button-secondary"
            type="button"
            onClick={onBack}
          >
            Отмена
          </button>
        </div>
      </form>
    </section>
  );
}
