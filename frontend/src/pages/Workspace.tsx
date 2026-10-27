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
  IconUpload,
  IconWallet,
  IconX,
  IconLock,
  IconMessageCircle,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Equipment } from "../pages/Equipment";
import { PrivateImage } from "../components/PrivateImage";
import type { User } from "../lib/types";
import {
  visibleTasks,
  requiredPhotoSlots,
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
} from "../lib/telegram";
import { useDraft } from "../lib/useDraft";
import { money, time, dateLabel } from "../lib/format";
import "./workspace.css";

type View =
  | "shift"
  | "tasks"
  | "expenses"
  | "history"
  | "devices"
  | "notifications"
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
        name: "Employee",
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
  logout: () => void;
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
          active: "To do",
          moderation: "On moderation",
          accepted: "Accepted",
          rejected: "Needs rework",
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

function Upload({
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
      if (detail.source === "equipment") equipmentDraft.current = detail;
    };
    window.addEventListener("draft-status", listen);
    return () => window.removeEventListener("draft-status", listen);
  }, []);
  const state = workspace.state;
  const { person } = usePeople();
  const busy = workspace.busy;
  const running = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState<View>("shift");
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
  const ownsShift = state.shift?.adminId === user.id;
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
    selectedTask ||
    ["history", "expenses", "notifications"].includes(view),
  );
  const navigate = useCallback((target: View) => {
    if (equipmentDraft.current.busy) return;
    if (
      equipmentDraft.current.dirty &&
      !window.confirm("Discard your unsaved changes?")
    )
      return;
    setView(target);
    setForm(null);
    setSelectedTask(null);
    setFilter("all");
    setDirty(false);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    if (form) setForm(null);
    else if (selectedTask) setSelectedTask(null);
    else navigate("more");
    window.scrollTo({ top: 0 });
  }, [dirty, busy, form, selectedTask, navigate]);
  const openShiftHistory = () => {
    setHistoryTab("shifts");
    navigate("history");
  };
  const notify = (message: string) => {
    setToast(message);
    haptic("success");
  };
  const save = async (action: Action, message: string, closeForm = false) => {
    if (running.current || busy) return;
    running.current = true;
    setSaveError("");
    try {
      await workspace.perform(action);
      setDirty(false);
      if (closeForm) setForm(null);
      if (action.type === "REVIEW_TASK" && action.accept) setSelectedTask(null);
      notify(message);
    } catch (error) {
      setSaveError((error as Error).message);
      haptic("error");
    } finally {
      running.current = false;
    }
  };
  useDraft(dirty, busy, "workspace");
  useEffect(() => {
    document.title = "COLIZEUM Work";
    document.documentElement.lang = "en";
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
      (isManager
        ? item.managerId === user.id ||
          item.actorId === user.id ||
          item.recipientId === user.id
        : item.actorId === user.id || item.recipientId === user.id),
  );
  const taskFilters = isManager
    ? [
        ["all", "Active"],
        [
          "moderation",
          user.role === "manager" && taskScope === "mine"
            ? "On moderation"
            : "Review",
        ],
        ["accepted", "History"],
      ]
    : [
        ["all", "All"],
        ["todo", "To do"],
        ["moderation", "On moderation"],
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
      className={`cp-app${embedded ? " cp-in-telegram" : ""}${form || selected ? " cp-focused" : ""}`}
      onChange={() => {
        if (form || selectedTask) setDirty(true);
      }}
    >
      <a className="cp-skip" href="#workspace-content">
        Skip to content
      </a>
      <header className="cp-header">
        <span className="cp-brand">
          COLIZEUM <span>WORK</span>
        </span>
        <button
          className="cp-profile"
          aria-label={`Open more: ${user.name}`}
          onClick={() => {
            if (!dirty || window.confirm("Discard your unsaved changes?"))
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
            Saving…
          </p>
        )}
        <fieldset className="cp-workspace-controls" disabled={busy}>
          {form ? (
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
                    <h1>{isManager ? "Tasks" : "Current shift"}</h1>
                    {isManager ? (
                      <button
                        className="cp-button cp-button-primary"
                        disabled={!state.shift && user.role !== "superuser"}
                        onClick={() => setForm("create")}
                      >
                        <IconPlus size={18} />
                        Create task
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
                          isManager
                            ? "Active shift summary"
                            : "Current shift summary"
                        }
                      >
                        <div>
                          <span
                            className={`cp-live${ownsShift || isManager ? "" : " cp-live-waiting"}`}
                          >
                            <span className="cp-dot" />
                            {isManager
                              ? "Active shift"
                              : ownsShift
                                ? "On shift"
                                : "Shift in progress"}
                          </span>
                          <h2>
                            {state.shift.type === "day"
                              ? "Day shift"
                              : "Night shift"}
                            <span>from {time(state.shift.openedAt)}</span>
                          </h2>
                          <p>
                            {person(state.shift.adminId).name}
                            {!ownsShift &&
                              !isManager &&
                              " · Wait for this shift to close"}
                          </p>
                        </div>
                        {(ownsShift || isManager) && (
                          <div className="cp-cash">
                            <span>Cash register</span>
                            <strong>{money(state.balance)}</strong>
                          </div>
                        )}
                      </section>
                    ) : isManager ? (
                      <section
                        className="cp-shift-summary"
                        aria-label="Active shift summary"
                      >
                        <div>
                          <h2>No active shift</h2>
                          <p>Waiting for an administrator.</p>
                        </div>
                        <div className="cp-cash">
                          <span>Cash register</span>
                          <strong>{money(state.balance)}</strong>
                        </div>
                      </section>
                    ) : (
                      <section className="cp-open-shift">
                        <h2>Ready to start?</h2>
                        <p>The previous shift is closed.</p>
                        <button
                          className="cp-button cp-button-primary"
                          onClick={() => setForm("open")}
                        >
                          <IconDoorEnter size={18} />
                          Open shift
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
                          Add expense
                        </button>
                        <button
                          className="cp-button cp-button-secondary"
                          onClick={() => setForm("close")}
                        >
                          <IconDoorExit size={18} />
                          Close shift
                        </button>
                      </div>
                    )}
                  </>
                  {user.role === "superuser" && (
                    <p className="cp-list-hint">
                      Tasks for administrators and managers
                    </p>
                  )}
                  <section className="cp-checklist">
                    {user.role === "manager" && (
                      <div
                        className="cp-task-scope"
                        aria-label="Task ownership"
                      >
                        {[
                          ["mine", "My tasks"],
                          ["assigned", "Assigned by me"],
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
                          Tasks
                          <span>{activeTasks.length}</span>
                        </h2>
                      </div>
                    )}
                    <div className="cp-task-toolbar">
                      <div className="cp-tabs" aria-label="Filter tasks">
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
                        setSelectedTask(id);
                        setDirty(false);
                        window.scrollTo({ top: 0 });
                      }}
                    />
                    {moderationCount > 0 && (
                      <p className="cp-list-hint">
                        Tasks on moderation stay until accepted.
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
                    <h1>More</h1>
                  </div>
                  <div className="cp-account">
                    <div>
                      <strong>{user.name}</strong>
                      <p>
                        {user.role === "superuser"
                          ? "Superuser"
                          : isManager
                            ? "Manager"
                            : "Administrator"}
                      </p>
                    </div>
                  </div>
                  <div className="cp-menu" aria-label="More options">
                    {[
                      {
                        id: "history" as const,
                        label: "Shift history",
                        icon: IconHistory,
                      },
                      {
                        id: "expenses" as const,
                        label: "Expenses",
                        icon: IconWallet,
                      },
                      {
                        id: "notifications" as const,
                        label: "Notifications",
                        icon: IconBell,
                      },
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
                  <button className="cp-text-button" onClick={workspace.logout}>
                    Sign out
                  </button>
                </>
              )}
              {view === "expenses" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Back to more
                  </button>
                  <div className="cp-page-heading">
                    <h1>Expenses</h1>
                    {ownsShift && (
                      <button
                        className="cp-button cp-button-primary"
                        onClick={() => setForm("expense")}
                      >
                        <IconPlus size={18} />
                        Add expense
                      </button>
                    )}
                  </div>
                  <div className="cp-register-strip">
                    <span>Cash register</span>
                    <strong>{money(state.balance)}</strong>
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
                          <p>{time(expense.createdAt)} · Cash expense</p>
                          {expense.photo && (
                            <PrivateImage
                              className="cp-receipt"
                              src={expense.photo}
                              alt="Expense receipt"
                            />
                          )}
                        </details>
                      ))}
                    {!state.expenses.some(
                      (e) => isManager || e.adminId === user.id,
                    ) && (
                      <Empty
                        title="No expenses"
                        text="Cash expenses will appear here."
                      />
                    )}
                  </div>
                </>
              )}
              {view === "history" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Back to more
                  </button>
                  <div className="cp-page-heading">
                    <h1>Shift history</h1>
                  </div>
                  <div className="cp-tabs cp-history-tabs">
                    <button
                      className={historyTab === "shifts" ? "cp-tab-active" : ""}
                      onClick={() => setHistoryTab("shifts")}
                    >
                      Closed shifts
                    </button>
                    <button
                      className={historyTab === "tasks" ? "cp-tab-active" : ""}
                      onClick={() => setHistoryTab("tasks")}
                    >
                      Task history
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
                                  ? "Day shift"
                                  : "Night shift"}
                              </strong>
                              <small>
                                {person(shift.adminId).name} ·{" "}
                                {shift.legacy
                                  ? "Imported report"
                                  : `${time(shift.openedAt)} – ${shift.closedAt ? time(shift.closedAt) : "Open"}`}
                              </small>
                            </span>
                            <span className="cp-history-total">
                              <small>Total</small>
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
                              Cash<strong>{money(shift.cash || 0)}</strong>
                            </span>
                            <span>
                              Card<strong>{money(shift.cards || 0)}</strong>
                            </span>
                            <span>
                              SBP<strong>{money(shift.sbp || 0)}</strong>
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
                      title="No closed shifts"
                      text="Your shift reports will appear here."
                    />
                  )}
                </>
              )}
              {view === "notifications" && (
                <>
                  <button className="cp-back" onClick={back}>
                    <IconArrowLeft size={18} />
                    Back to more
                  </button>
                  <div className="cp-page-heading">
                    <h1>Notifications</h1>
                  </div>
                  <p className="cp-list-hint">
                    Task submissions notify the assigning manager in Telegram.
                  </p>
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
                      title="No notifications"
                      text="Task updates will appear here."
                    />
                  )}
                </>
              )}
            </>
          )}
        </fieldset>
      </main>
      {!form && !selected && (
        <nav className="cp-bottom-nav" aria-label="Main navigation">
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
            <span>{isManager ? "Tasks" : "Shift"}</span>
          </button>
          <button
            aria-current={view === "devices" ? "page" : undefined}
            className={view === "devices" ? "cp-nav-active" : ""}
            onClick={() => navigate("devices")}
          >
            <IconDeviceDesktop size={22} stroke={1.6} />
            <span>Devices</span>
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
            <span>More</span>
          </button>
        </nav>
      )}
      {toast && (
        <div className="cp-toast" role="status">
          <IconCheck size={19} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
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
          title="All clear here"
          text="Tasks matching this view will appear here when assigned."
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
                    High priority
                  </span>
                )}
                {task.requiresPhoto && (
                  <span>
                    <IconCamera size={13} />
                    Photo required
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
  const [photo, setPhoto] = useState(task.photo || "");
  const [photoName, setPhotoName] = useState(task.photoName || "");
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
        Back to tasks
      </button>
      <div className="cp-page-heading">
        <div>
          <h1>{task.title}</h1>
          <p>
            Assigned by {person(task.managerId).name} ·{" "}
            {dateLabel(task.createdAt)}
          </p>
        </div>
        <Status status={task.status} />
      </div>
      <div className="cp-detail-layout">
        <section className="cp-form-panel">
          <h2>Task details</h2>
          <p className="cp-description">{task.description}</p>
          {task.referencePhoto && (
            <figure className="cp-reference">
              <PrivateImage src={task.referencePhoto} alt="Task reference" />
              <figcaption>
                Reference photo from {person(task.managerId).name}
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
              {task.requiresPhoto
                ? "Completion photo required"
                : "Completion photo optional"}
            </span>
            {task.priority === "high" && (
              <span className="cp-priority">
                <IconFlag size={15} />
                High priority
              </span>
            )}
          </div>
          {task.status === "rejected" && (
            <div className="cp-rework">
              <IconMessageCircle size={20} />
              <div>
                <strong>Changes requested</strong>
                <p>{task.rejectionReason}</p>
              </div>
            </div>
          )}
          {task.status === "moderation" && (
            <div className="cp-review-notice">
              <IconClock size={21} />
              <div>
                <strong>On moderation</strong>
                <p>
                  {user.role === "admin"
                    ? `${person(task.managerId).name} will review your work. This task stays here until it’s accepted.`
                    : user.id === task.adminId
                      ? `${person(task.managerId).name} will review your work.`
                      : "Review the completion photo and note, then accept or request changes."}
                </p>
              </div>
            </div>
          )}
          {task.photo && !canSubmit && (
            <figure className="cp-reference">
              <PrivateImage src={task.photo} alt="Task completion evidence" />
              <figcaption>
                Completion photo{task.photoName ? ` · ${task.photoName}` : ""}
              </figcaption>
            </figure>
          )}
          {task.note && !canSubmit && (
            <div className="cp-completion-note">
              <h3>Completion note</h3>
              <p>{task.note}</p>
            </div>
          )}
          {canSubmit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (task.requiresPhoto && !photo) {
                  setError(
                    "Add the required completion photo before closing this task.",
                  );
                  return;
                }
                onSave(
                  {
                    type: "SUBMIT_TASK",
                    actorId: user.id,
                    taskId: task.id,
                    photo: photo || undefined,
                    photoName,
                    note,
                  },
                  `Task sent to ${person(task.managerId).name} for review.`,
                );
              }}
            >
              <h2 className="cp-form-section-title">Your completion</h2>
              <Upload
                label="Completion photo"
                required={task.requiresPhoto}
                value={photo}
                onError={setError}
                onChange={(url, name) => {
                  setPhoto(url);
                  setPhotoName(name);
                }}
              />
              <label className="cp-field">
                Completion note
                <span className="cp-field-optional">Optional</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything your manager should know?"
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
                  Back
                </button>
                <button className="cp-button cp-button-primary">
                  <IconCheck size={17} />
                  Close task
                </button>
              </div>
            </form>
          )}
          {canReview && (
            <div className="cp-review-actions">
              {rejecting && (
                <label className="cp-field">
                  What needs to change?
                  <textarea
                    autoFocus
                    rows={3}
                    value={reason}
                    maxLength={2000}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Give the administrator a clear reason…"
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
                      Cancel
                    </button>
                    <button
                      className="cp-button cp-button-danger"
                      onClick={() => {
                        if (!reason.trim()) {
                          setError(
                            "Add a reason so the administrator knows what to fix.",
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
                          "Task returned to the administrator for rework.",
                        );
                        setRejecting(false);
                      }}
                    >
                      <IconRefresh size={16} />
                      Return for rework
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="cp-button cp-button-secondary"
                      onClick={() => setRejecting(true)}
                    >
                      <IconX size={17} />
                      Reject task
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
                          "Task accepted. It is now saved in task history.",
                        )
                      }
                    >
                      <IconCheck size={17} />
                      Accept task
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
  const [photoRequired, setPhotoRequired] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState("");
  const assignees = people.filter((person) =>
    user.role === "superuser"
      ? person.role === "admin" || person.role === "manager"
      : person.role === "admin" && person.id === state.shift?.adminId,
  );
  const [adminId, setAdminId] = useState(assignees[0]?.id || "");
  const headings = {
    expense: "Add expense",
    close: "Close shift",
    open: "Open shift",
    create: "Create task",
  };
  const subtitles = {
    expense: "Amount and reason for the expense.",
    close: "Payment totals and closing photos.",
    open: "Choose your shift type.",
    create:
      user.role === "superuser"
        ? "Assign to an administrator or manager."
        : "Assign to the current administrator.",
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (kind === "open") {
      if (state.shift) {
        setError("Another shift is already open. Wait for it to close first.");
        return;
      }
      onSave(
        { type: "OPEN_SHIFT", actorId: user.id, shiftType },
        "Your shift is open. You’re ready to go.",
      );
    } else if (kind === "expense") {
      const amount = Number(cash);
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !/^\d+(\.\d{1,2})?$/.test(cash)
      ) {
        setError("Enter a positive amount with up to two decimal places.");
        return;
      }
      if (amount > state.balance) {
        setError(
          `The expense exceeds the available balance of ${money(state.balance)}.`,
        );
        return;
      }
      if (!description.trim()) {
        setError("Describe what this expense was for.");
        return;
      }
      if (user.role === "admin" && state.shift?.adminId !== user.id) {
        setError("Open your own shift before recording an expense.");
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
        `${money(amount)} expense recorded and deducted from the register.`,
      );
    } else if (kind === "close") {
      if (state.shift?.adminId !== user.id) {
        setError("Only the administrator who opened this shift can close it.");
        return;
      }
      if (
        [cash, cards, sbp].some((value) => !/^\d+(\.\d{1,2})?$/.test(value))
      ) {
        setError(
          "Enter a nonnegative amount for cash, card, and SBP. Use 0 if there were no payments.",
        );
        return;
      }
      if (requiredPhotoSlots.some((slot) => !photos[slot])) {
        setError(
          "Add a photo for each required field before closing your shift.",
        );
        return;
      }
      onSave(
        {
          type: "CLOSE_SHIFT",
          actorId: user.id,
          cash: Number(cash),
          cards: Number(cards),
          sbp: Number(sbp),
          photos,
        },
        "Shift closed. Your report is saved and the next administrator can open a shift.",
      );
    } else {
      if (!state.shift && user.role !== "superuser") {
        setError("A shift must be open before you can assign a task.");
        return;
      }
      if (!assignees.some((person) => person.id === adminId)) {
        setError("Choose an administrator or manager you can assign tasks to.");
        return;
      }
      if (!title.trim() || !description.trim()) {
        setError("Add a task title and clear instructions.");
        return;
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
            requiresPhoto: photoRequired,
            referencePhoto: photo || undefined,
          },
        },
        `Task assigned to ${person(adminId).name}.`,
      );
    }
  };
  return (
    <div className="cp-form-page">
      <button className="cp-back" onClick={onBack}>
        <IconArrowLeft size={17} />
        Back to workspace
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
              <h2>Shift details</h2>
              {kind === "close" ? (
                <>
                  <dl className="cp-closing-shift">
                    <dt>Shift type</dt>
                    <dd>
                      {state.shift
                        ? state.shift.type === "night"
                          ? "Night shift"
                          : "Day shift"
                        : "No active shift"}
                    </dd>
                  </dl>
                  <p className="cp-field-hint">
                    Set when the shift was opened.
                  </p>
                </>
              ) : (
                <fieldset className="cp-shift-choice">
                  <legend>Shift type</legend>
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
                          {type === "day" ? "Day shift" : "Night shift"}
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
                <span>Available in the register</span>
                <strong>{money(state.balance)}</strong>
              </div>
              <label className="cp-field">
                Expense amount <span className="cp-required">*</span>
                <span className="cp-input-money">
                  <input
                    aria-label="Expense amount"
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0.00"
                  />
                  <span>₽</span>
                </span>
              </label>
              <label className="cp-field">
                Description <span className="cp-required">*</span>
                <textarea
                  aria-label="Expense description"
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="For example, cleaning supplies for the club"
                />
              </label>
              <Upload
                label="Receipt photo"
                value={photo}
                onError={setError}
                onChange={setPhoto}
              />
              <p className="cp-field-hint">
                A photo is optional. A description is always required.
              </p>
              {Number(cash) > 0 && (
                <div className="cp-form-total">
                  <span>Register balance after expense</span>
                  <strong>{money(state.balance - Number(cash))}</strong>
                </div>
              )}
            </>
          )}
          {kind === "close" && (
            <>
              <h2 className="cp-form-section-title">Payment totals</h2>
              <p className="cp-field-hint">
                Enter the revenue collected during this shift.
              </p>
              <div className="cp-money-grid">
                {[
                  ["Cash", cash, setCash],
                  ["Card", cards, setCards],
                  ["SBP", sbp, setSbp],
                ].map(([label, value, setter]) => (
                  <label className="cp-field" key={label as string}>
                    {label as string}
                    <span className="cp-input-money">
                      <input
                        aria-label={`${label} total`}
                        inputMode="decimal"
                        value={value as string}
                        onChange={(e) =>
                          (setter as (value: string) => void)(e.target.value)
                        }
                        placeholder="0.00"
                      />
                      <span>₽</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="cp-form-total">
                <span>Total shift revenue</span>
                <strong>
                  {money(
                    (Number(cash) || 0) +
                      (Number(cards) || 0) +
                      (Number(sbp) || 0),
                  )}
                </strong>
              </div>
              <h2 className="cp-form-section-title">Closing photos</h2>
              <p className="cp-field-hint">Both photos are required.</p>
              {requiredPhotoSlots.map((slot) => (
                <Upload
                  key={slot}
                  label={slot}
                  required
                  value={photos[slot]}
                  onError={setError}
                  onChange={(url) =>
                    setPhotos((prev) => ({ ...prev, [slot]: url }))
                  }
                />
              ))}
              <Upload
                label="Additional photo"
                value={photos.Additional}
                onError={setError}
                onChange={(url) =>
                  setPhotos((prev) => ({ ...prev, Additional: url }))
                }
              />
              <div className="cp-form-note">
                <IconInfoCircle size={18} />
                <p>
                  Submitted tasks stay available for manager review after the
                  shift closes. Cash revenue is added to the register.
                </p>
              </div>
            </>
          )}
          {kind === "create" && (
            <>
              <h2>Task details</h2>
              <label className="cp-field">
                Task title <span className="cp-required">*</span>
                <input
                  aria-label="Task title"
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="For example, clean the gaming stations"
                />
              </label>
              <label className="cp-field">
                Instructions <span className="cp-required">*</span>
                <textarea
                  aria-label="Task instructions"
                  rows={4}
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what needs to be done and what a good result looks like…"
                />
              </label>
              <div className="cp-money-grid cp-two-columns">
                <label className="cp-field">
                  Assign to
                  <select
                    aria-label="Assign to"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                  >
                    {assignees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ·{" "}
                        {p.role === "admin" ? "Administrator" : "Manager"}
                        {p.id === state.shift?.adminId ? " · On shift" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cp-field">
                  Priority
                  <select
                    aria-label="Task priority"
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as typeof priority)
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High priority</option>
                    <option value="low">Low priority</option>
                  </select>
                </label>
              </div>
              <Upload
                label="Reference photo"
                value={photo}
                onError={setError}
                onChange={setPhoto}
              />
              <label className="cp-toggle-field">
                <span>
                  <strong>Require a completion photo</strong>
                  <small>
                    The assignee must attach a photo to close this task.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={photoRequired}
                  onChange={(e) => setPhotoRequired(e.target.checked)}
                />
                <span className="cp-toggle" />
              </label>
              <div className="cp-form-note">
                <IconLock size={17} />
                <p>
                  The assignee completes this task. You review the submission.
                </p>
              </div>
            </>
          )}
          {kind === "open" && (
            <div className="cp-form-note">
              <IconInfoCircle size={19} />
              <p>
                You’ll become the administrator for the current shift. The next
                administrator can open a shift after you close yours.
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
              Cancel
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
                ? "Record expense"
                : kind === "create"
                  ? "Assign task"
                  : headings[kind]}
              <IconArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
