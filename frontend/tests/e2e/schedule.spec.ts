import { expect, test, type Page } from "@playwright/test";

async function setup(
  page: Page,
  role: "admin" | "manager" | "superuser" = "manager",
) {
  const admins = Array.from({ length: 5 }, (_, i) => ({
    id: String(i + 10),
    name: `Администратор ${i + 1}`,
    initials: `А${i + 1}`,
    role: "admin",
  }));
  const user =
    role === "admin"
      ? admins[0]
      : { id: "1", name: "Мария Волкова", initials: "МВ", role };
  const periods = [
    {
      id: "1",
      start: "2026-10-01",
      end: "2026-10-15",
      editable: true,
      sendAt: "2026-10-17T00:00:00+03:00",
      image: null,
    },
    {
      id: "2",
      start: "2026-10-16",
      end: "2026-10-31",
      editable: true,
      sendAt: "2026-11-02T00:00:00+03:00",
      image: null,
    },
    {
      id: "3",
      start: "2026-09-16",
      end: "2026-09-30",
      editable: false,
      sendAt: "2026-10-02T00:00:00+03:00",
      image: null,
    },
  ];
  type Person = (typeof admins)[number];
  const versions = new Map<
    string,
    {
      plan: Record<string, Person | null>;
      source: string;
      number: number;
      restoredFrom: number | null;
    }[]
  >();
  for (const p of periods) {
    const plan: Record<string, Person | null> = {};
    for (
      let day = Number(p.start.slice(-2));
      day <= Number(p.end.slice(-2));
      day++
    ) {
      for (const kind of ["day", "night"])
        plan[`${p.start.slice(0, 8)}${String(day).padStart(2, "0")}/${kind}`] =
          null;
    }
    versions.set(p.id, [
      { plan, number: 1, source: "initial", restoredFrom: null },
    ]);
  }
  let config = { defaultAdminId: null as string | null, version: 1 };
  const detail = (id: string, version?: string | null) => {
    const list = versions.get(id)!;
    const selected = version
      ? list.find((v) => v.number === Number(version))!
      : list.at(-1)!;
    return {
      ...periods.find((p) => p.id === id),
      version: list.length,
      viewVersion: selected.number,
      plan: selected.plan,
      canEdit: role !== "admin" && periods.find((p) => p.id === id)!.editable,
      unavailable: [],
      actual:
        id === "1"
          ? {
              "2026-10-02/day": [
                {
                  id: "77",
                  adminId: "11",
                  adminName: "Фактический администратор",
                  openedAt: "2026-10-02T10:00:00+03:00",
                  closedAt: "2026-10-02T22:00:00+03:00",
                  proposed: { ...admins[0], name: "Назначенный администратор" },
                  revision: 1,
                },
              ],
            }
          : {},
      revisions: [...list].reverse().map((v) => ({
        number: v.number,
        source: v.source,
        restoredFrom: v.restoredFrom,
        author: user.name,
        createdAt: "2026-10-10T12:00:00+03:00",
      })),
    };
  };
  await page.route("https://telegram.org/**", (r) =>
    r.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.addInitScript(() => {
    let back = () => {};
    const app = {
      initData: "signed-test-data",
      initDataUnsafe: {},
      colorScheme: "dark",
      themeParams: {},
      ready() {},
      expand() {},
      isVersionAtLeast: () => true,
      setHeaderColor() {},
      setBackgroundColor() {},
      setBottomBarColor() {},
      enableClosingConfirmation() {},
      disableClosingConfirmation() {},
      onEvent() {},
      offEvent() {},
      BackButton: {
        hide() {},
        show() {},
        onClick(fn: () => void) {
          back = fn;
        },
        offClick() {},
      },
      HapticFeedback: { notificationOccurred() {}, selectionChanged() {} },
    };
    Object.defineProperty(window, "Telegram", { value: { WebApp: app } });
    Object.defineProperty(window, "testBack", { value: () => back() });
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path.endsWith("/telegram/telegram/"))
      return route.fulfill({ json: { token: "test-token" } });
    if (path.endsWith("/telegram/me/"))
      return route.fulfill({
        json: {
          id: Number(user.id),
          username: "employee",
          first_name: user.name,
          last_name: "",
          is_staff: role !== "admin",
          is_superuser: role === "superuser",
          is_active: true,
        },
      });
    if (path === "/api/workspace/")
      return route.fulfill({
        json: {
          user,
          people: [user, ...admins],
          state: {
            shift: null,
            shifts: [],
            tasks: [],
            balance: 1000,
            expenses: [],
            activity: [],
          },
        },
      });
    if (path === "/api/schedules/")
      return route.fulfill({
        json: {
          current: periods[0],
          future: periods[1],
          archive: [periods[2]],
          admins,
          settings: config,
        },
      });
    if (path === "/api/schedules/settings/") {
      const data = route.request().postDataJSON();
      config = {
        defaultAdminId: data.default_admin ? String(data.default_admin) : null,
        version: config.version + 1,
      };
      return route.fulfill({ json: config });
    }
    const match = path.match(
      /^\/api\/schedules\/(\d+)\/(generate\/|restore\/)?$/,
    );
    if (match) {
      const id = match[1];
      const list = versions.get(id)!;
      if (method === "GET")
        return route.fulfill({
          json: detail(id, url.searchParams.get("revision")),
        });
      const data = route.request().postDataJSON();
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      if (data.version !== list.length)
        return route.fulfill({
          status: 409,
          json: { detail: "График изменился." },
        });
      if (match[2] === "generate/") {
        if (data.admins.length < 4 && !config.defaultAdminId)
          return route.fulfill({
            status: 400,
            json: { detail: "Выберите администратора по умолчанию." },
          });
        const selected = [...data.admins.map(String)];
        while (selected.length < 4) selected.push(config.defaultAdminId!);
        const plan = Object.fromEntries(
          Object.keys(list.at(-1)!.plan).map((key) => {
            const [day, kind] = key.split("/");
            const group = Number(day.slice(-2)) % 4 < 2 ? 0 : 2;
            return [
              key,
              admins.find(
                (p) => p.id === selected[group + (kind === "night" ? 1 : 0)],
              )!,
            ];
          }),
        );
        return route.fulfill({
          json: {
            plan,
            admins: data.admins.map(String),
            warning:
              data.admins.length < 4
                ? "Недостающие позиции назначены администратору по умолчанию."
                : "",
          },
        });
      }
      const plan =
        match[2] === "restore/"
          ? structuredClone(list.find((v) => v.number === data.revision)!.plan)
          : Object.fromEntries(
              data.slots.map(
                (s: {
                  date: string;
                  type: string;
                  admin_id: number | null;
                }) => [
                  `${s.date}/${s.type}`,
                  admins.find((p) => p.id === String(s.admin_id)) || null,
                ],
              ),
            );
      list.push({
        plan,
        number: list.length + 1,
        source: match[2] === "restore/" ? "restore" : data.source,
        restoredFrom: data.revision || null,
      });
      return route.fulfill({ json: detail(id) });
    }
    if (path === "/api/shifts/77/")
      return route.fulfill({
        json: {
          id: "77",
          type: "day",
          adminName: "Фактический администратор",
          openedAt: "2026-10-02T10:00:00+03:00",
          closedAt: "2026-10-02T22:00:00+03:00",
          cash: 100,
          cards: 200,
          sbp: 300,
          total: "600",
          photos: {},
        },
      });
    return route.fulfill({ json: [] });
  });
  return { versions, admins };
}

