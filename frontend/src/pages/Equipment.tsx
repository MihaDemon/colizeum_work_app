import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  IconQrcode,
  IconPlus,
  IconArrowUpRight,
  IconDownload,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { DeviceIcon } from "../components/DeviceIcon";
import { downloadDeviceQr } from "../lib/download";
import { list, request } from "../lib/api";
import { telegram, inTelegram, haptic } from "../lib/telegram";
import { useList } from "../lib/useList";
import { useDraft } from "../lib/useDraft";
import { availableDevices, deviceLabel } from "../lib/devices";
import type { Device, Resource, User } from "../lib/types";
import {
  Back,
  Confirm,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
} from "../components/UI";

export const resources: { key: Resource; title: string; singular: string }[] = [
  { key: "stations", title: "Места", singular: "Место" },
  { key: "pcs", title: "ПК", singular: "ПК" },
  { key: "mice", title: "Мыши", singular: "Мышь" },
  { key: "keyboards", title: "Клавиатуры", singular: "Клавиатура" },
  { key: "headsets", title: "Наушники", singular: "Наушники" },
  { key: "monitors", title: "Мониторы", singular: "Монитор" },
  { key: "playstations", title: "PlayStation", singular: "PlayStation" },
];
const links = [
  ["mouse", "mice", "Мышь"],
  ["keyboard", "keyboards", "Клавиатура"],
  ["headset", "headsets", "Наушники"],
  ["monitor", "monitors", "Монитор"],
  ["pc", "pcs", "ПК"],
] as const;
const labels: Record<string, string> = {
  model: "Модель",
  serial_number: "Серийный номер",
  club_number: "Номер места",
  cpu: "Процессор",
  gpu: "Видеокарта",
  ram: "Оперативная память",
  storage: "Хранилище",
  warranty_until: "Гарантия до",
  info: "Комментарий",
};
export function lookupFromQr(text: string): {
  resource: Resource;
  path: string;
} {
  const url = new URL(text);
  const match = url.pathname.match(
    /\/api\/(stations|pcs|mice|keyboards|headsets|monitors|playstations)\/lookup\/$/,
  );
  if (!match || !["https:", "http:"].includes(url.protocol))
    throw new Error(
      "Это не QR-код оборудования COLIZEUM. Отсканируйте QR-код на устройстве.",
    );
  const resource = match[1] as Resource;
  const field = resource === "stations" ? "club_number" : "serial_number";
  const identifier = url.searchParams.get(field);
  if (!identifier) throw new Error("В QR-коде отсутствует номер устройства.");
  return {
    resource,
    path: `${resource}/lookup/?${new URLSearchParams({ [field]: identifier })}`,
  };
}

