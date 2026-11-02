import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconSchool,
  IconX,
} from "@tabler/icons-react";
import Workspace from "../pages/Workspace";
import type { User } from "../lib/types";
import type { Action } from "../lib/workspace";
import { initializeTelegram, inTelegram, telegram } from "../lib/telegram";
import { TrainingPhoto, TrainingRequest } from "./context";
import { trainingRequest } from "./services";
import type { request } from "../lib/api";
import {
  advance,
  applyTrainingAction,
  createSession,
  lessons,
  observeTraining,
  previous,
  readSession,
  samplePhoto,
  storageKey,
  trainingAdmin,
  trainingManager,
  trainingPeople,
  writeSession,
  type TutorialRole,
  type TutorialSession,
  type TutorialTrack,
  availableTracks,
  trackNames,
  tutorialVersion,
} from "./model";
import "./tutorial.css";

export function Tutorial({
  account,
  onExit,
  preview = false,
}: {
  account: User;
  onExit: () => void;
  preview?: boolean;
}) {
  const defaultRole: TutorialRole =
    (account.role || (account.is_staff ? "manager" : "admin")) === "admin"
      ? "admin"
      : "manager";
  const tracks = availableTracks(account);
  const [selectedRole, setRole] = useState<TutorialTrack>(defaultRole);
  const role = tracks.includes(selectedRole) ? selectedRole : defaultRole;
  const [savedSession, setSession] = useState<TutorialSession | null>(null);
  const session =
    savedSession?.version === tutorialVersion ? savedSession : null;
  const [storageFailed, setStorageFailed] = useState(false);
  const key = storageKey(account.id, role);
  const saved = readSession(key, role);
  const update = useCallback(
    (next: TutorialSession) => {
      if (!availableTracks(account).includes(next.role))
        throw new Error("Это обучение доступно только управляющим.");
      setSession(next);
      setStorageFailed(!writeSession(storageKey(account.id, next.role), next));
    },
    [account],
  );
  const current = useRef(session);
  current.current = session;
  const perform = useCallback(
    async (action: Action) => {
      if (current.current) {
        const next = applyTrainingAction(current.current, action);
        current.current = next;
        update(next);
      }
    },
    [update],
  );
  const observe = useCallback(
    (event: string) => {
      if (!current.current) return;
      const next = observeTraining(current.current, event);
      if (next !== current.current) {
        current.current = next;
        update(next);
      }
    },
    [update],
  );
  const done = session?.step === lessons[role].length;
  const localRequest: typeof request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      if (!current.current) throw new Error("Учебный сеанс завершён.");
      if (options.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      const result = trainingRequest(current.current, path, options);
      if (result.session !== current.current) {
        current.current = result.session;
        update(result.session);
      }
      return result.value as T;
    },
    [update],
  );
  useEffect(() => {
    document.documentElement.lang = "ru";
    const cleanup = initializeTelegram();
    return cleanup;
  }, []);
  useEffect(() => {
    const app = telegram();
    if ((session && !done) || !inTelegram() || !app?.isVersionAtLeast("6.1"))
      return;
    app.BackButton.show();
    app.BackButton.onClick(onExit);
    return () => {
      app.BackButton.offClick(onExit);
      app.BackButton.hide();
    };
  }, [session, done, onExit]);
  const leave = () => {
    setSession(null);
    window.scrollTo({ top: 0 });
  };

  if (!session || done)
    return (
      <div className="cp-app tutorial-home">
        <main className="cp-content">
          <button className="cp-back" onClick={onExit}>
            <IconArrowLeft size={18} />
            {preview ? "К выбору обучения" : "Вернуться в приложение"}
          </button>
          <IconSchool className="tutorial-home-icon" size={34} stroke={1.5} />
          <h1>{done ? "Обучение пройдено" : "Попробуйте рабочий день"}</h1>
          <p className="tutorial-intro">
            {done
              ? "Вы выполнили все упражнения. К любому из них можно вернуться."
              : "Знакомые экраны, учебная смена и понятные подсказки. Вы сами выполняете каждое действие."}
          </p>
          {tracks.length > 1 && !done && (
            <label className="cp-field tutorial-course-picker">
              Выберите обучение
              <select
                aria-label="Выберите обучение"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as TutorialTrack)
                }
              >
                {tracks.map((track) => (
                  <option key={track} value={track}>
                    {trackNames[track]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h2>{trackNames[role]}</h2>
          <p className="tutorial-duration">
            {lessons[role].length} упражнений · около{" "}
            {role === "admin" ? 5 : 10} минут
          </p>
          <ol className="tutorial-outline">
            {lessons[role].map((lesson, index) => (
              <li key={lesson.title}>
                <span>{index + 1}</span>
                <div>
                  {lesson.title}
                  {saved && index < saved.step && (
                    <IconCheck aria-label="Выполнено" size={17} />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="tutorial-safety">
            Все данные учебные. Смены и касса клуба не меняются, сообщения
            сотрудникам не отправляются. Прогресс сохраняется на этом
            устройстве.
          </p>
          <div className="tutorial-home-actions">
            <button
              className="cp-button cp-button-primary"
              onClick={() =>
                update(
                  saved && saved.step < lessons[role].length
                    ? saved
                    : createSession(role),
                )
              }
            >
              {saved && saved.step > 0 && saved.step < lessons[role].length
                ? `Продолжить с шага ${saved.step + 1}`
                : done || saved?.step === lessons[role].length
                  ? "Пройти ещё раз"
                  : "Начать обучение"}
              <IconArrowRight size={18} />
            </button>
            {saved && saved.step > 0 && saved.step < lessons[role].length && (
              <button
                className="cp-text-button"
                onClick={() => update(createSession(role))}
              >
                Начать заново
              </button>
            )}
            {done && (
              <button
                className="cp-button cp-button-secondary"
                onClick={() => {
                  setSession(null);
                  window.scrollTo({ top: 0 });
                }}
              >
                {" "}
                Выбрать другое обучение
              </button>
            )}
          </div>
        </main>
      </div>
    );

  const lesson = lessons[role][session.step];
  const section = lesson.section;
  const sectionView =
    section === "automatic-tasks" ||
    section === "schedule" ||
    section === "notifications"
      ? section
      : undefined;
  return (
    <TrainingRequest.Provider value={localRequest}>
      <TrainingPhoto.Provider value={`${samplePhoto}?exercise=${session.step}`}>
        <Workspace
          key={`${role}-${session.step}`}
          workspace={{
            state: session.state,
            user: role === "admin" ? trainingAdmin : trainingManager,
            people: trainingPeople,
            account,
            busy: false,
            error: "",
            perform,
            training: {
              target: lesson.target,
              onEvent: observe,
              onExit: leave,
              initialView: sectionView
                ? lesson.index === 0
                  ? "more"
                  : sectionView
                : undefined,
              allowedViews: sectionView ? [sectionView] : [],
              scheduleId:
                section === "schedule" && lesson.index > 0
                  ? "training-next"
                  : undefined,
              banner: (
                <div className="tutorial-banner">
                  <span>
                    <IconSchool size={18} />
                    Учебный режим
                  </span>
                  <button onClick={leave} aria-label="Выйти из обучения">
                    <IconX size={20} />
                  </button>
                </div>
              ),
              guide: (
                <Guide
                  session={session}
                  storageFailed={storageFailed}
                  onPrevious={() => update(previous(session))}
                  onNext={() => update(advance(session))}
                />
              ),
            },
          }}
        />
      </TrainingPhoto.Provider>
    </TrainingRequest.Provider>
  );
}

function Guide({
  session,
  storageFailed,
  onPrevious,
  onNext,
}: {
  session: TutorialSession;
  storageFailed: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia("(max-height: 700px)").matches,
  );
  const [editing, setEditing] = useState(false);
  const lesson = lessons[session.role][session.step];
  const total = lessons[session.role].length;
  useEffect(() => {
    let frame = 0;
    let restoreTimer: number | undefined;
    const viewport = window.visualViewport;
    const baseline = Math.max(window.innerHeight, viewport?.height || 0);
    const sync = () => {
      const active = document.activeElement;
      const focused =
        active instanceof HTMLElement &&
        Boolean(
          active.closest(
            '.cp-training input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), .cp-training textarea, .cp-training select, .cp-training [contenteditable="true"]',
          ),
        );
      const compact =
        focused || baseline - (viewport?.height || window.innerHeight) > 120;
      cancelAnimationFrame(frame);
      if (compact) {
        window.clearTimeout(restoreTimer);
        restoreTimer = undefined;
        setEditing(true);
      } else if (restoreTimer === undefined) {
        // Let the tap that blurs the field finish before moving the form controls.
        restoreTimer = window.setTimeout(() => {
          setEditing(false);
          restoreTimer = undefined;
        }, 200);
      }
      const app = ref.current?.closest<HTMLElement>(".cp-app");
      app?.style.setProperty(
        "--tutorial-visible-top",
        `${viewport?.offsetTop || 0}px`,
      );
      if (focused) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          active?.scrollIntoView({ block: "nearest", behavior: "instant" }),
        );
      }
    };
    const deferred = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", deferred);
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(restoreTimer);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", deferred);
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  useEffect(() => {
    const element = ref.current!;
    const app = element.closest<HTMLElement>(".cp-app")!;
    const resize = () =>
      app.style.setProperty(
        "--tutorial-guide-height",
        `${element.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    title.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    return () => observer.disconnect();
  }, []);
  return (
    <aside
      className="tutorial-guide"
      aria-label="Подсказка обучения"
      data-editing={editing}
      ref={ref}
    >
      <div className="tutorial-guide-top">
        <span>
          Шаг {session.step + 1} из {total}
        </span>
        <button
          className="cp-text-button"
          onClick={() => setCollapsed(editing ? false : !collapsed)}
          aria-expanded={!collapsed && !editing}
        >
          {collapsed || editing ? "Показать подсказку" : "Свернуть"}
        </button>
      </div>
      <progress
        max={total}
        value={session.step + Number(session.ready)}
        aria-label="Прогресс обучения"
      />
      <h2 tabIndex={-1} ref={title}>
        {lesson.title}
      </h2>
      {!collapsed && (
        <p aria-live="polite">
          {session.ready ? lesson.success : lesson.instruction}
        </p>
      )}
      {storageFailed && (
        <p role="status">
          Не удалось сохранить прогресс на устройстве. Можно продолжить обучение
          в этом окне.
        </p>
      )}
      <div className="tutorial-guide-actions">
        <button
          className="cp-button cp-button-secondary"
          disabled={session.step === 0}
          onClick={onPrevious}
        >
          <IconArrowLeft size={16} />
          Назад
        </button>
        <button
          className="cp-button cp-button-primary"
          disabled={!session.ready}
          onClick={onNext}
        >
          {session.step === total - 1
            ? "Завершить"
            : session.role === "manager" && session.step === 0
              ? "Смена проверена"
              : session.role === "manager" && session.step === 2
                ? "Результат просмотрен"
                : "Далее"}
          <IconArrowRight size={16} />
        </button>
      </div>
    </aside>
  );
}

export function TutorialInvite({
  userId,
  role,
  onStart,
  busy = false,
}: {
  userId: number;
  role: TutorialRole;
  onStart: () => void;
  busy?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  let dismissed = false;
  const inviteKey = `${storageKey(userId, role)}:invite`;
  try {
    dismissed = localStorage.getItem(inviteKey) === "dismissed";
  } catch {
    /* Storage is optional. */
  }
  if (hidden || dismissed) return null;
  return (
    <section className="tutorial-invite" aria-label="Знакомство с приложением">
      <h2>{trackNames[role]}</h2>
      <p>
        Попробуйте рабочие действия на учебных данных. Около{" "}
        {role === "admin" ? 5 : 10} минут.
      </p>
      <div>
        <button className="cp-text-button" onClick={onStart} disabled={busy}>
          Начать обучение <IconArrowRight size={16} />
        </button>
        <button
          className="cp-text-button"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(inviteKey, "dismissed");
            } catch {
              /* Still dismiss for this visit. */
            }
          }}
        >
          Позже
        </button>
      </div>
    </section>
  );
}

/** Development-only entry; it never mounts authentication or the live workspace. */
export function TutorialPreview({ role }: { role: TutorialRole }) {
  const [generation, setGeneration] = useState(0);
  const account: User = {
    id: 0,
    username: "tutorial-preview",
    first_name: "",
    last_name: "",
    phone_number: null,
    last_login: null,
    is_active: true,
    is_staff: role === "manager",
    role,
  };
  return (
    <Tutorial
      key={generation}
      account={account}
      preview
      onExit={() => setGeneration(generation + 1)}
    />
  );
}
