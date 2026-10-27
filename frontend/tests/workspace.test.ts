import { describe, expect, it } from "vitest";
import {
  visibleTasks,
  type StaffMember,
  type State,
  type Task,
} from "../src/lib/workspace";

const admin: StaffMember = {
  id: "admin",
  name: "Administrator",
  initials: "A",
  role: "admin",
};
const manager: StaffMember = {
  id: "manager",
  name: "Manager",
  initials: "M",
  role: "manager",
};
const owner: StaffMember = {
  id: "owner",
  name: "Owner",
  initials: "O",
  role: "superuser",
};
function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: "",
    managerId: manager.id,
    adminId: admin.id,
    priority: "normal",
    requiresPhoto: false,
    status: "active",
    createdAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}
function state(tasks: Task[]): State {
  return {
    shift: {
      id: "current",
      adminId: admin.id,
      type: "day",
      openedAt: "2026-10-01T10:00:00Z",
    },
    tasks,
    shifts: [],
    expenses: [],
    activity: [],
    balance: 0,
  };
}
describe("production task visibility", () => {
  it("keeps the administrator's pending moderation and rework visible", () => {
    const s = state([
      task("moderation", { status: "moderation" }),
      task("rework", { status: "rejected" }),
      task("accepted", { status: "accepted" }),
    ]);
    expect(visibleTasks(s, admin).map((t) => t.id)).toEqual([
      "moderation",
      "rework",
    ]);
  });
  it("includes personal and current-shift assignments but excludes other employees and shifts", () => {
    const s = state([
      task("personal"),
      task("current", { shiftId: "current" }),
      task("old-shift", { shiftId: "old" }),
      task("other", { adminId: "other-admin" }),
    ]);
    expect(visibleTasks(s, admin).map((t) => t.id)).toEqual([
      "personal",
      "current",
    ]);
  });
  it("keeps off-shift personal assignments visible while the administrator waits", () => {
    const s = state([task("personal"), task("bound", { shiftId: "current" })]);
    s.shift = null;
    expect(visibleTasks(s, admin).map((t) => t.id)).toEqual(["personal"]);
  });
  it("shows the manager's received and delegated task history only", () => {
    const s = state([
      task("delegated", { status: "accepted" }),
      task("received", { managerId: owner.id, adminId: manager.id }),
      task("private", { managerId: "other-manager" }),
    ]);
    expect(visibleTasks(s, manager).map((t) => t.id)).toEqual([
      "delegated",
      "received",
    ]);
  });
  it("allows superusers to inspect tasks created by every manager", () => {
    const s = state([
      task("first"),
      task("second", { managerId: "other-manager" }),
    ]);
    expect(visibleTasks(s, owner)).toEqual(s.tasks);
  });
});
