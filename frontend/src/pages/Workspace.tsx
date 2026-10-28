import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useCallback,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBell,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconClipboardCheck,
  IconClock,
  IconDeviceDesktop,
  IconDoorEnter,
  IconDoorExit,
  IconFlag,
  IconHistory,
  IconLayoutDashboard,
  IconDots,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconSun,
  IconWallet,
  IconX,
  IconLock,
  IconMessageCircle,
  IconInfoCircle,
  IconBrush,
  IconUsers,
} from "@tabler/icons-react";
import { PersonnelPage } from "../components/PersonnelPage";
import { NotificationSettings } from "../components/NotificationSettings";
import { CashBalance } from "../components/CashBalance";
import { Equipment } from "../pages/Equipment";
import { PrivateImage } from "../components/PrivateImage";
import { SchedulePage } from "../components/SchedulePage";
import {
  CleanerHistory,
  NotificationDetails,
  notificationTarget,
  type RecordTarget,
} from "../components/ShiftEvents";
import Upload from "../components/PhotoUpload";
import {
  EvidenceUploads,
  PhotoFieldsEditor,
  PhotoSettingsPage,
} from "../components/PhotoFields";
import type { User } from "../lib/types";
import {
  visibleTasks,
  defaultReportPhotoFields,
  photoEvidenceError,
  photoFieldsError,
  type EvidencePhoto,
  type PhotoMode,
  type PhotoRequirement,
  type StaffMember,
  type Action,
  type State,
  type Task,
} from "../lib/workspace";
import {
  haptic,
  initializeTelegram,
  inTelegram,
  telegram,
  confirmAction,
} from "../lib/telegram";
import { useDraft } from "../lib/useDraft";
import {
  money,
  time,
  dateLabel,
  parseAmount,
  validAmount,
} from "../lib/format";
import "./workspace.css";

type View =
  | "personnel"
  | "schedule"
  | "cleaner"
  | "shift"
  | "tasks"
  | "expenses"
  | "history"
  | "devices"
  | "notifications"
  | "photo-settings"
  | "more";
type Form = "expense" | "close" | "open" | "create" | null;
const People = createContext<StaffMember[]>([]);
function usePeople() {
  const people = useContext(People);
  return {
    people,
    person: (id: string) =>
      people.find((p) => p.id === id) || {
        id,
        name: "Сотрудник",
        initials: "?",
        role: "admin" as const,
      },
  };
}
export interface WorkspaceProps {
  state: State;
  people: StaffMember[];
  user: StaffMember;
  account: User;
  busy: boolean;
  error: string;
  perform: (action: Action) => Promise<void>;
  refresh?: () => Promise<void>;
}
function Status({ status }: { status: Task["status"] }) {
  return (
    <span className={`cp-status cp-status-${status}`}>
      {status === "moderation" ? (
        <IconClock size={12} />
      ) : status === "accepted" ? (
        <IconCheck size={12} />
      ) : (
        <span className="cp-dot" />
      )}
      {
        {
          active: "К выполнению",
          moderation: "На проверке",
          accepted: "Принято",
          rejected: "На доработке",
        }[status]
      }
    </span>
  );
}

