import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, role: "manager" | "admin" = "manager") {
  const user = {
    id: role === "manager" ? "1" : "2",
    name: role === "manager" ? "Управляющий" : "Администратор",
    initials: "С",
    role,
  };
  const tasks = [
    {
      id: "required-1",
      title: "Проверить игровые места",
      description: "Проверить все места.",
      managerId: "1",
      adminId: "2",
      shiftId: "shift-1",
      requiredForShiftId: "shift-1",
      automatic: true,
      status: "active",
      priority: "normal",
      requiresPhoto: false,
      photoMode: "optional",
      photos: [],
      submissionVersion: 0,
      createdAt: "2026-11-01T10:00:00+03:00",
    },
  ];
  const templates: Record<string, unknown>[] = [];
  const gamepads = [
    {
      id: 1,
      model: "DualSense",
      serial_number: "GP-1",
      playstation: 1,
      info: "",
    },
    {
      id: 2,
      model: "DualSense",
      serial_number: "GP-2",
      playstation: null as number | null,
      info: "",
    },
    {
      id: 3,
      model: "DualSense",
      serial_number: "GP-3",
      playstation: 2,
      info: "",
    },
  ];
  const consoles = [
    {
      id: 1,
      club_number: 1,
      serial_number: "PS-1",
      gamepads: [1],
      info: "",
      warranty_until: null,
    },
    {
      id: 2,
      club_number: 2,
      serial_number: "PS-2",
      gamepads: [3],
      info: "",
      warranty_until: null,
    },
  ];
  const saves: unknown[] = [];
  await page.addInitScript(() => {
    let back = () => {};
    Object.defineProperty(window, "testBack", { value: () => back() });
    Object.defineProperty(window, "Telegram", {
      value: {
        WebApp: {
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
            show() {},
            hide() {},
            onClick(fn: () => void) {
              back = fn;
            },
            offClick() {},
          },
          HapticFeedback: { notificationOccurred() {}, selectionChanged() {} },
        },
      },
    });
  });
  await page.route("https://telegram.org/**", (r) =>
    r.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/telegram/telegram/"))
      return route.fulfill({ json: { token: "token" } });
    if (path.endsWith("/telegram/me/"))
      return route.fulfill({
        json: {
          id: Number(user.id),
          username: "employee",
          first_name: user.name,
          is_staff: role === "manager",
          is_superuser: false,
          is_active: true,
        },
      });
    if (path === "/api/workspace/")
      return route.fulfill({
        json: {
          user,
          people: [
            { id: "1", name: "Управляющий", initials: "У", role: "manager" },
            { id: "2", name: "Администратор", initials: "А", role: "admin" },
          ],
          state: {
            shift: {
              id: "shift-1",
              adminId: "2",
              type: "day",
              openedAt: "2026-11-01T10:00:00+03:00",
              photoRequirements: [],
            },
            shifts: [],
            tasks,
            balance: 1000,
            expenses: [],
            activity: [],
          },
        },
      });
    if (path.startsWith("/api/automatic-tasks/")) {
      if (method === "GET") return route.fulfill({ json: templates });
      const body = route.request().postData() || "";
      const field = (name: string) =>
        body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ||
        "";
      const old = templates.find(
        (item) => String(item.id) === path.split("/")[3],
      );
      const data = {
        id: old?.id || String(templates.length + 1),
        title: field("title"),
        description: field("description"),
        shiftType: field("shift_type"),
        enabled: field("enabled") === "true",
        priority: field("priority"),
        photoMode: field("photo_mode"),
        photoRequirements: JSON.parse(field("photo_requirements") || "[]"),
        referencePhoto: null,
        version: Number(old?.version || 0) + 1,
        creatorName: "Управляющий",
        canEdit: true,
      };
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      if (old) Object.assign(old, data);
      else templates.push(data);
      return route.fulfill({ status: old ? 200 : 201, json: data });
    }
    if (path === "/api/tasks/required-1/submit/") {
      tasks[0].status = "moderation";
      tasks[0].submissionVersion += 1;
      return route.fulfill({ json: { id: "required-1" } });
    }
    if (path === "/api/playstations/") return route.fulfill({ json: consoles });
    if (path === "/api/gamepads/") return route.fulfill({ json: gamepads });
    const consoleMatch = path.match(/^\/api\/playstations\/(\d+)\/$/);
    if (consoleMatch) {
      const console = consoles.find(
        (item) => item.id === Number(consoleMatch[1]),
      )!;
      if (method === "PATCH") {
        const body = route.request().postDataJSON();
        saves.push(body);
        Object.assign(console, body);
        gamepads.forEach((pad) => {
          if (console.gamepads.includes(pad.id)) pad.playstation = console.id;
          else if (pad.playstation === console.id) pad.playstation = null;
        });
      }
      return route.fulfill({ json: console });
    }
    const pad = path.match(/^\/api\/gamepads\/(\d+)\/$/);
    if (pad)
      return route.fulfill({
        json: gamepads.find((item) => item.id === Number(pad[1])),
      });
    return route.fulfill({ json: [] });
  });
  return { templates, tasks, saves };
}

