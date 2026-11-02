import type { Template } from "../components/AutomaticTasksPage";
import type { Detail, Overview, Plan } from "../components/SchedulePage";
import type { StaffMember } from "../lib/workspace";
import type { TutorialSession } from "./model";
import {
  currentLesson,
  trainingManager,
  trainingReviewerChoices,
} from "./model";
import type { Preferences } from "../components/NotificationSettings";

export const scheduleAdmins: StaffMember[] = [
  { id: "11", name: "Алексей Смирнов", initials: "АС", role: "admin" },
  { id: "12", name: "Ирина Орлова", initials: "ИО", role: "admin" },
  { id: "13", name: "Дмитрий Соколов", initials: "ДС", role: "admin" },
  { id: "14", name: "Анна Миронова", initials: "АМ", role: "admin" },
];
export interface TrainingData {
  templates: Template[];
  periods: Detail[];
  plans: Record<string, Record<number, Plan>>;
  notifications: Preferences;
}
export function createTrainingData(today: string): TrainingData {
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day <= 15 ? 1 : 16));
  const dates = [
    start,
    new Date(
      Date.UTC(year, month - 1 + (day <= 15 ? 0 : 1), day <= 15 ? 16 : 1),
    ),
  ];
  const periods = dates.map((date, index): Detail => {
    const first = date.toISOString().slice(0, 10);
    const lastDay =
      date.getUTCDate() === 1
        ? 15
        : new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
          ).getUTCDate();
    const plan: Plan = {};
    for (let d = date.getUTCDate(); d <= lastDay; d++) {
      const key = `${first.slice(0, 8)}${String(d).padStart(2, "0")}`;
      plan[`${key}/day`] = null;
      plan[`${key}/night`] = null;
    }
    return {
      id: index ? "training-next" : "training-current",
      start: first,
      end: `${first.slice(0, 8)}${lastDay}`,
      editable: true,
      sendAt: new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), lastDay + 2),
      ).toISOString(),
      image: null,
      version: 1,
      viewVersion: 1,
      canEdit: true,
      plan,
      actual: {},
      unavailable: [],
      revisions: [
        {
          number: 1,
          source: "initial",
          createdAt: new Date().toISOString(),
          author: "Учебный управляющий",
          restoredFrom: null,
        },
      ],
    };
  });
  return {
    templates: [],
    periods,
    plans: Object.fromEntries(
      periods.map((p) => [p.id, { 1: structuredClone(p.plan) }]),
    ),
    notifications: {
      task_assigned: true,
      task: true,
      shift_open: true,
      shift_close: true,
      expense: true,
      cleaner: true,
      schedule: true,
    },
  };
}

