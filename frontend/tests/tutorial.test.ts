import { describe, expect, it } from "vitest";
import {
  advance,
  availableTracks,
  createSession,
  previous,
  lessons,
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