test("automatic task templates can be configured by shift and disabled for future shifts", async ({
  page,
}, info) => {
  const server = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Автоматические задачи", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать автозадачу", exact: true })
    .click();
  await page
    .getByLabel("Название автоматической задачи")
    .fill("Проверить уборку");
  await page
    .getByLabel("Инструкции автоматической задачи")
    .fill("Сфотографировать чистые игровые места.");
  await page.getByLabel("Смена автоматической задачи").selectOption("night");
  await page.getByLabel("Фото автоматической задачи").selectOption("named");
  await page
    .getByRole("button", { name: "Добавить поле для фото", exact: true })
    .click();
  await page
    .getByLabel("Название фотографии 1", { exact: true })
    .fill("Чистые места");
  await page.screenshot({
    path: info.outputPath("automatic-task-editor.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить автозадачу", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Проверить уборку", exact: true }),
  ).toBeVisible();
  expect(server.templates[0].shiftType).toBe("night");
  expect(server.templates[0].photoMode).toBe("named");
  await page
    .getByRole("button", { name: "Изменить: Проверить уборку", exact: true })
    .click();
  await page.getByLabel("Создавать автоматически", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Сохранить автозадачу", exact: true })
    .click();
  await expect(
    page.getByText("Ночная смена · Выключена", { exact: true }),
  ).toBeVisible();
});

test("required tasks block shift closing until sent to moderation and block again after rejection", async ({
  page,
}) => {
  const server = await setup(page, "admin");
  await page.goto("/");
  const close = page.getByRole("button", {
    name: "Закрыть смену",
    exact: true,
  });
  await expect(close).toBeDisabled();
  await page.getByRole("button", { name: /Проверить игровые места/ }).click();
  await page.getByLabel("Комментарий к выполнению").fill("Места проверены");
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect(
    page.getByText("Задача отправлена на проверку", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { testBack: () => void }).testBack(),
  );
  await expect(close).toBeEnabled();
  server.tasks[0].status = "rejected";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(close).toBeDisabled();
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Автоматические задачи", exact: true }),
  ).toHaveCount(0);
});

test("PlayStation accepts several gamepads while occupied gamepads are excluded", async ({
  page,
}, info) => {
  const server = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Устройства", exact: true }).click();
  await page
    .locator(".resource-tabs")
    .getByRole("button", { name: "PlayStation", exact: true })
    .click();
  await page.locator(".equipment-row").first().click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(
    page.getByLabel("DualSense · GP-1", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("DualSense · GP-2", { exact: true }).check();
  await expect(
    page.getByLabel("DualSense · GP-3", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("playstation-gamepads.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".equipment-row")).toHaveCount(2);
  expect(server.saves[0]).toMatchObject({ gamepads: [1, 2] });
  await page.locator(".equipment-row").first().click();
  await expect(
    page.getByText("DualSense · GP-1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("DualSense · GP-2", { exact: true }),
  ).toBeVisible();
});
