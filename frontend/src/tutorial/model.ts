import {
  blockingShiftTasks,
  defaultReportPhotoFields,
  photoEvidenceError,
  type Action,
  type StaffMember,
  type State,
  type Shift,
  type PhotoRequirement,
  type Task,
} from "../lib/workspace";
import type { User } from "../lib/types";
import { createTrainingData, type TrainingData } from "./services";

export type TutorialRole = "admin" | "manager";
export type TutorialTrack = TutorialRole;
export const tutorialVersion = 3;
export const trackNames: Record<TutorialTrack, string> = {
  admin: "Ваша первая смена",
  manager: "Работа управляющего",
};
export function availableTracks(account: User): TutorialTrack[] {
  const management = account.role
    ? account.role !== "admin"
    : account.is_staff || account.is_superuser;
  return management ? ["admin", "manager"] : ["admin"];
}
export const samplePhoto = "/tutorial/workstation.png";
export const trainingAdmin: StaffMember = {
  id: "training-admin",
  name: "Алексей Смирнов",
  initials: "АС",
  role: "admin",
};
export const trainingManager: StaffMember = {
  id: "training-manager",
  name: "Мария Волкова",
  initials: "МВ",
  role: "manager",
};
export const trainingPeople = [
  trainingAdmin,
  trainingManager,
  {
    id: "training-owner",
    name: "Руководитель",
    initials: "Р",
    role: "superuser" as const,
  },
];

export type TutorialSection =
  TutorialRole | "automatic-tasks" | "schedule" | "notifications";
export interface Lesson {
  title: string;
  instruction: string;
  success: string;
  target: string;
  section: TutorialSection;
  index: number;
}
const lessonGroups: Record<
  TutorialSection,
  Omit<Lesson, "section" | "index">[]