export function Equipment({
  user,
  notify,
}: {
  user: User;
  notify: (message: string) => void;
}) {
  const [resource, setResource] = useState<Resource>("stations");
  const { items, loading, error, reload } = useList<Device>(`${resource}/`);
  const [selected, setSelected] = useState<Device | null>(null);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const close = useCallback(() => {
    setSelected(null);
    setEditing(false);
    setActionError("");
  }, []);
  const selectedTitle = resources.find(
    (entry) => entry.key === resource,
  )!.singular;
  const find = async (path: string, category: Resource) => {
    setBusy(true);
    setActionError("");
    try {
      const device = await request<Device>(path);
      setResource(category);
      setSelected(device);
    } catch (err) {
      setActionError((err as Error).message);
      haptic("error");
    } finally {
      setBusy(false);
    }
  };
  const scan = () => {
    setActionError("");
    const app = telegram();
    if (
      !inTelegram() ||
      !app?.isVersionAtLeast("6.4") ||
      typeof app.showScanQrPopup !== "function"
    ) {
      setActionError(
        "Откройте приложение в Telegram, чтобы найти устройство по QR-коду через камеру.",
      );
      return;
    }
    try {
      app.showScanQrPopup(
        { text: "Наведите камеру на QR-код оборудования" },
        (text) => {
          try {
            const lookup = lookupFromQr(text);
            app.closeScanQrPopup();
            void find(lookup.path, lookup.resource);
          } catch (err) {
            setActionError((err as Error).message);
            app.closeScanQrPopup();
          }
          return true;
        },
      );
    } catch {
      setActionError(
        "Не удалось открыть камеру. Проверьте доступ к камере в Telegram и повторите сканирование.",
      );
    }
  };
  if (editing)
    return (
      <DeviceEditor
        key={`${resource}-${selected?.id || "new"}`}
        resource={resource}
        device={selected}
        onClose={close}
        onSaved={() => {
          close();
          reload();
          notify("Оборудование сохранено");
        }}
      />
    );
  if (selected)
    return (
      <DeviceDetails
        resource={resource}
        device={selected}
        user={user}
        error={actionError}
        busy={busy}
        onClose={close}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleteOpen(true)}
        setError={setActionError}
        deleteDialog={
          deleteOpen ? (
            <Confirm
              title={`Удалить ${selectedTitle.toLowerCase()}?`}
              busy={busy}
              onCancel={() => setDeleteOpen(false)}
              onConfirm={() => {
                setBusy(true);
                setActionError("");
                void request(`${resource}/${selected.id}/`, {
                  method: "DELETE",
                })
                  .then(() => {
                    close();
                    reload();
                    notify("Оборудование удалено");
                  })
                  .catch((err: Error) => setActionError(err.message))
                  .finally(() => {
                    setBusy(false);
                    setDeleteOpen(false);
                  });
              }}
            >
              Устройство будет удалено из базы. Связи с компьютерными местами
              будут очищены.
            </Confirm>
          ) : null
        }
      />
    );
  return (
    <>
      <PageHeading
        title="Оборудование клуба"
        subtitle="Учёт устройств и комплектация компьютерных мест"
        action={
          <div className="button-row">
            <button className="secondary-button" disabled={busy} onClick={scan}>
              <IconQrcode size={20} />
              Сканировать QR
            </button>
            {user.is_staff && (
              <button
                className="primary-button"
                onClick={() => setEditing(true)}
              >
                <IconPlus size={20} />
                Добавить
              </button>
            )}
          </div>
        }
      />
      <div className="resource-tabs" aria-label="Тип оборудования">
        {resources.map((entry) => (
          <button
            key={entry.key}
            className={resource === entry.key ? "active" : ""}
            onClick={() => {
              setResource(entry.key);
              setActionError("");
            }}
          >
            <DeviceIcon resource={entry.key} size={18} />
            {entry.title}
          </button>
        ))}
      </div>
      <ErrorNotice
        message={actionError || error}
        retry={error ? reload : undefined}
      />
      {loading ? (
        <Loading />
      ) : items.length ? (
        <>
          <div className="list-summary">
            {resources.find((entry) => entry.key === resource)!.title} ·{" "}
            {items.length}
          </div>
          <div
            className={
              resource === "stations" ? "station-grid" : "equipment-list"
            }
          >
            {items.map((item) => (
              <button
                className={
                  resource === "stations" ? "station-tile" : "equipment-row"
                }
                key={item.id}
                onClick={() => {
                  setSelected(item);
                  setActionError("");
                }}
              >
                <DeviceIcon
                  resource={resource}
                  size={resource === "stations" ? 30 : 24}
                />
                <div>
                  <strong>
                    {resource === "stations"
                      ? `Место ${item.club_number}`
                      : item.model ||
                        (resource === "playstations"
                          ? `PlayStation ${item.club_number}`
                          : item.cpu || "ПК")}
                  </strong>
                  <small>
                    {resource === "stations"
                      ? [
                          item.pc && "ПК",
                          item.monitor && "Монитор",
                          item.mouse && "Мышь",
                          item.keyboard && "Клавиатура",
                          item.headset && "Наушники",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Комплектация не задана"
                      : item.serial_number}
                  </small>
                </div>
                <IconArrowUpRight size={19} />
              </button>
            ))}
          </div>
        </>
      ) : (
        !error && (
          <Empty title="Оборудование пока не добавлено">
            {user.is_staff
              ? "Добавьте первое устройство с помощью кнопки выше."
              : "Управляющий клуба может добавить оборудование в базу."}
          </Empty>
        )
      )}
    </>
  );
}