/** Local adapter for the existing forms. Every unsupported operation fails closed. */
export function trainingRequest(
  session: TutorialSession,
  path: string,
  options: RequestInit = {},
): { session: TutorialSession; value: unknown } {
  const method = options.method || "GET";
  const url = new URL(path, "https://training.invalid/");
  const parts = url.pathname.split("/").filter(Boolean);
  const next = structuredClone(session);
  const data = next.data;
  const lesson = currentLesson(session);
  const section = lesson?.section;
  const step = lesson?.index;
  let value: unknown;
  if (
    method === "GET" &&
    section === "automatic-tasks" &&
    session.managementRole === "superuser" &&
    path === "automatic-tasks/reviewers/"
  )
    return {
      session,
      value: trainingReviewerChoices(session.managementRole === "superuser"),
    };
  if (
    method === "GET" &&
    section === "automatic-tasks" &&
    path === "automatic-tasks/"
  )
    return { session, value: structuredClone(data.templates) };
  if (method === "GET" && section === "schedule" && parts[0] === "schedules") {
    if (!parts[1]) {
      const overview: Overview = {
        current: data.periods[0],
        future: data.periods[1],
        archive: [],
        admins: scheduleAdmins,
        settings: {
          defaultAdminId: null,
          version: 1,
          manualContent: "both",
          automaticContent: "both",
        },
      };
      return { session, value: overview };
    }
    const period = data.periods.find((p) => p.id === parts[1]);
    const revision = url.searchParams.get("revision");
    if (period && !parts[2])
      return {
        session,
        value: {
          ...period,
          ...(revision
            ? {
                plan: data.plans[period.id][Number(revision)],
                viewVersion: Number(revision),
              }
            : {}),
        },
      };
  }
  if (
    section === "notifications" &&
    method === "GET" &&
    path === "notification-settings/"
  )
    return { session, value: structuredClone(data.notifications) };
  if (session.ready)
    throw new Error("Упражнение выполнено. Нажмите «Далее» в подсказке.");
  if (
    section === "notifications" &&
    method === "PATCH" &&
    path === "notification-settings/"
  ) {
    const patch = JSON.parse(String(options.body));
    if (
      !patch ||
      Object.keys(patch).length !== 1 ||
      patch.expense !== (step === 1)
    )
      throw new Error(
        step === 0
          ? "Выключите «Расходы из кассы» и сохраните настройки."
          : "Снова включите «Расходы из кассы» и сохраните настройки.",
      );
    data.notifications.expense = patch.expense;
    next.ready = true;
    return { session: next, value: structuredClone(data.notifications) };
  }
  if (section === "automatic-tasks" && parts[0] === "automatic-tasks") {
    if (
      method === "POST" &&
      step === 0 &&
      !parts[1] &&
      options.body instanceof FormData
    ) {
      const body = options.body;
      const title = String(body.get("title") || "").trim();
      const description = String(body.get("description") || "").trim();
      if (
        !title ||
        !description ||
        body.get("shift_type") !== "day" ||
        body.get("photo_mode") !== "single"
      )
        throw new Error(
          "Заполните название и инструкции, выберите дневную смену и одно обязательное фото.",
        );
      const template: Template = {
        id: "training-template",
        title,
        description,
        shiftType: "day",
        enabled: true,
        priority: "normal",
        photoMode: "single",
        photoRequirements: [],
        referencePhoto: null,
        version: 1,
        creatorName: "Мария Волкова",
        canEdit: true,
        creatorId: trainingManager.id,
        reviewerIds: [trainingManager.id],
        reviewers: [trainingManager],
      };
      if (session.managementRole === "superuser") {
        const ids = JSON.parse(String(body.get("reviewer_ids") || "[]"));
        const choices = trainingReviewerChoices(true);
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.some((id) => !choices.some((person) => Number(person.id) === id))
        )
          throw new Error(
            "Выберите хотя бы одного ответственного за проверку.",
          );
        template.reviewerIds = ids.map(String);
        template.reviewers = choices.filter((person) =>
          template.reviewerIds!.includes(person.id),
        );
      }
      data.templates.push(template);
      value = template;
    } else if (
      method === "POST" &&
      step === 3 &&
      session.managementRole === "superuser" &&
      parts[1] === "training-template" &&
      options.body instanceof FormData
    ) {
      const ids = JSON.parse(String(options.body.get("reviewer_ids") || "[]"));
      if (
        !Array.isArray(ids) ||
        ids.length !== 3 ||
        ![21, 23, 24].every((id) => ids.includes(id))
      )
        throw new Error(
          "Выберите Марию, Дмитрия и Анну и сохраните автозадачу.",
        );
      const template = data.templates[0];
      if (!template) throw new Error("Сначала создайте учебную автозадачу.");
      template.reviewerIds = ids.map(String);
      template.reviewers = trainingReviewerChoices(true).filter((person) =>
        template.reviewerIds!.includes(person.id),
      );
      template.version++;
      value = template;
    } else if (
      method === "PATCH" &&
      parts[1] === "training-template" &&
      [1, 2].includes(step)
    ) {
      const body = JSON.parse(String(options.body));
      const template = data.templates[0];
      if (!template || body.enabled !== (step === 2))
        throw new Error(
          step === 1
            ? "Выключите автосоздание учебной задачи."
            : "Включите автосоздание учебной задачи.",
        );
      template.enabled = body.enabled;
      template.version++;
      value = template;
    } else throw new Error("Выполните действие из подсказки обучения.");
    next.ready = true;
    return { session: next, value: structuredClone(value) };
  }
  if (
    section === "schedule" &&
    method === "POST" &&
    parts[1] === "training-next"
  ) {
    const period = data.periods[1];
    const body = JSON.parse(String(options.body));
    if (parts[2] === "generate" && step === 1) {
      const admins = scheduleAdmins.filter((person) =>
        body.admins?.includes(Number(person.id)),
      );
      if (admins.length !== 4)
        throw new Error(
          "Для упражнения оставьте выбранными четырёх администраторов.",
        );
      const plan: Plan = {};
      Object.keys(period.plan).forEach((key, index) => {
        plan[key] =
          admins[
            (Math.floor(index / 4) % 2) + (key.endsWith("/night") ? 2 : 0)
          ];
      });
      return {
        session,
        value: {
          plan,
          warning:
            "Учебный черновик 2/2 готов. Проверьте его и сохраните график.",
          admins: admins.map((a) => a.id),
        },
      };
    }
    let plan: Plan;
    let source: string;
    let restoredFrom: number | null = null;
    if (!parts[2] && step < 2) {
      source = step === 0 ? "manual" : "automatic";
      if (
        body.source !== source ||
        !Array.isArray(body.slots) ||
        !body.slots.some(
          (s: { admin_id: number | null }) => s.admin_id !== null,
        )
      )
        throw new Error(
          "Назначьте сотрудников по инструкции и сохраните график.",
        );
      plan = Object.fromEntries(
        body.slots.map(
          (slot: { date: string; type: string; admin_id: number | null }) => [
            `${slot.date}/${slot.type}`,
            scheduleAdmins.find((p) => Number(p.id) === slot.admin_id) || null,
          ],
        ),
      );
    } else if (parts[2] === "restore" && step === 2 && body.revision === 2) {
      plan = structuredClone(data.plans[period.id][2]);
      source = "manual";
      restoredFrom = 2;
    } else
      throw new Error(
        "Выполните действие из подсказки обучения. Отправка в Telegram в учебном режиме недоступна.",
      );
    period.version++;
    period.viewVersion = period.version;
    period.plan = plan;
    period.revisions.unshift({
      number: period.version,
      source,
      restoredFrom,
      author: "Мария Волкова",
      createdAt: new Date().toISOString(),
    });
    data.plans[period.id][period.version] = structuredClone(plan);
    next.ready = true;
    return { session: next, value: structuredClone(period) };
  }
  throw new Error("Это действие недоступно в учебном режиме.");
}
