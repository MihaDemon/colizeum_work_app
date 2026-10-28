export type Role = "admin" | "manager" | "superuser";

export interface PhotoRequirement {
  id: string;
  label: string;
  required: boolean;
}
export type PhotoMode = "optional" | "single" | "multiple" | "named";
export interface EvidencePhoto {
  id?: string;
  slot: string;
  label: string;
  url: string;
}
export interface PhotoSettings {
  reportFields: PhotoRequirement[];
  version: number;
}
export const defaultReportPhotoFields: PhotoRequirement[] = [
  { id: "desk", label: "Стол администратора", required: true },
  { id: "receipt", label: "Чек закрытия смены", required: true },
  { id: "additional", label: "Дополнительное фото", required: false },
];

export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  role: Role;
  deleted?: boolean;
  isActive?: boolean;
}

export interface Task {
  submissionVersion?: number;
  id: string;
  title: string;
  description: string;
  managerId: string;
  /** Assignee ID; the legacy field name matches the server workspace contract. */
  adminId: string;
  shiftId?: string;
  priority: "high" | "normal" | "low";
  requiresPhoto: boolean;
  photoMode?: PhotoMode;
  photoRequirements?: PhotoRequirement[];
  photos?: EvidencePhoto[];
  referencePhoto?: string;
  status: "active" | "moderation" | "accepted" | "rejected";
  photo?: string;
  photoName?: string;
  note?: string;
  rejectionReason?: string;
  createdAt: string;
  submittedAt?: string;
  acceptedAt?: string;
}

export interface Shift {
  adminName?: string;
  cleanerVisitedAt?: string | null;
  total?: string;
  balance?: number;
  photoRequirements?: PhotoRequirement[];
  legacy?: boolean;
  id: string;
  adminId: string;
  type: "day" | "night";
  openedAt: string;
  closedAt?: string;
  cash?: number;
  cards?: number;
  sbp?: number;
  photos?: Record<string, string>;
}

export interface Expense {
  adminName?: string;
  photos?: { url: string; label: string }[];
  id: string;
  adminId: string;
  shiftId?: string;
  amount: number;
  description: string;
  createdAt: string;
  photo?: string;
}

export interface Activity {
  recipientId?: string;
  id: string;
  title: string;
  description: string;
  time: string;
  kind:
    "shift" | "task" | "expense" | "telegram" | "cleaner" | "schedule" | "cash";
  actorId?: string;
  managerId?: string;
}

export interface State {
  photoSettings?: PhotoSettings;
  shift: Shift | null;
  shifts: Shift[];
  tasks: Task[];
  expenses: Expense[];
  balance: number;
  activity: Activity[];
}

export type NewTask = Pick<
  Task,
  "title" | "description" | "adminId" | "priority" | "requiresPhoto"
> & {
  referencePhoto?: string;
  photoMode?: PhotoMode;
  photoRequirements?: PhotoRequirement[];
};

export type Action =
  | { type: "DELETE_TASK"; actorId: string; taskId: string }
  | { type: "MARK_CLEANER"; actorId: string; shiftId: string; confirmed: true }
  | { type: "OPEN_SHIFT"; actorId: string; shiftType: "day" | "night" }
  | {
      type: "CLOSE_SHIFT";
      actorId: string;
      cash: number;
      cards: number;
      sbp: number;
      photos: EvidencePhoto[];
    }
  | {
      type: "ADD_EXPENSE";
      actorId: string;
      amount: number;
      description: string;
      photo?: string;
    }
  | { type: "CREATE_TASK"; actorId: string; task: NewTask }
  | {
      type: "SUBMIT_TASK";
      actorId: string;
      taskId: string;
      photo?: string;
      photoName?: string;
      photos?: EvidencePhoto[];
      note?: string;
    }
  | {
      type: "REVIEW_TASK";
      actorId: string;
      taskId: string;
      accept: boolean;
      version?: number;
      reason?: string;
    }
  | {
      type: "SAVE_PHOTO_SETTINGS";
      actorId: string;
      version: number;
      fields: PhotoRequirement[];
    };

export function photoFieldsError(fields: PhotoRequirement[]): string {
  if (fields.length > 10)
    return "Можно добавить не более 10 полей для фотографий.";
  if (fields.some((field) => !field.label.trim()))
    return "Укажите название каждого поля для фото.";
  const names = fields.map((field) => field.label.trim().toLowerCase());
  if (new Set(names).size !== names.length)
    return "Названия полей для фотографий должны различаться.";
  return "";
}

export function photoEvidenceError(
  mode: PhotoMode,
  fields: PhotoRequirement[],
  photos: EvidencePhoto[],
): string {
  if (photos.length > 10) return "Можно прикрепить не более 10 фотографий.";
  if ((mode === "single" || mode === "multiple") && !photos.length)
    return "Перед закрытием задачи добавьте обязательное фото выполнения.";
  if (mode === "named") {
    const missing = fields.filter(
      (field) =>
        field.required && !photos.some((photo) => photo.slot === field.id),
    );
    if (missing.length)
      return `Добавьте обязательные фотографии: ${missing.map((field) => field.label).join(", ")}.`;
  }
  return "";
}

export function visibleTasks(state: State, persona: StaffMember): Task[] {
  if (persona.role === "superuser") return state.tasks;
  if (persona.role === "manager")
    return state.tasks.filter(
      (task) => task.managerId === persona.id || task.adminId === persona.id,
    );
  return state.tasks.filter(
    (task) =>
      task.adminId === persona.id &&
      (!task.shiftId || task.shiftId === state.shift?.id) &&
      task.status !== "accepted",
  );
}