function DeviceDetails({
  resource,
  device,
  user,
  error,
  busy,
  onClose,
  onEdit,
  onDelete,
  setError,
  deleteDialog,
}: {
  resource: Resource;
  device: Device;
  user: User;
  error: string;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  setError: (message: string) => void;
  deleteDialog: React.ReactNode;
}) {
  const [qr, setQr] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrDownloading, setQrDownloading] = useState(false);
  const [related, setRelated] = useState<Record<string, Device>>({});
  const [relatedError, setRelatedError] = useState("");
  useEffect(() => {
    if (resource !== "stations") return;
    const controller = new AbortController();
    void Promise.all(
      links.map(async ([field, collection]) =>
        device[field]
          ? [
              field,
              await request<Device>(`${collection}/${device[field]}/`, {
                signal: controller.signal,
              }),
            ]
          : null,
      ),
    )
      .then((results) => {
        if (!controller.signal.aborted)
          setRelated(
            Object.fromEntries(
              results.filter((result) => result !== null) as [string, Device][],
            ),
          );
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setRelatedError(err.message);
      });
    return () => controller.abort();
  }, [device, resource]);
  useEffect(
    () => () => {
      if (qr) URL.revokeObjectURL(qr);
    },
    [qr],
  );
  const loadQr = async () => {
    setQrLoading(true);
    setError("");
    try {
      const blob = await request<Blob>(`${resource}/${device.id}/qr-code/`);
      setQr(URL.createObjectURL(blob));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQrLoading(false);
    }
  };
  const downloadQr = async () => {
    if (qrDownloading) return;
    setQrDownloading(true);
    setError("");
    try {
      await downloadDeviceQr(resource, device.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQrDownloading(false);
    }
  };
  const title =
    resource === "stations"
      ? `Место ${device.club_number}`
      : device.model ||
        (resource === "playstations"
          ? `PlayStation ${device.club_number}`
          : "Компьютер");
  return (
    <>
      <Back onClick={onClose} />
      <PageHeading
        title={
          <span className="device-title">
            <DeviceIcon resource={resource} size={28} />
            {title}
          </span>
        }
        subtitle={device.serial_number || "Комплектация рабочего места"}
        action={
          user.is_staff && (
            <button className="secondary-button" onClick={onEdit}>
              <IconPencil size={18} />
              Изменить
            </button>
          )
        }
      />
      <ErrorNotice message={error || relatedError} />
      <div className="device-detail">
        <dl className="detail-list">
          {Object.entries(labels)
            .filter(
              ([key]) =>
                key !== "info" && device[key as keyof Device] !== undefined,
            )
            .map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {key === "warranty_until" && device.warranty_until
                    ? new Date(device.warranty_until).toLocaleDateString(
                        "ru-RU",
                      )
                    : String(device[key as keyof Device] ?? "Не указано")}
                </dd>
              </div>
            ))}
          {resource === "stations" &&
            links.map(([field, collection, label]) => (
              <div key={field}>
                <dt className="device-title">
                  <DeviceIcon resource={collection} size={18} />
                  {label}
                </dt>
                <dd>
                  {device[field]
                    ? related[field]
                      ? deviceLabel(related[field])
                      : `#${device[field]}`
                    : "Не назначено"}
                </dd>
              </div>
            ))}
        </dl>
        {device.info && (
          <div className="record-comment">
            <h3>Комментарий</h3>
            <p>{device.info}</p>
          </div>
        )}
        <div className="qr-section">
          <div>
            <h3>QR-код устройства</h3>
            <p>
              Распечатайте код и закрепите его на оборудовании для быстрого
              поиска.
            </p>
            {!qr && (
              <button
                className="secondary-button"
                disabled={qrLoading}
                onClick={() => void loadQr()}
              >
                <IconQrcode size={20} />
                {qrLoading ? "Загружаем…" : "Показать QR-код"}
              </button>
            )}
            {qr && (
              <button
                className="secondary-button"
                disabled={qrDownloading}
                onClick={() => void downloadQr()}
              >
                <IconDownload size={20} />
                {qrDownloading ? "Подготавливаем…" : "Скачать PNG"}
              </button>
            )}
          </div>
          {qr && <img className="qr-image" src={qr} alt={`QR-код: ${title}`} />}
        </div>
      </div>
      {user.is_staff && (
        <button
          className="text-button danger-text"
          disabled={busy}
          onClick={onDelete}
        >
          <IconTrash size={18} />
          Удалить из базы
        </button>
      )}
      {deleteDialog}
    </>
  );
}

