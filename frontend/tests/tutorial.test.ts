import { describe, expect, it } from "vitest";
import {
  advance,
  availableTracks,
  createSession,
  previous,
  lessons,
  applyTrainingAction,
  trainingManager,
  trainingAdmin,
  observeTraining,
} from "../src/tutorial/model";
import { trainingRequest } from "../src/tutorial/services";
import type { User } from "../src/lib/types";

const account = (role: "admin" | "manager" | "superuser"): User => ({
  id: 1,
  username: "test",
  first_name: "",
  last_name: "",
  phone_number: null,
  last_login: null,
  is_active: true,
  is_staff: role !== "admin",
  role,
});
describe("tutorial access", () => {
  it("requires confirmed forced closure, preserves unfinished tasks and records the closer", () => {
    let session = createSession("manager");
    session.step = 5;
    session.ready = true;
    session = advance(session);
    const unfinished = session.state.tasks.find(
      (task) => task.id === "training-unfinished",
    )!;
    expect(unfinished.requiredForShiftId).toBe("training-shift");
    const action = {
      type: "FORCE_CLOSE_SHIFT" as const,
      actorId: trainingManager.id,
      shiftId: "training-shift",
      cash: 1000,
      cards: 2000,
      sbp: 500,
      photos: [],
      reason: "Телефон администратора не работает",
      confirmed: true as const,
    };
    expect(() =>
      applyTrainingAction(session, { ...action, reason: "" }),
    ).toThrow();
    expect(() =>
      applyTrainingAction(session, { ...action, shiftId: "another-shift" }),
    ).toThrow();
    expect(() =>
      applyTrainingAction(session, { ...action, cash: 0 }),
    ).toThrow();
    const closed = applyTrainingAction(session, action);
    expect(closed.state.shift).toBeNull();
    expect(closed.state.balance).toBe(6000);
    expect(closed.state.shifts[0]).toMatchObject({
      adminId: trainingAdmin.id,
      closedBy: trainingManager.name,
      forcedCloseReason: action.reason,
      cash: 1000,
      cards: 2000,
      sbp: 500,
    });
    expect(
      closed.state.tasks.find((task) => task.id === unfinished.id),
    ).toMatchObject({ status: "active" });
    expect(
      closed.state.tasks.find((task) => task.id === unfinished.id)
        ?.requiredForShiftId,
    ).toBeUndefined();
    expect(() => applyTrainingAction(closed, action)).toThrow();
    const restored = previous(advance(closed));
    expect(restored.state.shift).not.toBeNull();
    expect(restored.state.balance).toBe(5000);
  });
  it("only superusers can practise saving the review team and all three required selections must be saved", () => {
    const session = managerAt("automatic-tasks");
    const body = new FormData();
    for (const [key, value] of Object.entries({
      title: "Проверить зал",
      description: "Проверьте места",
      shift_type: "day",
      photo_mode: "single",
    }))
      body.set(key, value);
    const created = trainingRequest(session, "automatic-tasks/", {
      method: "POST",
      body,
    }).session;
    created.step += 3;
    created.ready = false;
    const changes = new FormData();
    changes.set("reviewer_ids", "[21,23,24]");
    expect(() =>
      trainingRequest(created, "automatic-tasks/training-template/", {
        method: "POST",
        body: changes,
      }),
    ).toThrow();
    expect(observeTraining(created, "template-opened").ready).toBe(true);
    created.managementRole = "superuser";
    expect(observeTraining(created, "template-opened").ready).toBe(false);
    changes.set("reviewer_ids", "[21]");
    expect(() =>
      trainingRequest(created, "automatic-tasks/training-template/", {
        method: "POST",
        body: changes,
      }),
    ).toThrow();
    changes.set("reviewer_ids", "[21,23,24]");
    const saved = trainingRequest(
      created,
      "automatic-tasks/training-template/",
      { method: "POST", body: changes },
    ).session;
    expect(saved.ready).toBe(true);
    expect(saved.data.templates[0].reviewerIds).toEqual(["21", "23", "24"]);
    expect(
      saved.data.templates[0].reviewers?.map((person) => person.role),
    ).toEqual(["superuser", "superuser", "manager"]);
    expect(created.data.templates[0].reviewerIds).toEqual(["21"]);
  });
  it("offers administrator training to every role and management courses only to management", () => {
    expect(availableTracks(account("admin"))).toEqual(["admin"]);
    for (const role of ["manager", "superuser"] as const)
      expect(availableTracks(account(role))).toEqual(["admin", "manager"]);
  });
  it("rejects live-only and out-of-order operations in the local adapter", () => {
    const session = managerAt("schedule");
    expect(() =>
      trainingRequest(session, "schedules/training-next/send/", {
        method: "POST",
        body: "{}",
      }),
    ).toThrow();
    expect(() => trainingRequest(session, "personnel/")).toThrow();
    expect(() =>
      trainingRequest(session, "schedules/training-next/restore/", {
        method: "POST",
        body: '{"revision":2}',
      }),
    ).toThrow();
  });
  it("restores template state when returning to a previous exercise", () => {
    const body = new FormData();
    for (const [key, value] of Object.entries({
      title: "Проверить зал",
      description: "Проверьте места",
      shift_type: "day",
      photo_mode: "single",
    }))
      body.set(key, value);
    let session = trainingRequest(
      managerAt("automatic-tasks"),
      "automatic-tasks/",
      { method: "POST", body },
    ).session;
    session = advance(session);
    session = trainingRequest(session, "automatic-tasks/training-template/", {
      method: "PATCH",
      body: '{"enabled":false}',
    }).session;
    session = advance(session);
    expect(session.data.templates[0].enabled).toBe(false);
    const restored = previous(session);
    expect(restored.data.templates[0].enabled).toBe(true);
    expect(restored.ready).toBe(false);
    expect(session.data.templates[0].enabled).toBe(false);
  });
  it("only advances after notification changes are saved and restores preferences with Back", () => {
    const session = managerAt("notifications");
    expect(() =>
      trainingRequest(session, "notification-settings/", {
        method: "PATCH",
        body: '{"task":false}',
      }),
    ).toThrow();
    expect(session.data.notifications.expense).toBe(true);
    const saved = trainingRequest(session, "notification-settings/", {
      method: "PATCH",
      body: '{"expense":false}',
    }).session;
    expect(saved.ready).toBe(true);
    const next = advance(saved);
    expect(next.data.notifications.expense).toBe(false);
    expect(next.ready).toBe(false);
    expect(previous(next).data.notifications.expense).toBe(true);
    const restored = trainingRequest(next, "notification-settings/", {
      method: "PATCH",
      body: '{"expense":true}',
    }).session;
    expect(restored.data.notifications.expense).toBe(true);
    expect(advance(restored).step).toBe(lessons.manager.length);
  });
});

function managerAt(section: "automatic-tasks" | "schedule" | "notifications") {
  const session = createSession("manager");
  session.step = lessons.manager.findIndex(
    (lesson) => lesson.section === section,
  );
  session.ready = false;
  session.checkpoints = Array.from({ length: session.step + 1 }, () =>
    structuredClone({ state: session.state, data: session.data }),
  );
  return session;
}