async function openSchedule(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "График смен", exact: true }).click();
  await expect(page.locator(".schedule-grid tbody tr")).toHaveCount(15);
}

test("administrators view both periods, planned and actual staff, and cannot edit", async ({
  page,
}) => {
  await setup(page, "admin");
  await openSchedule(page);
  await expect(
    page.getByRole("button", { name: "Редактировать график" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "02.10.2026 День", exact: true })
    .click();
  await expect(page.getByLabel("Детали ячейки графика")).toContainText(
    "Назначенный администратор",
  );
  await expect(page.getByLabel("Детали ячейки графика")).toContainText(
    "Фактический администратор",
  );
  await expect(
    page.getByRole("button", { name: "Открыть отчёт смены" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await expect(page.locator(".schedule-grid tbody tr")).toHaveCount(16);
  await expect(
    page.getByRole("button", { name: "Редактировать график" }),
  ).toHaveCount(0);
});

test("managers assign by tapping cells, save explicitly, and restore versions", async ({
  page,
}, info) => {
  const { versions } = await setup(page);
  await openSchedule(page);
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать график" }).click();
  await page.getByLabel("Назначаемый администратор").selectOption("11");
  await page
    .getByRole("button", { name: "16.10.2026 День", exact: true })
    .click();
  await page
    .getByRole("button", { name: "17.10.2026 Ночь", exact: true })
    .click();
  expect(versions.get("2")!.length).toBe(1);
  await page.screenshot({
    path: info.outputPath("schedule-editor.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить график", exact: true })
    .click();
  await expect(
    page.getByText("График сохранён. Создана новая версия."),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("schedule-calendar.png"),
    fullPage: false,
  });
  expect(versions.get("2")!.length).toBe(2);
  await page.getByLabel("Версия графика").selectOption("1");
  await expect(
    page.getByRole("button", { name: "16.10.2026 День", exact: true }),
  ).toContainText("Не назначен");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Восстановить эту версию" }).click();
  await expect(
    page.getByText("Версия восстановлена. Фактические смены сохранены."),
  ).toBeVisible();
  expect(versions.get("2")!.length).toBe(3);
  await page.getByRole("button", { name: "Текущий", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать график" }).click();
  await expect(
    page.getByText("Автозаполнение 2/2", { exact: true }),
  ).toHaveCount(0);
});

test("superusers choose fallback; automatic schedules remain drafts until saved", async ({
  page,
}) => {
  const { versions } = await setup(page, "superuser");
  await openSchedule(page);
  await page.getByText("Администратор по умолчанию", { exact: true }).click();
  await page
    .getByLabel("Администратор по умолчанию", { exact: true })
    .selectOption("14");
  await page
    .getByRole("button", { name: "Сохранить сотрудника по умолчанию" })
    .click();
  await expect(
    page.getByText("Администратор по умолчанию сохранён."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать график" }).click();
  await page.getByText("Автозаполнение 2/2", { exact: true }).click();
  await page.getByLabel("Администратор 4", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Заполнить 2/2" }).click();
  await expect(page.getByRole("status")).toContainText("Недостающие позиции");
  expect(versions.get("2")!.length).toBe(1);
  await page
    .getByRole("button", { name: "Сохранить график", exact: true })
    .click();
  await expect(
    page.getByText("График сохранён. Создана новая версия."),
  ).toBeVisible();
  expect(versions.get("2")!.at(-1)!.source).toBe("automatic");
  expect(
    Object.values(versions.get("2")!.at(-1)!.plan).some((p) => p?.id === "14"),
  ).toBe(true);
});

test("unsaved work is guarded and archive links open the requested period", async ({
  page,
}) => {
  await setup(page);
  await openSchedule(page);
  await page.getByRole("button", { name: "Редактировать график" }).click();
  await page
    .getByRole("button", { name: "01.10.2026 День", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await expect(page.locator(".schedule-period-title")).toContainText(
    "01.10.2026",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await expect(page.locator(".schedule-period-title")).toContainText(
    "16.10.2026",
  );
  await page.goto("/?schedule=3");
  await expect(page.locator(".schedule-period-title")).toContainText(
    "16.09.2026",
  );
  await expect(
    page.getByRole("button", { name: "Редактировать график" }),
  ).toHaveCount(0);
});