function DeviceEditor({
  resource,
  device,
  onClose,
  onSaved,
}: {
  resource: Resource;
  device: Device | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields =
    resource === "stations"
      ? ["club_number"]
      : resource === "pcs"
        ? ["serial_number", "cpu", "gpu", "ram", "storage", "warranty_until"]
        : resource === "playstations"
          ? ["club_number", "serial_number", "warranty_until"]
          : ["model", "serial_number", "warranty_until"];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...fields, "info", ...links.map(([key]) => key)].map((field) => {
        const value = device?.[field as keyof Device];
        return [
          field,
          field === "warranty_until" && value
            ? new Date(String(value)).toLocaleDateString("en-CA")
            : String(value ?? ""),
        ];
      }),
    ),
  );
  const [choices, setChoices] = useState<Record<string, Device[]>>({});
  const [choiceLoading, setChoiceLoading] = useState(resource === "stations");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  useDraft(dirty, busy, "equipment");
  const leave = useCallback(() => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }, [busy, dirty, onClose]);
  useEffect(() => {
    if (resource !== "stations") return;
    const controller = new AbortController();
    setChoiceLoading(true);
    void Promise.all([
      list<Device>("stations/", controller.signal),
      Promise.all(
        links.map(
          async ([field, collection]) =>
            [
              field,
              await list<Device>(`${collection}/`, controller.signal),
            ] as const,
        ),
      ),
    ])
      .then(([stations, entries]) => {
        if (!controller.signal.aborted)
          setChoices(
            Object.fromEntries(
              entries.map(([field, devices]) => [
                field,
                availableDevices(devices, stations, field, device?.id),
              ]),
            ),
          );
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChoiceLoading(false);
      });
    return () => controller.abort();
  }, [resource, device?.id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const payload: Record<string, string | number | null> = {};
    for (const field of [...fields, "info"]) {
      payload[field] =
        field === "club_number"
          ? Number(values[field])
          : field === "warranty_until"
            ? values[field]
              ? new Date(`${values[field]}T23:59:59+03:00`).toISOString()
              : null
            : values[field];
    }
    if (resource === "stations")
      links.forEach(([field]) => {
        payload[field] = values[field] ? Number(values[field]) : null;
      });
    try {
      await request(`${resource}/${device ? `${device.id}/` : ""}`, {
        method: device ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      haptic("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Back onClick={leave} />
      <PageHeading
        title={`${device ? "Изменить" : "Добавить"}: ${resources.find((entry) => entry.key === resource)!.singular}`}
        subtitle={
          fields.includes("model")
            ? "Модель может повторяться; серийный номер должен быть уникальным."
            : "Данные устройства в базе клуба"
        }
      />
      <form
        className="editor-form"
        onSubmit={(e) => void submit(e)}
        onChange={() => setDirty(true)}
      >
        <fieldset disabled={busy}>
          <ErrorNotice message={error} />
          <div className="form-section form-grid">
            {fields.map((field) => (
              <label key={field}>
                {labels[field]}
                <input
                  name={field}
                  type={
                    field === "club_number"
                      ? "number"
                      : field === "warranty_until"
                        ? "date"
                        : "text"
                  }
                  required={field !== "warranty_until"}
                  min={field === "club_number" ? 0 : undefined}
                  max={field === "club_number" ? 32767 : undefined}
                  maxLength={field === "model" ? 100 : 255}
                  value={values[field]}
                  onChange={(e) =>
                    setValues({ ...values, [field]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          {resource === "stations" && (
            <div className="form-section">
              <h2>Комплектация</h2>
              <p className="field-hint">
                Выбирайте устройство по серийному номеру. Устройства, занятые на
                других местах, недоступны.
              </p>
              {choiceLoading ? (
                <Loading />
              ) : (
                <div className="form-grid station-assignments">
                  {links.map(([field, , label]) => {
                    const selected = choices[field]?.find(
                      (entry) => String(entry.id) === values[field],
                    );
                    return (
                      <label key={field}>
                        {label}
                        <select
                          name={field}
                          aria-label={label}
                          aria-describedby={
                            selected ? `selected-${field}` : undefined
                          }
                          value={values[field]}
                          onChange={(e) =>
                            setValues({ ...values, [field]: e.target.value })
                          }
                        >
                          <option value="">Не назначено</option>
                          {choices[field]?.map((entry) => (
                            <option value={entry.id} key={entry.id}>
                              {deviceLabel(entry)}
                            </option>
                          ))}
                        </select>
                        {selected && (
                          <span
                            className="field-hint selected-device"
                            id={`selected-${field}`}
                          >
                            {deviceLabel(selected)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="form-section">
            <label>
              Комментарий
              <textarea
                rows={4}
                value={values.info}
                onChange={(e) => setValues({ ...values, info: e.target.value })}
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={leave}>
              Отмена
            </button>
            <button
              className="primary-button"
              disabled={
                busy ||
                choiceLoading ||
                (resource === "stations" &&
                  Object.keys(choices).length !== links.length)
              }
            >
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </fieldset>
      </form>
      {discard && (
        <Confirm
          title="Выйти без сохранения?"
          busy={false}
          confirmLabel="Выйти"
          onCancel={() => setDiscard(false)}
          onConfirm={onClose}
        >
          Введённые данные будут потеряны.
        </Confirm>
      )}
    </>
  );
}
