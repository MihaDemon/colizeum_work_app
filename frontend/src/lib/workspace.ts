export type Role = "admin" | "manager" | "superuser";

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
> & { referencePhoto?: string };

export type Action =
  | { type: "OPEN_SHIFT"; actorId: string; shiftType: "day" | "night" }
  | {
      type: "CLOSE_SHIFT";
      actorId: string;
      cash: number;
      cards: number;
      sbp: number;
      photos: Record<string, string>;
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
      note?: string;
    }
  | {
      type: "REVIEW_TASK";
      actorId: string;
      taskId: string;
      accept: boolean;
      version?: number;
      reason?: string;
    };

export const requiredPhotoSlots = ["Administrator desk", "Closing receipt"];

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