> = {
  admin: [
    {
      title: "Откройте смену",
      instruction:
        "Нажмите «Открыть смену», выберите тип смены и проверьте дату по графику.",
      success:
        "Смена открыта, появились обязательные задачи. После полуночи дата ночной смены по графику может относиться к предыдущему дню.",
      target: "open",
    },
    {
      title: "Отправьте задачу на проверку",
      instruction:
        "Откройте «Подготовить игровые места», добавьте учебное фото и нажмите «Закрыть задачу».",
      success:
        "Статус «На проверке» означает, что результат отправлен. Задача останется в списке до принятия управляющим.",
      target: "tasks",
    },
    {
      title: "Исправьте результат",
      instruction:
        "Учебный управляющий вернул задачу. Откройте её, прочитайте причину, замените фото и добавьте комментарий об исправлении. Отправьте задачу ещё раз.",
      success:
        "Исправление отправлено на проверку. Управляющий увидит новую отправку.",
      target: "tasks",
    },
    {
      title: "Учтите расход",
      instruction:
        "Добавьте расход: 300 ₽ на средства для уборки. Укажите описание. Фотография чека необязательна.",
      success:
        "Из учебной кассы списано 300 ₽. Расход сохранён отдельно от выручки.",
      target: "expense",
    },
    {
      title: "Отметьте приход уборщицы",
      instruction:
        "Когда уборщица пришла, нажмите «Уборщица» и подтвердите приход. Отметить его можно один раз за свою смену.",
      success:
        "Время прихода сохранено. В рабочем режиме управляющие получат уведомление, а запись появится в истории уборщицы.",
      target: "cleaner",
    },
    {
      title: "Закройте смену",
      instruction:
        "Введите выручку: наличные — 1 000 ₽, карта — 2 000 ₽, СБП — 500 ₽. Добавьте учебные фото и закройте смену. Обязательные задачи достаточно отправить на проверку.",
      success:
        "Отчёт на 3 500 ₽ сохранён. В кассу добавлены только 1 000 ₽ наличными.",
      target: "close",
    },
    {
      title: "Найдите сохранённый отчёт",
      instruction:
        "Перейдите в «Ещё → История смен/задач» и раскройте свою смену. Проверьте разбивку выручки и фотографии.",
      success: "Вы прошли полный цикл смены: задачи, расход и отчёт.",
      target: "more",
    },
  ],
  manager: [
    {
      title: "Проверьте текущую смену",
      instruction:
        "В блоке активной смены найдите администратора и наличные в кассе. В учебном примере работает Алексей, остаток — 5 000 ₽.",
      success: "Здесь можно следить за сменой и остатком наличных.",
      target: "summary",
    },
    {
      title: "Назначьте задачу",
      instruction:
        "Создайте задачу «Подготовить игровые места» для Алексея. Напишите понятные инструкции и выберите одно обязательное фото. Назначать задачи можно и вне открытой смены.",
      success:
        "Задача назначена. На следующем шаге появится учебная отправка администратора.",
      target: "create",
    },
    {
      title: "Проверьте отправку",
      instruction:
        "В «Задачи команды» откройте задачу. Посмотрите фото и комментарий администратора, затем нажмите «Результат просмотрен» внизу.",
      success: "Перед решением проверьте и фото, и комментарий исполнителя.",
      target: "tasks",
    },
    {
      title: "Верните на доработку",
      instruction:
        "Нажмите «Отклонить задачу» и объясните, что исправить: например, «Протрите коврик и приложите новое фото».",
      success:
        "Причина возврата сохранена. На следующем шаге администратор пришлёт исправленный результат.",
      target: "review",
    },
    {
      title: "Примите исправление",
      instruction:
        "Откройте повторную отправку, проверьте фото и комментарий. Нажмите «Принять задачу».",
      success:
        "Задача принята и доступна во вкладке «История» раздела «Задачи команды».",
      target: "review",
    },
    {
      title: "Найдите свои задачи",
      instruction:
        "Переключитесь на «Мои задачи» и откройте «Проверить расходные материалы». Здесь находятся задания, которые руководитель назначил лично вам. Их можно выполнять без открытой смены.",
      success:
        "Теперь вы различаете личные задачи и задачи, поставленные сотрудникам.",
      target: "scope",
    },
  ],
  "automatic-tasks": [
    {
      title: "Создайте автоматическую задачу",
      instruction:
        "В «Ещё → Автоматические задачи» создайте задачу «Проверить зал». Заполните инструкции, выберите дневную смену и одно обязательное фото.",
      success:
        "Шаблон включён. При открытии следующей дневной смены он создаст обязательную задачу. Для закрытия смены достаточно отправить её на проверку.",
      target: "more",
    },
    {
      title: "Приостановите автосоздание",
      instruction:
        "Выключите «Создавать автоматически» у учебной задачи. Это прекращает выдачу новых задач, уже выданные сохраняются.",
      success:
        "Автосоздание выключено. Текущие задачи сотрудников и их история сохранены.",
      target: "automatic-tasks",
    },
    {
      title: "Возобновите автосоздание",
      instruction:
        "Снова включите «Создавать автоматически». Изменения шаблона и его настроек применяются к следующим сменам.",
      success:
        "Автосоздание включено. Теперь вы умеете создавать и приостанавливать обязательные задачи смены.",
      target: "automatic-tasks",
    },
  ],
  schedule: [
    {
      title: "Назначьте смену вручную",
      instruction:
        "В «Ещё → График смен» откройте «Следующий», нажмите «Редактировать график», выберите администратора, нажмите дневную ячейку и сохраните график.",
      success:
        "Ручное назначение сохранено как версия №2. План и фактически отработанные смены учитываются отдельно.",
      target: "more",
    },
    {
      title: "Заполните график 2/2",
      instruction:
        "Редактируйте следующий график, раскройте «Автозаполнение 2/2». Оставьте четырёх сотрудников, нажмите «Заполнить 2/2», проверьте черновик и сохраните его.",
      success:
        "Создана версия №3. Автозаполнение сначала готовит черновик: без сохранения график не меняется.",
      target: "schedule",
    },
    {
      title: "Восстановите предыдущую версию",
      instruction:
        "В «Версии графика» выберите №2 и нажмите «Восстановить эту версию». Подтвердите восстановление. Фактически отработанные смены при этом сохраняются.",
      success:
        "Версия №2 восстановлена как новая версия №4. История назначений сохранена. Отправить график себе можно кнопкой Telegram в рабочем режиме.",
      target: "schedule",
    },
  ],
  notifications: [
    {
      title: "Выключите уведомление",
      instruction:
        "В «Ещё → Уведомления» выключите «Расходы из кассы» и нажмите «Сохранить настройки». Это отключает только сообщения бота в ваш личный чат. События остаются в приложении.",
      success:
        "Учебная настройка сохранена. Сообщения о расходах выключены. Настоящие настройки вашего аккаунта не изменились.",
      target: "more",
    },
    {
      title: "Включите уведомление снова",
      instruction:
        "Включите «Расходы из кассы» и сохраните настройки. После включения бот сообщает о новых событиях; пропущенные сообщения задним числом не отправляются.",
      success:
        "Уведомления о расходах снова включены. Вы прошли весь цикл работы управляющего: задачи, автозадачи, график и личные уведомления.",
      target: "notifications",
    },
  ],
};