function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="cp-empty">
      <IconCircleCheck size={36} stroke={1.3} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export default function Workspace({
  workspace,
}: {
  workspace: WorkspaceProps;
}) {
  return (
    <People.Provider value={workspace.people}>
      <WorkspaceView workspace={workspace} />
    </People.Provider>
  );
}
function WorkspaceView({ workspace }: { workspace: WorkspaceProps }) {
  const equipmentDraft = useRef({ dirty: false, busy: false });
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (
        event as CustomEvent<{ source?: string; dirty: boolean; busy: boolean }>
      ).detail;
      if (
        [
          "equipment",
          "schedule",
          "personnel",
          "cash",
          "notification-settings",
        ].includes(detail.source || "")
      )
        equipmentDraft.current = detail;
    };
    window.addEventListener("draft-status", listen);
    return () => window.removeEventListener("draft-status", listen);
  }, []);
  const state = workspace.state;
  const { person } = usePeople();
  const busy = workspace.busy;
  const running = useRef(false);
  const cleanerPrompt = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).has("schedule")
      ? "schedule"
      : new URLSearchParams(location.search).has("cleaner")
        ? "cleaner"
        : "shift",
  );
  const [scheduleId, setScheduleId] = useState(() => {
    const id = new URLSearchParams(location.search).get("schedule");
    return id && /^[1-9]\d*$/.test(id) ? id : undefined;
  });
  const [linkedRecord, setLinkedRecord] = useState<RecordTarget | null>(() =>
    notificationTarget(location.search),
  );
  const [cleanerMonth, setCleanerMonth] = useState(
    () => new URLSearchParams(location.search).get("cleaner") || undefined,
  );
  const [form, setForm] = useState<Form>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("task"),
  );
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("all");
  const [historyTab, setHistoryTab] = useState("shifts");
  const [taskScope, setTaskScope] = useState<"mine" | "assigned">("mine");
  const [dirty, setDirty] = useState(false);
  const user = workspace.user;
  const isManager = user.role !== "admin";
  const ownsShift = user.role === "admin" && state.shift?.adminId === user.id;
  const embedded = inTelegram();
  const tasks = visibleTasks(state, user);
  const scopedTasks =
    user.role === "admin"
      ? state.tasks.filter((task) => task.adminId === user.id)
      : tasks;
  const listTasks =
    user.role === "manager"
      ? tasks.filter((task) =>
          taskScope === "mine"
            ? task.adminId === user.id
            : task.managerId === user.id,
        )
      : tasks;
  const activeTasks = listTasks.filter((task) => task.status !== "accepted");
  const selected = scopedTasks.find((task) => task.id === selectedTask);
  const moderationCount = activeTasks.filter(
    (task) => task.status === "moderation",
  ).length;
  const isMain = view === "shift" || view === "tasks";
  const nested = Boolean(
    form ||
    linkedRecord ||
    selectedTask ||
    [
      "history",
      "expenses",
      "notifications",
      "photo-settings",
      "cleaner",
      "schedule",
      "personnel",
    ].includes(view),
  );
  const navigate = useCallback((target: View) => {
    if (equipmentDraft.current.busy) return;
    if (
      equipmentDraft.current.dirty &&
      !window.confirm("Выйти без сохранения изменений?")
    )
      return;
    setView(target);
    setLinkedRecord(null);
    setForm(null);
    setSelectedTask(null);
    setFilter("all");
    setDirty(false);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    if (busy || equipmentDraft.current.busy) return;
    if (
      (dirty || equipmentDraft.current.dirty) &&
      !window.confirm("Выйти без сохранения изменений?")
    )
      return;
    setDirty(false);
    if (linkedRecord) setLinkedRecord(null);
    else if (form) setForm(null);
    else if (selectedTask) setSelectedTask(null);
    else navigate("more");
    window.scrollTo({ top: 0 });
  }, [dirty, busy, linkedRecord, form, selectedTask, navigate]);
  const openShiftHistory = () => {
    setHistoryTab("shifts");
    navigate("history");
  };
  const notify = (message: string) => {
    setToast(message);
    haptic("success");
  };
  const save = async (action: Action, message: string, closeForm = false) => {
    if (running.current || busy) return false;
    running.current = true;
    setSaveError("");
    try {
      await workspace.perform(action);
      setDirty(false);
      if (closeForm) setForm(null);
      if (action.type === "REVIEW_TASK" && action.accept) setSelectedTask(null);
      notify(message);
      return true;
    } catch (error) {
      setSaveError((error as Error).message);
      haptic("error");
      return false;
    } finally {
      running.current = false;
    }
  };
  useDraft(dirty, busy, "workspace");
  useEffect(() => {
    document.title = "COLIZEUM · Рабочее приложение";
    document.documentElement.lang = "ru";
    document.documentElement.classList.add("mini-app-page");
    const cleanup = initializeTelegram();
    return () => {
      cleanup();
      document.documentElement.classList.remove("mini-app-page");
    };
  }, []);
  useEffect(() => {
    const app = telegram();
    if (!inTelegram() || !app?.isVersionAtLeast("6.1")) return;
    if (!nested) {
      app.BackButton.hide();
      return;
    }
    app.BackButton.show();
    app.BackButton.onClick(back);
    return () => {
      app.BackButton.offClick(back);
      app.BackButton.hide();
    };
  }, [nested, back]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const activities = state.activity.filter(
    (item) =>
      user.role === "superuser" ||
      (isManager && item.kind !== "task") ||
      (isManager
        ? item.managerId === user.id ||
          item.actorId === user.id ||
          item.recipientId === user.id
        : item.actorId === user.id || item.recipientId === user.id),
  );
  const taskFilters = isManager
    ? [
        ["all", "Активные"],
        [
          "moderation",
          user.role === "manager" && taskScope === "mine"
            ? "На проверке"
            : "На проверке",
        ],
        ["accepted", "История"],
      ]
    : [
        ["all", "Все"],
        ["todo", "К выполнению"],
        ["moderation", "На проверке"],
      ];
  const filteredTasks = (
    filter === "accepted" ? listTasks : activeTasks
  ).filter(
    (task) =>
      filter === "all" ||
      (filter === "todo"
        ? task.status === "active" || task.status === "rejected"
        : task.status === filter),
  );
  return (
    <div
      className={`cp-app${embedded ? " cp-in-telegram" : ""}${form || selected || linkedRecord ? " cp-focused" : ""}`}
      onChange={() => {
        if (form || selectedTask || view === "photo-settings") setDirty(true);
      }}
    >
      <a className="cp-skip" href="#workspace-content">
        Перейти к содержимому
      </a>
      <header className="cp-header">
        <span className="cp-brand">
          COLIZEUM <span>WORK</span>
        </span>
        <button
          className="cp-profile"
          aria-label={`Открыть раздел «Ещё»: ${user.name}`}
          onClick={() => {
            if (equipmentDraft.current.busy) return;
            if (!dirty || window.confirm("Выйти без сохранения изменений?"))
              navigate("more");
          }}
        >
          {user.name}
        </button>
      </header>
      <main id="workspace-content" className="cp-content">
        {(saveError || workspace.error) && (
          <p className="cp-inline-error" role="alert">
            {saveError || workspace.error}
          </p>
        )}
        {busy && (
          <p role="status" className="cp-list-hint">
            Сохраняем…
          </p>
        )}
        <fieldset className="cp-workspace-controls" disabled={busy}>
          {linkedRecord ? (
            <NotificationDetails target={linkedRecord} onBack={back} />
          ) : form ? (
            <WorkflowForm
              key={`${form}-${user.id}`}
              kind={form}
              user={user}
              state={state}
              onBack={back}
              onSave={(action, message) => {
                void save(action, message, true);
              }}
            />
          ) : selected ? (
            <TaskDetails
              key={selected.id}
              task={selected}
              user={user}
              state={state}
              onBack={back}
              onSave={(action, message) => {
                void save(action, message);
              }}
            />
          ) : (
            <>
              {isMain && (
                <>
                  <div className="cp-page-heading">
                    <h1>{isManager ? "Задачи" : "Текущая смена"}</h1>
                    {isManager ? (
                      <button
                        className="cp-button cp-button-primary"
                        disabled={!state.shift && user.role !== "superuser"}
                        onClick={() => {
                          if (equipmentDraft.current.busy) return;
                          if (
                            equipmentDraft.current.dirty &&
                            !window.confirm("Выйти без сохранения изменений?")
                          )
                            return;
                          setForm("create");
                        }}
                      >
                        <IconPlus size={18} />
                        Создать задачу
                      </button>
                    ) : (
                      <span className="cp-date">
                        {dateLabel(new Date().toISOString())}
                      </span>
                    )}
                  </div>
                  <>
                    {state.shift ? (
                      <section
                        className="cp-shift-summary"
                        aria-label={
                          isManager ? "Активная смена" : "Текущая смена"
                        }
                      >
                        <div>
                          <span
                            className={`cp-live${ownsShift || isManager ? "" : " cp-live-waiting"}`}
                          >
                            <span className="cp-dot" />
                            {isManager
                              ? "Активная смена"
                              : ownsShift
                                ? "На смене"
                                : "Смена идёт"}
                          </span>
                          <h2>
                            {state.shift.type === "day"
                              ? "Дневная смена"
                              : "Ночная смена"}
                            <span>с {time(state.shift.openedAt)}</span>
                          </h2>
                          <p>
                            {person(state.shift.adminId).name}
                            {!ownsShift &&
                              !isManager &&
                              " · Дождитесь закрытия этой смены"}
                          </p>
                        </div>
                        {(ownsShift || isManager) && (
                          <div className="cp-cash">
                            <span>Наличные в кассе</span>
                            <CashBalance
                              balance={state.balance}
                              editable={user.role === "superuser"}
                              onSaved={async () => {
                                await workspace.refresh?.();
                                notify("Остаток кассы обновлён.");
                              }}
                              onDirty={setDirty}
                              onRefresh={async () => {
                                await workspace.refresh?.();
                              }}
                            />
                          </div>
                        )}
                      </section>
                    ) : isManager ? (
                      <section
                        className="cp-shift-summary"
                        aria-label="Активная смена"
                      >
                        <div>
                          <h2>Нет активной смены</h2>
                          <p>Ожидаем администратора.</p>
                        </div>
                        <div className="cp-cash">
                          <span>Наличные в кассе</span>
                          <CashBalance
                            balance={state.balance}
                            editable={user.role === "superuser"}
                            onSaved={async () => {
                              await workspace.refresh?.();
                              notify("Остаток кассы обновлён.");
                            }}
                            onDirty={setDirty}
                            onRefresh={async () => {
                              await workspace.refresh?.();
                            }}
                          />
                        </div>
                      </section>
                    ) : (
                      <section className="cp-open-shift">
                        <h2>Готовы начать смену?</h2>
                        <p>Предыдущая смена закрыта.</p>
                        <button
                          className="cp-button cp-button-primary"
                          onClick={() => setForm("open")}
                        >
                          <IconDoorEnter size={18} />
                          Открыть смену
                        </button>
                      </section>
                    )}
                    {ownsShift && (
                      <div className="cp-shift-actions">
                        <button
                          className="cp-button cp-button-secondary"
                          onClick={() => setForm("expense")}
                        >
                          <IconPlus size={18} />
                          Добавить расход
                        </button>
                        <button
                          className="cp-button cp-button-secondary"
                          onClick={() => setForm("close")}
                        >
                          <IconDoorExit size={18} />
                          Закрыть смену
                        </button>
                        <button
                          className="cp-button cp-button-secondary cp-cleaner-action"
                          disabled={Boolean(state.shift?.cleanerVisitedAt)}
                          onClick={async () => {
                            if (cleanerPrompt.current) return;
                            const shiftId = state.shift?.id;
                            if (!shiftId) return;
                            cleanerPrompt.current = true;
                            try {
                              if (
                                !shiftId ||
                                !(await confirmAction(
                                  "Подтвердить приход уборщицы? Отметить приход можно только один раз за смену.",
                                ))
                              )
                                return;
                              await save(
                                {
                                  type: "MARK_CLEANER",
                                  actorId: user.id,
                                  shiftId,
                                  confirmed: true,
                                },
                                "Приход уборщицы отмечен. Управляющие и суперпользователи получат уведомление.",
                              );
                            } catch {
                              setSaveError(
                                "Не удалось подтвердить приход уборщицы. Повторите попытку.",
                              );
                            } finally {
                              cleanerPrompt.current = false;
                            }
                          }}
                        >
                          <IconBrush size={18} />
                          {state.shift?.cleanerVisitedAt
                            ? `Уборщица · отмечено в ${time(state.shift.cleanerVisitedAt)}`
                            : "Уборщица"}
                        </button>
                      </div>
                    )}
                  </>
                  {user.role === "superuser" && (
                    <p className="cp-list-hint">
                      Задачи для администраторов и управляющих
                    </p>
                  )}
                  <section className="cp-checklist">
                    {user.role === "manager" && (
                      <div
                        className="cp-task-scope"
                        aria-label="Исполнитель и постановщик"
                      >
                        {[
                          ["mine", "Мои задачи"],
                          ["assigned", "Поставленные мной"],
                        ].map(([scope, label]) => (
                          <button
                            key={scope}
                            aria-pressed={taskScope === scope}
                            className={
                              taskScope === scope ? "cp-scope-selected" : ""
                            }
                            onClick={() => {
                              setTaskScope(scope as "mine" | "assigned");
                              setFilter("all");
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {!isManager && (
                      <div className="cp-section-heading">
                        <h2>
                          Задачи
                          <span>{activeTasks.length}</span>
                        </h2>
                      </div>
                    )}
                    <div className="cp-task-toolbar">
                      <div className="cp-tabs" aria-label="Фильтр задач">
                        {taskFilters.map(([id, label]) => (
                          <button
                            key={id}
                            className={filter === id ? "cp-tab-active" : ""}
                            aria-pressed={filter === id}
                            onClick={() => setFilter(id)}
                          >
                            {label}
                            {id === "moderation" && moderationCount > 0 && (
                              <span>{moderationCount}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <TaskList
                      tasks={filteredTasks}
                      onSelect={(id) => {
                        if (equipmentDraft.current.busy) return;
                        if (
                          equipmentDraft.current.dirty &&
                          !window.confirm("Выйти без сохранения изменений?")
                        )
                          return;
                        setSelectedTask(id);
                        setDirty(false);
                        window.scrollTo({ top: 0 });
                      }}
                    />
                    {moderationCount > 0 && (
                      <p className="cp-list-hint">
                        Задачи остаются здесь до принятия управляющим.
                      </p>
                    )}
                  </section>
                </>
              )}
              {view === "devices" && (
                <div className="cp-live-equipment">
                  <Equipment user={workspace.account} notify={notify} />
                </div>
              )}
              {view === "more" && (
                <>
                  <div className="cp-page-heading">
                    <h1>Ещё</h1>
                  </div>
                  <div className="cp-account">
                    <div>
                      <strong>{user.name}</strong>
                      <p>
                        {user.role === "superuser"
                          ? "Суперпользователь"
                          : isManager
                            ? "Управляющий"
                            : "Администратор"}
                      </p>
                    </div>
                  </div>
                  <div className="cp-menu" aria-label="Дополнительные разделы">
                    {[
                      {
                        id: "schedule" as const,
                        label: "График смен",
                        icon: IconHistory,
                      },
                      {
                        id: "history" as const,
                        label: "История смен/задач",
                        icon: IconHistory,
                      },
                      {
                        id: "expenses" as const,
                        label: "Расходы",
                        icon: IconWallet,
                      },
                      {
                        id: "notifications" as const,
                        label: "Уведомления",
                        icon: IconBell,
                      },
                      ...(isManager
                        ? [
                            {
                              id: "cleaner" as const,
                              label: "Уборщица",
                              icon: IconBrush,
                            },
                            {
                              id: "photo-settings" as const,
                              label: "Фотографии отчёта",
                              icon: IconCamera,
                            },
                          ]
                        : []),
                      ...(user.role === "superuser"
                        ? [
                            {
                              id: "personnel" as const,
                              label: "Персонал",
                              icon: IconUsers,
                            },
                          ]
                        : []),
                    ].map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() =>
                          id === "history" ? openShiftHistory() : navigate(id)
                        }
                      >
                        <Icon size={21} stroke={1.5} />
                        <span>{label}</span>
                        <IconChevronRight size={18} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {view === "photo-settings" && isManager && (
                <PhotoSettingsPage
                  settings={
                    state.photoSettings || {
                      reportFields: defaultReportPhotoFields,
                      version: 1,
                    }
                  }
                  actorId={user.id}
                  onBack={back}
                  onDirty={() => setDirty(true)}
                  onSave={(action, message) => save(action, message)}
                />
              )}
              {view === "personnel" && user.role === "superuser" && (
                <PersonnelPage
                  onBack={back}
                  onChanged={async () => {
                    await workspace.refresh?.();
                  }}
                />
              )}
              {view === "cleaner" && isManager && (
                <CleanerHistory
                  initialMonth={cleanerMonth}
                  onMonthChange={setCleanerMonth}
                  onBack={back}
                />
              )}
              {view === "cleaner" && !isManager && (
                <p role="alert">
                  История уборщицы доступна только управляющим и
                  суперпользователям.
                </p>
              )}
              {view === "schedule" && (
                <SchedulePage
                  user={user}
                  initialId={scheduleId}
                  onBack={back}
                  onDirty={setDirty}
                  onOpenShift={(id, periodId) => {
                    setScheduleId(periodId);
                    setLinkedRecord({ kind: "shift", id });
                  }}
                />
              )}
              {view === "expenses" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Назад в «Ещё»
                  </button>
                  <div className="cp-page-heading">
                    <h1>Расходы</h1>
                    {ownsShift && (
                      <button
                        className="cp-button cp-button-primary"
                        onClick={() => setForm("expense")}
                      >
                        <IconPlus size={18} />
                        Добавить расход
                      </button>
                    )}
                  </div>
                  <div className="cp-register-strip">
                    <span>Наличные в кассе</span>
                    <CashBalance
                      balance={state.balance}
                      editable={user.role === "superuser"}
                      onSaved={async () => {
                        await workspace.refresh?.();
                        notify("Остаток кассы обновлён.");
                      }}
                      onDirty={setDirty}
                      onRefresh={async () => {
                        await workspace.refresh?.();
                      }}
                    />
                  </div>
                  <div className="cp-records">
                    {state.expenses
                      .filter((e) => isManager || e.adminId === user.id)
                      .map((expense) => (
                        <details className="cp-expense-row" key={expense.id}>
                          <summary>
                            <div>
                              <strong>{expense.description}</strong>
                              <small>
                                {dateLabel(expense.createdAt)} ·{" "}
                                {person(expense.adminId).name}
                              </small>
                            </div>
                            <strong>−{money(expense.amount)}</strong>
                            <IconChevronDown size={16} />
                          </summary>
                          <p>{time(expense.createdAt)} · Расход из кассы</p>
                          {expense.photo && (
                            <PrivateImage
                              className="cp-receipt"
                              src={expense.photo}
                              alt="Чек расхода"
                            />
                          )}
                        </details>
                      ))}
                    {!state.expenses.some(
                      (e) => isManager || e.adminId === user.id,
                    ) && (
                      <Empty
                        title="Расходов пока нет"
                        text="Здесь появятся расходы из кассы."
                      />
                    )}
                  </div>
                </>
              )}
              {view === "history" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Назад в «Ещё»
                  </button>
                  <div className="cp-page-heading">
                    <h1>История смен/задач</h1>
                  </div>
                  <div className="cp-tabs cp-history-tabs">
                    <button
                      className={historyTab === "shifts" ? "cp-tab-active" : ""}
                      onClick={() => setHistoryTab("shifts")}
                    >
                      Закрытые смены
                    </button>
                    <button
                      className={historyTab === "tasks" ? "cp-tab-active" : ""}
                      onClick={() => setHistoryTab("tasks")}
                    >
                      История задач
                    </button>
                  </div>
                  {historyTab === "tasks" ? (
                    <TaskList
                      tasks={scopedTasks.filter(
                        (t) =>
                          t.status === "accepted" ||
                          state.shifts.some((s) => s.id === t.shiftId),
                      )}
                      onSelect={setSelectedTask}
                    />
                  ) : state.shifts.filter(
                      (s) => isManager || s.adminId === user.id,
                    ).length ? (
                    state.shifts
                      .filter((s) => isManager || s.adminId === user.id)
                      .map((shift) => (
                        <details className="cp-history-row" key={shift.id}>
                          <summary>
                            <span>
                              <strong>
                                {dateLabel(shift.openedAt)} ·{" "}
                                {shift.type === "day"
                                  ? "Дневная смена"
                                  : "Ночная смена"}
                              </strong>
                              <small>
                                {person(shift.adminId).name} ·{" "}
                                {shift.legacy
                                  ? "Архивный отчёт"
                                  : `${time(shift.openedAt)} – ${shift.closedAt ? time(shift.closedAt) : "Открыта"}`}
                              </small>
                            </span>
                            <span className="cp-history-total">
                              <small>Итого</small>
                              <strong>
                                {money(
                                  (shift.cash ?? 0) +
                                    (shift.cards ?? 0) +
                                    (shift.sbp ?? 0),
                                )}
                              </strong>
                            </span>
                            <IconChevronDown size={18} />
                          </summary>
                          <div className="cp-history-details">
                            <span>
                              Наличные<strong>{money(shift.cash || 0)}</strong>
                            </span>
                            <span>
                              Карта<strong>{money(shift.cards || 0)}</strong>
                            </span>
                            <span>
                              СБП<strong>{money(shift.sbp || 0)}</strong>
                            </span>
                            {Object.entries(shift.photos || {}).map(
                              ([label, src]) => (
                                <figure key={label}>
                                  <PrivateImage src={src} alt={label} />
                                  <figcaption>{label}</figcaption>
                                </figure>
                              ),
                            )}
                          </div>
                        </details>
                      ))
                  ) : (
                    <Empty
                      title="Закрытых смен пока нет"
                      text="Здесь появятся отчёты о сменах."
                    />
                  )}
                </>
              )}
              {view === "notifications" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Назад в «Ещё»
                  </button>
                  <div className="cp-page-heading">
                    <h1>Уведомления</h1>
                  </div>
                  {isManager && <NotificationSettings />}
                  {activities.map((item) => (
                    <div className="cp-notification" key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <small>
                          {dateLabel(item.time)} · {time(item.time)}
                        </small>
                      </div>
                    </div>
                  ))}
                  {!activities.length && (
                    <Empty
                      title="Уведомлений пока нет"
                      text="Здесь появятся события по задачам."
                    />
                  )}
                </>
              )}
            </>
          )}
        </fieldset>
      </main>
      {!form && !selected && !linkedRecord && (
        <nav className="cp-bottom-nav" aria-label="Основная навигация">
          <button
            aria-current={isMain ? "page" : undefined}
            className={isMain ? "cp-nav-active" : ""}
            onClick={() => navigate(isManager ? "tasks" : "shift")}
          >
            {isManager ? (
              <IconClipboardCheck size={22} stroke={1.6} />
            ) : (
              <IconLayoutDashboard size={22} stroke={1.6} />
            )}
            <span>{isManager ? "Задачи" : "Смена"}</span>
          </button>
          <button
            aria-current={view === "devices" ? "page" : undefined}
            className={view === "devices" ? "cp-nav-active" : ""}
            onClick={() => navigate("devices")}
          >
            <IconDeviceDesktop size={22} stroke={1.6} />
            <span>Устройства</span>
          </button>
          <button
            aria-current={
              view === "more" || (!isMain && view !== "devices")
                ? "page"
                : undefined
            }
            className={
              view === "more" || (!isMain && view !== "devices")
                ? "cp-nav-active"
                : ""
            }
            onClick={() => navigate("more")}
          >
            <IconDots size={22} stroke={1.6} />
            <span>Ещё</span>
          </button>
        </nav>
      )}
      {toast && (
        <div className="cp-toast" role="status">
          <IconCheck size={19} />
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <IconX size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cp-task-list">
      {tasks.length === 0 ? (
        <Empty
          title="Пока нет задач"
          text="Здесь появятся назначенные задачи, соответствующие выбранному фильтру."
        />
      ) : (
        tasks.map((task) => (
          <button
            className="cp-task-row"
            key={task.id}
            onClick={() => onSelect(task.id)}
          >
            <span className="cp-task-main">
              <strong>{task.title}</strong>
              <span className="cp-task-metadata">
                {task.priority === "high" && (
                  <span className="cp-priority">
                    <IconFlag size={12} />
                    Высокий приоритет
                  </span>
                )}
                {task.requiresPhoto && (
                  <span>
                    <IconCamera size={13} />
                    Нужна фотография
                  </span>
                )}
              </span>
            </span>
            <Status status={task.status} />
            <IconChevronRight className="cp-task-arrow" size={17} />
          </button>
        ))
      )}
    </div>
  );
}

function TaskDetails({
  task,
  user,
  state,
  onBack,
  onSave,
}: {
  task: Task;
  user: StaffMember;
  state: State;
  onBack: () => void;
  onSave: (action: Action, message: string) => void;
}) {
  const { person } = usePeople();
  const photoMode =
    task.photoMode || (task.requiresPhoto ? "single" : "optional");
  const photoRequirements = task.photoRequirements || [];
  const evidence =
    task.photos ||
    (task.photo
      ? [
          {
            url: task.photo,
            slot: "",
            label: task.photoName || "Фото выполнения",
          },
        ]
      : []);
  const [photos, setPhotos] = useState<EvidencePhoto[]>(evidence);
  const [note, setNote] = useState(task.note || "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const canSubmit =
    user.role !== "superuser" &&
    task.adminId === user.id &&
    (user.role === "manager" ||
      (state.shift?.adminId === user.id &&
        (!task.shiftId || state.shift.id === task.shiftId))) &&
    (task.status === "active" || task.status === "rejected");
  const canReview =
    task.adminId !== user.id &&
    (task.managerId === user.id || user.role === "superuser") &&
    task.status === "moderation";
  return (
    <div className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={17} />
        Назад к задачам
      </button>
      <div className="cp-page-heading">
        <div>
          <h1>{task.title}</h1>
          <p>
            Постановщик: {person(task.managerId).name} ·{" "}
            {dateLabel(task.createdAt)}
          </p>
        </div>
        <Status status={task.status} />
      </div>
      <div className="cp-detail-layout">
        <section className="cp-form-panel">
          <h2>Описание задачи</h2>
          <p className="cp-description">{task.description}</p>
          {task.referencePhoto && (
            <figure className="cp-reference">
              <PrivateImage
                src={task.referencePhoto}
                alt="Фото-пример к задаче"
              />
              <figcaption>
                Фото-пример от {person(task.managerId).name}
              </figcaption>
            </figure>
          )}
          <div className="cp-detail-meta">
            <span>
              <IconShieldCheck size={16} />
              {person(task.adminId).name}
            </span>
            <span>
              <IconCamera size={16} />
              {
                {
                  optional: "Фото выполнения необязательно",
                  single: "Нужно одно фото выполнения",
                  multiple: "Нужны фотографии выполнения",
                  named: "Фотографии по указанным полям",
                }[photoMode]
              }
            </span>
            {task.priority === "high" && (
              <span className="cp-priority">
                <IconFlag size={15} />
                Высокий приоритет
              </span>
            )}
          </div>
          {task.status === "rejected" && (
            <div className="cp-rework">
              <IconMessageCircle size={20} />
              <div>
                <strong>Требуется доработка</strong>
                <p>{task.rejectionReason}</p>
              </div>
            </div>
          )}
          {task.status === "moderation" && (
            <div className="cp-review-notice">
              <IconClock size={21} />
              <div>
                <strong>На проверке</strong>
                <p>
                  {user.role === "admin"
                    ? `Задачу проверит ${person(task.managerId).deleted ? "суперпользователь" : person(task.managerId).name}. Она останется здесь до принятия.`
                    : user.id === task.adminId
                      ? `Задачу проверит ${person(task.managerId).deleted ? "суперпользователь" : person(task.managerId).name}.`
                      : "Проверьте фотографии и комментарий, затем примите задачу или верните её на доработку."}
                </p>
              </div>
            </div>
          )}
          {!canSubmit &&
            evidence.map((photo, index) => (
              <figure className="cp-reference" key={photo.id || index}>
                <PrivateImage src={photo.url} alt={photo.label} />
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
          {task.note && !canSubmit && (
            <div className="cp-completion-note">
              <h3>Комментарий к выполнению</h3>
              <p>{task.note}</p>
            </div>
          )}
          {canSubmit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const photoError = photoEvidenceError(
                  photoMode,
                  photoRequirements,
                  photos,
                );
                if (photoError) {
                  setError(photoError);
                  return;
                }
                onSave(
                  {
                    type: "SUBMIT_TASK",
                    actorId: user.id,
                    taskId: task.id,
                    photos,
                    note,
                  },
                  person(task.managerId).deleted
                    ? "Задача отправлена на проверку суперпользователю."
                    : `Задача отправлена на проверку: ${person(task.managerId).name}.`,
                );
              }}
            >
              <h2 className="cp-form-section-title">Выполнение задачи</h2>
              <EvidenceUploads
                mode={photoMode}
                fields={photoRequirements}
                photos={photos}
                onChange={setPhotos}
                onError={setError}
              />
              <label className="cp-field">
                Комментарий к выполнению
                <span className="cp-field-optional">Необязательно</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Что нужно сообщить управляющему?"
                  maxLength={2000}
                />
              </label>
              {error && (
                <p className="cp-inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="cp-form-actions">
                <button
                  type="button"
                  className="cp-button cp-button-secondary"
                  onClick={onBack}
                >
                  Назад
                </button>
                <button className="cp-button cp-button-primary">
                  <IconCheck size={17} />
                  Закрыть задачу
                </button>
              </div>
            </form>
          )}
          {canReview && (
            <div className="cp-review-actions">
              {rejecting && (
                <label className="cp-field">
                  Что нужно исправить?
                  <textarea
                    autoFocus
                    rows={3}
                    value={reason}
                    maxLength={2000}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Объясните, что администратору нужно исправить…"
                  />
                </label>
              )}
              {error && (
                <p className="cp-inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="cp-form-actions">
                {rejecting ? (
                  <>
                    <button
                      className="cp-button cp-button-secondary"
                      onClick={() => {
                        setRejecting(false);
                        setError("");
                      }}
                    >
                      Отмена
                    </button>
                    <button
                      className="cp-button cp-button-danger"
                      onClick={() => {
                        if (!reason.trim()) {
                          setError(
                            "Укажите причину, чтобы администратор знал, что исправить.",
                          );
                          return;
                        }
                        onSave(
                          {
                            type: "REVIEW_TASK",
                            actorId: user.id,
                            taskId: task.id,
                            accept: false,
                            version: task.submissionVersion,
                            reason,
                          },
                          "Задача возвращена администратору на доработку.",
                        );
                        setRejecting(false);
                      }}
                    >
                      <IconRefresh size={16} />
                      Вернуть на доработку
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="cp-button cp-button-secondary"
                      onClick={() => setRejecting(true)}
                    >
                      <IconX size={17} />
                      Отклонить задачу
                    </button>
                    <button
                      className="cp-button cp-button-primary"
                      onClick={() =>
                        onSave(
                          {
                            type: "REVIEW_TASK",
                            actorId: user.id,
                            taskId: task.id,
                            accept: true,
                            version: task.submissionVersion,
                          },
                          "Задача принята и сохранена в истории.",
                        )
                      }
                    >
                      <IconCheck size={17} />
                      Принять задачу
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WorkflowForm({
  kind,
  user,
  state,
  onBack,
  onSave,
}: {
  kind: Exclude<Form, null>;
  user: StaffMember;
  state: State;
  onBack: () => void;
  onSave: (action: Action, message: string) => void;
}) {
  const [error, setError] = useState("");
  const { person, people } = usePeople();
  const [shiftType, setShiftType] = useState<"day" | "night">("day");
  const [cash, setCash] = useState("");
  const [cards, setCards] = useState("");
  const [sbp, setSbp] = useState("");
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");
  const [photoMode, setPhotoMode] = useState<PhotoMode>("optional");
  const [taskPhotoFields, setTaskPhotoFields] = useState<PhotoRequirement[]>(
    [],
  );
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState("");
  const reportPhotoFields =
    state.shift?.photoRequirements || defaultReportPhotoFields;
  const assignees = people.filter(
    (person) =>
      !person.deleted &&
      person.isActive !== false &&
      (user.role === "superuser"
        ? person.role === "admin" || person.role === "manager"
        : person.role === "admin" && person.id === state.shift?.adminId),
  );
  const [adminId, setAdminId] = useState(assignees[0]?.id || "");
  const headings = {
    expense: "Добавить расход",
    close: "Закрыть смену",
    open: "Открыть смену",
    create: "Создать задачу",
  };
  const subtitles = {
    expense: "Укажите сумму и причину расхода.",
    close: "Укажите выручку и приложите фотографии для закрытия смены.",
    open: "Выберите тип смены.",
    create:
      user.role === "superuser"
        ? "Назначьте задачу администратору или управляющему."
        : "Назначьте задачу администратору текущей смены.",
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (kind === "open") {
      if (state.shift) {
        setError("Другая смена ещё открыта. Дождитесь её закрытия.");
        return;
      }
      onSave(
        { type: "OPEN_SHIFT", actorId: user.id, shiftType },
        "Ваша смена открыта. Можно приступать к работе.",
      );
    } else if (kind === "expense") {
      const amount = parseAmount(cash);
      if (!Number.isFinite(amount) || amount <= 0 || !validAmount(cash)) {
        setError(
          "Введите положительную сумму, не более двух знаков после запятой.",
        );
        return;
      }
      if (amount > state.balance) {
        setError(
          `Сумма расхода превышает доступный остаток в кассе: ${money(state.balance)}.`,
        );
        return;
      }
      if (!description.trim()) {
        setError("Укажите, на что потрачены деньги.");
        return;
      }
      if (user.role === "admin" && state.shift?.adminId !== user.id) {
        setError("Откройте свою смену, чтобы добавить расход.");
        return;
      }
      onSave(
        {
          type: "ADD_EXPENSE",
          actorId: user.id,
          amount,
          description: description.trim(),
          photo: photo || undefined,
        },
        `${money(amount)} — расход сохранён и вычтен из кассы.`,
      );
    } else if (kind === "close") {
      if (state.shift?.adminId !== user.id) {
        setError("Закрыть смену может только открывший её администратор.");
        return;
      }
      if ([cash, cards, sbp].some((value) => !validAmount(value))) {
        setError(
          "Укажите неотрицательную сумму наличных, оплаты картой и СБП. Если платежей не было, введите 0.",
        );
        return;
      }
      if (
        reportPhotoFields.some((field) => field.required && !photos[field.id])
      ) {
        setError(
          "Перед закрытием смены добавьте фотографии во все обязательные поля.",
        );
        return;
      }
      onSave(
        {
          type: "CLOSE_SHIFT",
          actorId: user.id,
          cash: parseAmount(cash),
          cards: parseAmount(cards),
          sbp: parseAmount(sbp),
          photos: reportPhotoFields
            .filter((field) => photos[field.id])
            .map((field) => ({
              url: photos[field.id],
              slot: field.id,
              label: field.label,
            })),
        },
        "Смена закрыта, отчёт сохранён. Следующий администратор может открыть смену.",
      );
    } else {
      if (!state.shift && user.role !== "superuser") {
        setError("Чтобы назначить задачу, сначала нужно открыть смену.");
        return;
      }
      if (!assignees.some((person) => person.id === adminId)) {
        setError(
          "Выберите администратора или управляющего, которому можно назначить задачу.",
        );
        return;
      }
      if (!title.trim() || !description.trim()) {
        setError("Укажите название задачи и понятные инструкции.");
        return;
      }
      if (photoMode === "named") {
        const photoError = photoFieldsError(taskPhotoFields);
        if (!taskPhotoFields.length || photoError) {
          setError(
            photoError || "Добавьте хотя бы одно именованное поле для фото.",
          );
          return;
        }
      }
      onSave(
        {
          type: "CREATE_TASK",
          actorId: user.id,
          task: {
            title: title.trim(),
            description: description.trim(),
            adminId,
            priority,
            requiresPhoto:
              photoMode === "single" ||
              photoMode === "multiple" ||
              (photoMode === "named" &&
                taskPhotoFields.some((field) => field.required)),
            photoMode,
            photoRequirements:
              photoMode === "named"
                ? taskPhotoFields.map((field) => ({
                    ...field,
                    label: field.label.trim(),
                  }))
                : [],
            referencePhoto: photo || undefined,
          },
        },
        `Исполнитель задачи: ${person(adminId).name}.`,
      );
    }
  };
  return (
    <div className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={17} />
        Назад к работе
      </button>
      <div className="cp-page-heading">
        <div>
          <h1>{headings[kind]}</h1>
          <p>{subtitles[kind]}</p>
        </div>
      </div>
      <div className="cp-detail-layout">
        <form className="cp-form-panel" onSubmit={submit} noValidate>
          {(kind === "open" || kind === "close") && (
            <>
              <h2>Данные смены</h2>
              {kind === "close" ? (
                <>
                  <dl className="cp-closing-shift">
                    <dt>Тип смены</dt>
                    <dd>
                      {state.shift
                        ? state.shift.type === "night"
                          ? "Ночная смена"
                          : "Дневная смена"
                        : "Нет активной смены"}
                    </dd>
                  </dl>
                  <p className="cp-field-hint">Выбран при открытии смены.</p>
                </>
              ) : (
                <fieldset className="cp-shift-choice">
                  <legend>Тип смены</legend>
                  {(["day", "night"] as const).map((type) => (
                    <label
                      className={shiftType === type ? "cp-choice-selected" : ""}
                      key={type}
                    >
                      <input
                        type="radio"
                        name="shiftType"
                        value={type}
                        checked={shiftType === type}
                        onChange={() => setShiftType(type)}
                      />
                      {type === "day" ? (
                        <IconSun size={22} />
                      ) : (
                        <IconMoon size={22} />
                      )}
                      <span>
                        <strong>
                          {type === "day" ? "Дневная смена" : "Ночная смена"}
                        </strong>
                        <small>
                          {type === "day" ? "10:00 – 22:00" : "22:00 – 10:00"}
                        </small>
                      </span>
                      <span className="cp-radio" />
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="cp-form-info">
                <span>{user.name}</span>
                <span>{dateLabel(new Date().toISOString())}</span>
              </div>
            </>
          )}
          {kind === "expense" && (
            <>
              <div className="cp-register-strip">
                <IconWallet size={21} />
                <span>Доступно в кассе</span>
                <strong>{money(state.balance)}</strong>
              </div>
              <label className="cp-field">
                Сумма расхода <span className="cp-required">*</span>
                <span className="cp-input-money">
                  <input
                    aria-label="Сумма расхода"
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0,00"
                  />
                  <span>₽</span>
                </span>
              </label>
              <label className="cp-field">
                Описание <span className="cp-required">*</span>
                <textarea
                  aria-label="Описание расхода"
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Например, средства для уборки клуба"
                />
              </label>
              <Upload
                label="Фотография чека"
                value={photo}
                onError={setError}
                onChange={setPhoto}
              />
              <p className="cp-field-hint">
                Фотография необязательна. Описание требуется всегда.
              </p>
              {parseAmount(cash) > 0 && (
                <div className="cp-form-total">
                  <span>Остаток в кассе после расхода</span>
                  <strong>{money(state.balance - parseAmount(cash))}</strong>
                </div>
              )}
            </>
          )}
          {kind === "close" && (
            <>
              <h2 className="cp-form-section-title">Выручка за смену</h2>
              <p className="cp-field-hint">
                Укажите выручку, полученную за эту смену.
              </p>
              <div className="cp-money-grid">
                {[
                  ["Наличные", cash, setCash],
                  ["Карта", cards, setCards],
                  ["СБП", sbp, setSbp],
                ].map(([label, value, setter]) => (
                  <label className="cp-field" key={label as string}>
                    {label as string}
                    <span className="cp-input-money">
                      <input
                        aria-label={`${label}: сумма`}
                        inputMode="decimal"
                        value={value as string}
                        onChange={(e) =>
                          (setter as (value: string) => void)(e.target.value)
                        }
                        placeholder="0,00"
                      />
                      <span>₽</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="cp-form-total">
                <span>Общая выручка за смену</span>
                <strong>
                  {money(
                    (parseAmount(cash) || 0) +
                      (parseAmount(cards) || 0) +
                      (parseAmount(sbp) || 0),
                  )}
                </strong>
              </div>
              <h2 className="cp-form-section-title">
                Фотографии закрытия смены
              </h2>
              <p className="cp-field-hint">
                Поля со знаком * обязательны. Общий размер фотографий — до 15
                МБ.
              </p>
              {reportPhotoFields.map((field) => (
                <Upload
                  key={field.id}
                  label={field.label}
                  required={field.required}
                  value={photos[field.id]}
                  onError={setError}
                  onChange={(url) =>
                    setPhotos((prev) => ({ ...prev, [field.id]: url }))
                  }
                />
              ))}
              <div className="cp-form-note">
                <IconInfoCircle size={18} />
                <p>
                  После закрытия смены выполненные задачи остаются доступны для
                  проверки. Наличная выручка добавляется в кассу.
                </p>
              </div>
            </>
          )}
          {kind === "create" && (
            <>
              <h2>Описание задачи</h2>
              <label className="cp-field">
                Название задачи <span className="cp-required">*</span>
                <input
                  aria-label="Название задачи"
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например, убрать игровые места"
                />
              </label>
              <label className="cp-field">
                Инструкции <span className="cp-required">*</span>
                <textarea
                  aria-label="Инструкции к задаче"
                  rows={4}
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Опишите, что нужно сделать и каким должен быть результат…"
                />
              </label>
              <div className="cp-money-grid cp-two-columns">
                <label className="cp-field">
                  Исполнитель
                  <select
                    aria-label="Исполнитель"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                  >
                    {assignees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ·{" "}
                        {p.role === "admin" ? "Администратор" : "Управляющий"}
                        {p.id === state.shift?.adminId ? " · На смене" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cp-field">
                  Приоритет
                  <select
                    aria-label="Приоритет задачи"
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as typeof priority)
                    }
                  >
                    <option value="normal">Обычный</option>
                    <option value="high">Высокий приоритет</option>
                    <option value="low">Низкий приоритет</option>
                  </select>
                </label>
              </div>
              <Upload
                label="Фото-пример"
                value={photo}
                onError={setError}
                onChange={setPhoto}
              />
              <label className="cp-field">
                Требования к фотографиям выполнения
                <select
                  aria-label="Требования к фото задачи"
                  value={photoMode}
                  onChange={(event) =>
                    setPhotoMode(event.target.value as PhotoMode)
                  }
                >
                  <option value="optional">Необязательное фото</option>
                  <option value="single">
                    Одно фото без указания содержимого
                  </option>
                  <option value="multiple">
                    Несколько фото без указания содержимого
                  </option>
                  <option value="named">Фото по указанным полям</option>
                </select>
              </label>
              {photoMode === "named" && (
                <PhotoFieldsEditor
                  fields={taskPhotoFields}
                  onChange={setTaskPhotoFields}
                />
              )}
              <div className="cp-form-note">
                <IconLock size={17} />
                <p>Исполнитель выполняет задачу, а вы проверяете результат.</p>
              </div>
            </>
          )}
          {kind === "open" && (
            <div className="cp-form-note">
              <IconInfoCircle size={19} />
              <p>
                Вы станете администратором текущей смены. Следующий
                администратор сможет открыть смену после закрытия вашей.
              </p>
            </div>
          )}
          {error && (
            <p className="cp-inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="cp-form-actions">
            <button
              type="button"
              className="cp-button cp-button-secondary"
              onClick={onBack}
            >
              Отмена
            </button>
            <button className="cp-button cp-button-primary">
              {kind === "expense" ? (
                <IconPlus size={17} />
              ) : kind === "create" ? (
                <IconClipboardCheck size={17} />
              ) : kind === "close" ? (
                <IconDoorExit size={17} />
              ) : (
                <IconDoorEnter size={17} />
              )}
              {kind === "expense"
                ? "Сохранить расход"
                : kind === "create"
                  ? "Назначить задачу"
                  : headings[kind]}
              <IconArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
