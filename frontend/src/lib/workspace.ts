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
  { id: "desk", label: "Administrator desk", required: true },
  { id: "receipt", label: "Closing receipt", required: true },
  { id: "additional", label: "Additional photo", required: false },
];

export interface StaffMember {
  id: string;
  name: string;
  initials: string;
  role: Role;
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
  kind: "shift" | "task" | "expense" | "telegram";
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
  if (fields.length > 10) return "Use at most 10 photo fields.";
  if (fields.some((field) => !field.label.trim()))
    return "Name every photo field.";
  const names = fields.map((field) => field.label.trim().toLowerCase());
  if (new Set(names).size !== names.length)
    return "Use a different name for each photo field.";
  return "";
}

export function photoEvidenceError(
  mode: PhotoMode,
  fields: PhotoRequirement[],
  photos: EvidencePhoto[],
): string {
  if (photos.length > 10) return "Attach at most 10 photos.";
  if ((mode === "single" || mode === "multiple") && !photos.length)
    return "Add the required completion photo before closing this task.";
  if (mode === "named") {
    const missing = fields.filter(
      (field) =>
        field.required && !photos.some((photo) => photo.slot === field.id),
    );
    if (missing.length)
      return `Add the required photos: ${missing.map((field) => field.label).join(", ")}.`;
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