function sectionLessons(section: TutorialSection): Lesson[] {
  return lessonGroups[section].map((lesson, index) => ({
    ...lesson,
    section,
    index,
  }));
}
export const lessons: Record<TutorialTrack, Lesson[]> = {
  admin: sectionLessons("admin"),
  manager: [
    ...sectionLessons("manager"),
    ...sectionLessons("automatic-tasks"),
    ...sectionLessons("schedule"),
    ...sectionLessons("notifications"),
  ],
};

export interface TutorialSession {
  version: number;
  role: TutorialTrack;
  step: number;
  ready: boolean;
  state: State;
  data: TrainingData;
  // Checkpoints make Back restore the exercise before its action, including after reload.
  checkpoints: { state: State; data: TrainingData }[];
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "training-task",
    title: "Подготовить игровые места",
    description:
      "Протрите столы и коврики, проверьте клавиатуры и наушники. Приложите фото подготовленного места.",
    adminId: trainingAdmin.id,
    managerId: trainingManager.id,
    priority: "normal",
    requiresPhoto: true,
    photoMode: "single",
    status: "active",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createSession(role: TutorialTrack): TutorialSession {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const state: State = {
    shiftOpening: { today, nightDate: today },
    photoSettings: { reportFields: defaultReportPhotoFields, version: 1 },
    shift:
      role === "admin"
        ? null
        : {
            id: "training-shift",
            adminId: trainingAdmin.id,
            type: "day",
            openedAt: now.toISOString(),
            scheduleDate: today,
            photoRequirements: defaultReportPhotoFields,
          },
    shifts: [],
    tasks:
      role === "manager"
        ? [
            task({
              id: "training-personal",
              title: "Проверить расходные материалы",
              description:
                "Проверьте запас чековой ленты и средств для уборки.",
              managerId: "training-owner",
              adminId: trainingManager.id,
              requiresPhoto: false,
              photoMode: "optional",
            }),
          ]
        : [],
    expenses: [],
    activity: [],
    balance: 5000,
  };
  const data = createTrainingData(today);
  return {
    version: tutorialVersion,
    role,
    step: 0,
    ready: role === "manager",
    state,
    data,
    checkpoints: [structuredClone({ state, data })],
  };
}

export function advance(session: TutorialSession): TutorialSession {
  if (!session.ready || session.step >= lessons[session.role].length)
    return session;
  const next = structuredClone(session);
  next.step++;
  next.ready = false;
  if (next.role === "admin" && next.step === 2) {
    Object.assign(next.state.tasks[0], {
      status: "rejected",
      rejectionReason:
        "Протрите коврик и приложите новое фото. Добавьте комментарий об исправлении.",
    });
  }
  if (next.role === "manager" && (next.step === 2 || next.step === 4)) {
    const assigned = next.state.tasks.find((t) => t.id === "training-task")!;
    Object.assign(assigned, {
      status: "moderation",
      photos: [{ url: samplePhoto, slot: "", label: "Фото выполнения" }],
      note:
        next.step === 2
          ? "Места подготовлены. Посмотрите, пожалуйста."
          : "Коврик протёрт, фотография обновлена.",
      submittedAt: new Date().toISOString(),
      submissionVersion: next.step === 2 ? 1 : 2,
    });
  }
  next.checkpoints[next.step] = structuredClone({
    state: next.state,
    data: next.data,
  });
  return next;
}

export function previous(session: TutorialSession): TutorialSession {
  if (session.step === 0) return session;
  const step = session.step - 1;
  return {
    ...session,
    step,
    ready: session.role === "manager" && step === 0,
    state: structuredClone(session.checkpoints[step].state),
    data: structuredClone(session.checkpoints[step].data),
    checkpoints: session.checkpoints.slice(0, step + 1),
  };
}

/** Only the command belonging to the current exercise can change training state. */
export function applyTrainingAction(
  session: TutorialSession,
  action: Action,
): TutorialSession {
  if (
    !["admin", "manager"].includes(lessons[session.role][session.step]?.section)
  )
    throw new Error("Выполните действие из подсказки текущего обучения.");
  const expected =
    session.role === "admin"
      ? [
          "OPEN_SHIFT",
          "SUBMIT_TASK",
          "SUBMIT_TASK",
          "ADD_EXPENSE",
          "MARK_CLEANER",
          "CLOSE_SHIFT",
        ]
      : [null, "CREATE_TASK", null, "REVIEW_TASK", "REVIEW_TASK"];
  if (session.ready || action.type !== expected[session.step])
    throw new Error(
      "Сейчас выполните действие из подсказки обучения. Остальные действия можно попробовать после выхода.",
    );
  const actor =
    session.role === "admin" ? trainingAdmin.id : trainingManager.id;
  if (action.actorId !== actor)
    throw new Error("Недоступное действие в учебном режиме.");
  const next = structuredClone(session);
  const state = next.state;
  const now = new Date().toISOString();
  switch (action.type) {
    case "MARK_CLEANER":
      if (
        !state.shift ||
        state.shift.id !== action.shiftId ||
        state.shift.cleanerVisitedAt
      )
        throw new Error("Приход уже отмечен или смена закрыта.");
      state.shift.cleanerVisitedAt = now;
      break;
    case "OPEN_SHIFT":
      state.shift = {
        id: "training-shift",
        adminId: actor,
        type: action.shiftType,
        openedAt: now,
        scheduleDate: action.scheduleDate || state.shiftOpening?.today,
        photoRequirements: defaultReportPhotoFields,
      };
      state.tasks = [
        task({
          automatic: true,
          requiredForShiftId: state.shift.id,
          shiftId: state.shift.id,
        }),
      ];
      break;
    case "SUBMIT_TASK": {
      const target = state.tasks.find((t) => t.id === action.taskId);
      if (!target || !["active", "rejected"].includes(target.status))
        throw new Error("Откройте учебную задачу.");
      const error = photoEvidenceError("single", [], action.photos || []);
      if (error) throw new Error(error);
      if (session.step === 2 && !action.note?.trim())
        throw new Error("Добавьте комментарий о том, что исправили.");
      if (
        session.step === 2 &&
        action.photos?.[0]?.url === target.photos?.[0]?.url
      )
        throw new Error(
          "Замените учебное фото, чтобы показать исправленный результат.",
        );
      Object.assign(target, {
        status: "moderation",
        photos: action.photos,
        note: action.note,
        submittedAt: now,
      });
      break;
    }
    case "ADD_EXPENSE":
      if (action.amount !== 300 || !action.description.trim())
        throw new Error(
          "Для упражнения укажите расход 300 ₽ и описание покупки.",
        );
      state.balance = Math.round((state.balance - action.amount) * 100) / 100;
      state.expenses.push({
        id: "training-expense",
        adminId: actor,
        shiftId: state.shift?.id,
        amount: action.amount,
        description: action.description,
        createdAt: now,
      });
      break;
    case "CLOSE_SHIFT":
      if (!state.shift || blockingShiftTasks(state).length)
        throw new Error("Сначала отправьте обязательные задачи на проверку.");
      if (action.cash !== 1000 || action.cards !== 2000 || action.sbp !== 500)
        throw new Error(
          "Введите учебную выручку: наличные 1 000 ₽, карта 2 000 ₽, СБП 500 ₽.",
        );
      {
        const error = photoEvidenceError(
          "named",
          defaultReportPhotoFields,
          action.photos,
        );
        if (error) throw new Error(error);
      }
      state.shifts.push({
        ...state.shift,
        closedAt: now,
        cash: action.cash,
        cards: action.cards,
        sbp: action.sbp,
        photos: Object.fromEntries(action.photos.map((p) => [p.label, p.url])),
      });
      state.balance += action.cash;
      state.shift = null;
      break;
    case "CREATE_TASK":
      if (
        action.task.adminId !== trainingAdmin.id ||
        action.task.photoMode !== "single" ||
        !action.task.title.trim() ||
        !action.task.description.trim()
      )
        throw new Error(
          "Выберите Алексея, заполните название и инструкции и укажите одно обязательное фото.",
        );
      state.tasks.push(task({ ...action.task, id: "training-task" }));
      break;
    case "REVIEW_TASK": {
      const target = state.tasks.find((t) => t.id === action.taskId);
      if (
        !target ||
        target.id !== "training-task" ||
        target.status !== "moderation"
      )
        throw new Error("Откройте учебную отправку администратора.");
      if (action.accept !== (session.step === 4))
        throw new Error(
          session.step === 3
            ? "В этом упражнении верните задачу на доработку с объяснением."
            : "В этом упражнении примите исправленный результат.",
        );
      if (!action.accept && !action.reason?.trim())
        throw new Error("Объясните, что нужно исправить.");
      Object.assign(target, {
        status: action.accept ? "accepted" : "rejected",
        rejectionReason: action.reason,
        acceptedAt: action.accept ? now : undefined,
      });
      break;
    }
    default:
      throw new Error("Это действие не входит в обучение.");
  }
  next.ready = true;
  return next;
}

export function observeTraining(
  session: TutorialSession,
  event: string,
): TutorialSession {
  const complete =
    (session.role === "admin" &&
      session.step === 6 &&
      event === "report-opened") ||
    (session.role === "manager" &&
      session.step === 2 &&
      event === "task-opened:training-task") ||
    (session.role === "manager" &&
      session.step === 5 &&
      event === "task-opened:training-personal");
  return complete && !session.ready ? { ...session, ready: true } : session;
}

export function storageKey(userId: number | string, role: TutorialTrack) {
  return `colizeum:tutorial:${tutorialVersion}:${userId}:${role}`;
}

function validFields(fields: PhotoRequirement[]): boolean {
  return (
    Array.isArray(fields) &&
    fields.every(
      (field) =>
        typeof field?.id === "string" &&
        typeof field.label === "string" &&
        typeof field.required === "boolean",
    )
  );
}

function validPhoto(url: string): boolean {
  return (
    typeof url === "string" &&
    (url === samplePhoto ||
      /^\/tutorial\/workstation\.png\?exercise=\d+$/.test(url))
  );
}

function validShift(shift: Shift): boolean {
  return (
    shift?.id === "training-shift" &&
    shift.adminId === trainingAdmin.id &&
    ["day", "night"].includes(shift.type) &&
    Number.isFinite(Date.parse(shift.openedAt)) &&
    (!shift.photoRequirements || validFields(shift.photoRequirements)) &&
    (!shift.photos || Object.values(shift.photos).every(validPhoto))
  );
}

/** Treat a stale or partially written local save as a new tutorial. */
function validState(state: State): boolean {
  return Boolean(
    state &&
    Number.isFinite(state.balance) &&
    state.balance >= 0 &&
    (state.shift === null || validShift(state.shift)) &&
    Array.isArray(state.shifts) &&
    state.shifts.every(validShift) &&
    Array.isArray(state.expenses) &&
    state.expenses.every(
      (expense) =>
        expense?.id === "training-expense" &&
        typeof expense.description === "string" &&
        Number.isFinite(expense.amount) &&
        Number.isFinite(Date.parse(expense.createdAt)),
    ) &&
    Array.isArray(state.activity) &&
    state.activity.length === 0 &&
    (!state.photoSettings || validFields(state.photoSettings.reportFields)) &&
    Array.isArray(state.tasks) &&
    state.tasks.every(
      (task) =>
        ["training-task", "training-personal"].includes(task?.id) &&
        typeof task.title === "string" &&
        typeof task.description === "string" &&
        ["active", "moderation", "accepted", "rejected"].includes(
          task.status,
        ) &&
        ["optional", "single", "multiple", "named"].includes(
          task.photoMode || "optional",
        ) &&
        Number.isFinite(Date.parse(task.createdAt)) &&
        (!task.photoRequirements || validFields(task.photoRequirements)) &&
        (!task.referencePhoto || validPhoto(task.referencePhoto)) &&
        (!task.photo || validPhoto(task.photo)) &&
        (!task.photos ||
          (Array.isArray(task.photos) &&
            task.photos.every(
              (photo) =>
                validPhoto(photo.url) &&
                typeof photo.slot === "string" &&
                typeof photo.label === "string",
            ))),
    ),
  );
}

export function readSession(
  key: string,
  role: TutorialTrack,
): TutorialSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value?.version !== tutorialVersion ||
      value.role !== role ||
      !Number.isInteger(value.step) ||
      value.step < 0 ||
      value.step > lessons[role].length ||
      typeof value.ready !== "boolean" ||
      !Array.isArray(value.checkpoints) ||
      value.checkpoints.length !== value.step + 1 ||
      !value.checkpoints.every(
        (checkpoint: { state: State; data: TrainingData }) =>
          validState(checkpoint.state) && validData(checkpoint.data),
      ) ||
      !validData(value.data) ||
      !validState(value.state)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
function validData(data: TrainingData): boolean {
  return Boolean(
    data &&
    data.notifications &&
    [
      "task_assigned",
      "task",
      "shift_open",
      "shift_close",
      "expense",
      "cleaner",
      "schedule",
    ].every(
      (kind) =>
        typeof data.notifications[kind as keyof typeof data.notifications] ===
        "boolean",
    ) &&
    Array.isArray(data.templates) &&
    data.templates.every(
      (t) =>
        t.id === "training-template" &&
        typeof t.title === "string" &&
        typeof t.description === "string" &&
        typeof t.enabled === "boolean" &&
        validFields(t.photoRequirements),
    ) &&
    Array.isArray(data.periods) &&
    data.periods.length === 2 &&
    data.periods.every(
      (p) => typeof p.id === "string" && p.plan && Array.isArray(p.revisions),
    ) &&
    data.plans &&
    typeof data.plans === "object",
  );
}
export function writeSession(key: string, session: TutorialSession): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
