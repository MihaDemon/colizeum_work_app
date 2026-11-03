import { expect, test, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

async function setup(page: Page) {
  const manager = {
    id: "1",
    name: "Мария Волкова",
    initials: "МВ",
    role: "manager",
  };
  const admins = [
    { id: "2", name: "Алексей Смирнов", initials: "АС", role: "admin" },
    { id: "3", name: "Ирина Орлова", initials: "ИО", role: "admin" },
  ];
  const expense = {
    id: "1",
    adminId: "2",
    editingVersion: "expense-v1",
    amount: 100,
    description: "Бумага",
    createdAt: "2026-10-28T12:00:00+03:00",
    photo: "/api/files/expense/1/",
    photos: [],
  };
  const shift = {
    id: "1",
    adminId: "2",
    type: "day",
    editingVersion: "shift-v1",
    openedAt: "2026-10-28T10:00:00+03:00",
    closedAt: "2026-10-28T22:00:00+03:00",
    scheduleDate: "2026-10-28",
    cash: 100,
    cards: 200,
    sbp: 300,
    info: "",
    photos: { Чек: "/api/files/report/1/" },
    reportPhotos: [
      { id: "1", slot: "", label: "Чек", url: "/api/files/report/1/" },
    ],
  };
  const posts: { path: string; body: string }[] = [];
  let conflict = false;
  await page.route("https://telegram.org/**", (r) =>
    r.fulfill({ body: "", contentType: "text/javascript" }),
  );
  await page.addInitScript(() => {
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
          BackButton: { hide() {}, show() {}, onClick() {}, offClick() {} },
          HapticFeedback: { notificationOccurred() {}, selectionChanged() {} },
        },
      },
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/telegram/telegram/"))
      return route.fulfill({ json: { token: "test-token" } });
    if (path.endsWith("/telegram/me/"))
      return route.fulfill({
        json: {
          id: 1,
          username: "manager",
          first_name: manager.name,
          last_name: "",
          is_staff: true,
          is_active: true,
        },
      });
    if (path === "/api/workspace/")
      return route.fulfill({
        json: {
          user: manager,
          people: [manager, ...admins],
          state: {
            shift: null,
            shifts: [shift],
            tasks: [],
            balance: 1000,
            expenses: [expense],
            activity: [],
          },
        },
      });
    if (path.startsWith("/api/files/"))
      return route.fulfill({ body: png, contentType: "image/png" });
    if (route.request().method() === "POST") {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      posts.push({ path, body: route.request().postData()! });
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { detail: "Запись уже изменена. Откройте её заново." },
        });
      if (path.includes("shift-expenses")) {
        expense.description = "Бумага и ручки";
        expense.amount = 75.25;
        expense.editingVersion = "expense-v2";
      } else {
        shift.cash = 150.25;
        shift.cards = 250;
        shift.sbp = 350;
        shift.info = "Уточнённая выручка";
        shift.editingVersion = "shift-v2";
      }
      return route.fulfill({ json: { id: "1" } });
    }
    if (path === "/api/shift-expenses/1/")
      return route.fulfill({ json: expense });
    if (path === "/api/shifts/1/") return route.fulfill({ json: shift });
    return route.fulfill({ json: [] });
  });
  return {
    posts,
    setConflict: () => {
      conflict = true;
    },
  };
}

test("expenses can be corrected with a replacement receipt and removed photo", async ({
  page,
}, info) => {
  const { posts } = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Расходы", exact: true }).click();
  await page.locator(".cp-expense-row summary").click();
  await page.getByRole("button", { name: "Редактировать расход" }).click();
  await expect(page.getByLabel("Сумма расхода", { exact: true })).toHaveValue(
    "100",
  );
  await page.getByLabel("Сумма расхода", { exact: true }).fill("75,25");
  await page.getByLabel("Комментарий", { exact: true }).fill("Бумага и ручки");
  await page
    .getByLabel("Фотография чека", { exact: true })
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".cp-upload small")).toHaveText("receipt.png");
  await page.screenshot({
    path: info.outputPath("expense-editor.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Расходы", exact: true }),
  ).toBeVisible();
  expect(posts[0].path).toBe("/api/shift-expenses/1/");
  expect(posts[0].body).toContain('name="amount"\r\n\r\n75.25');
  expect(posts[0].body).toContain('name="photo"; filename="photo.png"');
  await page.locator(".cp-expense-row summary").click();
  await page.getByRole("button", { name: "Редактировать расход" }).click();
  await page.getByRole("button", { name: "Удалить фото чека" }).click();
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Расходы", exact: true }),
  ).toBeVisible();
  expect(posts[1].body).toContain('name="remove_photo"\r\n\r\ntrue');
});

test("closed shifts expose dates, administrator, amounts, comment and report photos", async ({
  page,
}, info) => {
  const { posts } = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "История смен/задач", exact: true })
    .click();
  await page.locator(".cp-history-row summary").click();
  await page.getByRole("button", { name: "Редактировать смену" }).click();
  await page.getByLabel("Администратор смены").selectOption("3");
  await page.getByLabel("Тип смены", { exact: true }).selectOption("night");
  await page.getByLabel("Дата по графику", { exact: true }).fill("2026-10-27");
  await expect(page.getByLabel("Время открытия")).toHaveValue(
    "2026-10-28T10:00",
  );
  await page.getByLabel("Время открытия").fill("2026-10-27T22:00");
  await page.getByLabel("Время закрытия").fill("2026-10-28T10:00");
  await page.getByLabel("Наличные", { exact: true }).fill("150,25");
  await page.getByLabel("Карта", { exact: true }).fill("250");
  await page.getByLabel("СБП", { exact: true }).fill("350");
  await page
    .getByLabel("Комментарий", { exact: true })
    .fill("Уточнённая выручка");
  await page.getByLabel("Название фото 1", { exact: true }).fill("Старый чек");
  await page
    .getByRole("button", { name: "Добавить фото", exact: true })
    .click();
  await page
    .getByLabel("Фото отчёта 2", { exact: true })
    .setInputFiles({ name: "report.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".cp-upload small").last()).toHaveText(
    "report.png",
  );
  await page.screenshot({
    path: info.outputPath("shift-editor.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История смен/задач" }),
  ).toBeVisible();
  expect(posts[0].path).toBe("/api/shifts/1/edit/");
  for (const [field, value] of [
    ["admin_id", "3"],
    ["cash", "150.25"],
    ["shift_type", "night"],
    ["retained_photos", '["1"]'],
  ])
    expect(posts[0].body).toContain(`name="${field}"\r\n\r\n${value}`);
  expect(posts[0].body).toContain("2026-10-27T22:00+03:00");
  expect(posts[0].body).toContain('name="photos"; filename="photos.png"');
});

test("notification editing keeps unsaved input after a conflict and guards leaving", async ({
  page,
}) => {
  const mock = await setup(page);
  mock.setConflict();
  await page.goto("/?expense=1");
  await page.getByRole("button", { name: "Редактировать расход" }).click();
  await page
    .getByLabel("Комментарий", { exact: true })
    .fill("Новый комментарий");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Редактирование расхода" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Запись уже изменена");
  await expect(page.getByLabel("Комментарий", { exact: true })).toHaveValue(
    "Новый комментарий",
  );
});
