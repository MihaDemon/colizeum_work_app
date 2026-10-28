import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const namedFields = [
  { id: "before", label: "Before cleaning", required: true },
  { id: "after", label: "After cleaning", required: true },
];

test("superuser personnel creates and edits manager activity", async ({
  page,
}, info) => {
  await setup(page, { owner: true });
  const employees: Record<string, unknown>[] = [];
  await page.route("**/api/personnel/**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { results: employees } });
    const body = route.request().postDataJSON();
    if (route.request().method() === "POST") {
      const employee = { ...body, id: body.phone_number, registered: false };
      employees.push(employee);
      return route.fulfill({ status: 201, json: employee });
    }
    Object.assign(employees[0], body);
    return route.fulfill({ json: employees[0] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Персонал", exact: true }).click();
  await page.getByRole("button", { name: "Добавить сотрудника" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Мария");
  await page.getByLabel("Фамилия", { exact: true }).fill("Иванова");
  await page.getByLabel("Телефон", { exact: true }).fill("9991234567");
  await page.getByLabel("Роль", { exact: true }).selectOption("manager");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("button", { name: /Мария Иванова/ }).click();
  await page.getByLabel("Фамилия", { exact: true }).fill("Петрова");
  await page.getByRole("checkbox", { name: /Активен/ }).uncheck();
  await page.screenshot({
    path: info.outputPath("personnel-edit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Мария Петрова/ }),
  ).toContainText("Отключён");
  expect(employees[0]).toMatchObject({ role: "manager", is_active: false });
});

test("superusers have no new task notification setting", async ({ page }) => {
  await setup(page, { owner: true });
  await page.route("**/api/notification-settings/", (route) =>
    route.fulfill({
      json: {
        task: true,
        shift_open: true,
        shift_close: true,
        expense: true,
        cleaner: true,
        schedule: true,
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Задачи на проверке", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Новые задачи", exact: true }),
  ).toHaveCount(0);
});

test("management Telegram preferences persist while app events remain", async ({
  page,
}, info) => {
  await setup(page, { staff: true, events: true });
  let preferences = {
    task_assigned: true,
    task: true,
    shift_open: true,
    shift_close: true,
    expense: true,
    cleaner: true,
    schedule: true,
  };
  await page.route("**/api/notification-settings/", async (route) => {
    if (route.request().method() === "PATCH")
      preferences = { ...preferences, ...route.request().postDataJSON() };
    return route.fulfill({ json: preferences });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Открытие смены", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Новые задачи", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(
    page.getByText("Настройки сохранены.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("notification-preferences.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Ещё", exact: true })
    .click();
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Открытие смены", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Закрытие смены", exact: true }),
  ).toBeChecked();
});

test("superuser edits cash by tapping balance with stale amount safeguard", async ({
  page,
}, info) => {
  await setup(page, { owner: true, noShift: true });
  let attempts = 0;
  await page.route("**/api/cash-adjustment/", async (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: {
          detail:
            "Остаток кассы изменился. Обновите данные и повторите исправление.",
        },
      });
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Изменить остаток кассы/ }).click();
  await page.getByLabel("Новый остаток кассы, ₽").fill("1250,50");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await expect(page.getByLabel("Новый остаток кассы, ₽")).toHaveValue(
    "1250,50",
  );
  await page.screenshot({
    path: info.outputPath("cash-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Остаток кассы изменился",
  );
  await expect(page.getByLabel("Новый остаток кассы, ₽")).toHaveValue(
    "1250,50",
  );
  await page.getByRole("button", { name: "Обновить данные" }).click();
  await page.getByRole("button", { name: /Изменить остаток кассы/ }).click();
  await page.getByLabel("Новый остаток кассы, ₽").fill("1250,50");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Изменить остаток кассы/ }),
  ).toContainText("1 250,50 ₽");
});

for (const staff of [false, true]) {
  test(`personnel and cash editing are exclusive to superusers, staff=${staff}`, async ({
    page,
  }) => {
    await setup(page, { staff });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Изменить остаток кассы/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Персонал", exact: true }),
    ).toHaveCount(0);
    if (!staff) {
      await page
        .getByRole("button", { name: "Уведомления", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Сообщения в Telegram" }),
      ).toHaveCount(0);
    }
  });
}

test("Russian monetary inputs accept decimal commas and send numeric API values", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page
    .getByRole("button", { name: "Добавить расход", exact: true })
    .click();
  await page.getByLabel("Сумма расхода", { exact: true }).fill("125,50");
  await page
    .getByLabel("Описание расхода", { exact: true })
    .fill("Средства для уборки");
  await expect(page.locator(".cp-form-total")).toContainText("874,50 ₽");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/shift-expenses/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  expect((await sent).postData()).toContain("125.50");
});

test("administrators have neither logout nor report photo settings", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /sign out|log out|logout/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Фотографии отчёта", exact: true }),
  ).toHaveCount(0);
});

test("cleaner arrival requires acceptance and is disabled after saving and reload", async ({
  page,
}, info) => {
  await setup(page);
  await page.goto("/");
  const button = page.getByRole("button", { name: "Уборщица", exact: true });
  let sent = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/cleaner/")) sent += 1;
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await button.click();
  await expect(button).toBeEnabled();
  expect(sent).toBe(0);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("один раз за смену");
    return dialog.accept();
  });
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/cleaner/"),
  );
  await button.click();
  expect((await request).postData()).toContain('name="confirmed"\r\n\r\ntrue');
  await expect(
    page.getByRole("button", { name: /Уборщица · отмечено/ }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Уборщица · отмечено/ }),
  ).toBeDisabled();
  expect(sent).toBe(1);
  await page.screenshot({
    path: info.outputPath("cleaner-arrival.png"),
    fullPage: true,
  });
});

for (const options of [{ noShift: true }, { staff: true }, { owner: true }]) {
  test(`cleaner arrival button is unavailable without own administrator shift ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    await setup(page, options);
    await page.goto("/");
    await expect(page.locator(".cp-bottom-nav")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Уборщица", exact: true }),
    ).toHaveCount(0);
  });
}

test("administrators cannot open cleaner history from More or a direct link", async ({
  page,
}) => {
  await setup(page);
  let historyRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/cleaner-visits/")) historyRequests += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Уборщица", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "История смен/задач", exact: true }),
  ).toBeVisible();
  await page.goto("/?cleaner=2026-10");
  await expect(page.getByRole("alert")).toContainText(
    "только управляющим и суперпользователям",
  );
  await expect(page.getByLabel("Месяц и год")).toHaveCount(0);
  expect(historyRequests).toBe(0);
});

test("cleaner history filters month and shows only date time and administrator", async ({
  page,
}, info) => {
  await setup(page, { staff: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Уборщица", exact: true }).click();
  await page.getByLabel("Месяц и год", { exact: true }).fill("2026-09");
  await expect(
    page.getByRole("button", { name: "Уборщица", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("За этот месяц отметок нет")).toBeVisible();
  await page.getByLabel("Месяц и год", { exact: true }).fill("2025-10");
  await expect(page.getByText("За этот месяц отметок нет")).toBeVisible();
  await page.getByLabel("Месяц и год", { exact: true }).fill("2026-10");
  await expect(page.locator(".cp-month-value")).toContainText("октябрь 2026");
  await expect(page.getByText("Уборщица пришла 28/10/26 12:34")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("cleaner-history.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".cp-cleaner-record")).toContainText(
    "Алексей Смирнов",
  );
});

test("Telegram notification links open closed shift, expense and cleaner history", async ({
  page,
}) => {
  await setup(page, { owner: true });
  await page.goto("/?shift=1");
  await expect(
    page.getByRole("heading", { name: "Детали смены" }),
  ).toBeVisible();
  await expect(page.getByText("Закрыта: 28.10.2026 в 10:00")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Чек закрытия смены", exact: true }),
  ).toBeVisible();
  await page.goto("/?expense=2");
  await expect(
    page.getByRole("heading", { name: "Расход из кассы" }),
  ).toBeVisible();
  await expect(
    page.getByText("Средства для уборки", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Чек расхода", exact: true }),
  ).toBeVisible();
  await page.goto("/?cleaner=2026-10");
  await expect(page.getByText("Уборщица пришла 28/10/26 12:34")).toBeVisible();
  await page.goto("/?shift=404");
  await expect(page.getByRole("alert")).toContainText("Запись недоступна");
});

for (const owner of [false, true]) {
  test(`${owner ? "superusers" : "managers"} can configure named report photos in More`, async ({
    page,
  }, info) => {
    await setup(page, { staff: !owner, owner });
    await page.goto("/");
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /sign out|log out|logout/i }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Фотографии отчёта", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Удалить поле для фото 3", exact: true })
      .click();
    await page
      .getByLabel("Название фотографии 1", { exact: true })
      .fill("Reception desk");
    await page
      .getByLabel("Название фотографии 2", { exact: true })
      .fill("Gaming hall");
    await page.getByLabel("Обязательное фото 2", { exact: true }).uncheck();
    await page.screenshot({
      path: info.outputPath("report-photo-settings.png"),
      fullPage: true,
    });
    const sent = page.waitForRequest(
      (r) => r.url().endsWith("/api/photo-settings/") && r.method() === "POST",
    );
    await page
      .getByRole("button", { name: "Сохранить требования к фото", exact: true })
      .click();
    const data = (await sent).postData()!;
    expect(data).toContain('"label":"Reception desk","required":true');
    expect(data).toContain('"label":"Gaming hall","required":false');
    await expect(page.getByRole("status")).toContainText(
      "Требования к фотографиям отчёта сохранены",
    );
    await expect(
      page.getByLabel("Название фотографии 1", { exact: true }),
    ).toHaveValue("Reception desk");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("closing a shift uses its configured named fields", async ({ page }) => {
  await setup(page, {
    reportFields: [
      { id: "reception", label: "Reception desk", required: true },
      { id: "hall", label: "Gaming hall", required: false },
    ],
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await expect(
    page.getByLabel("Стол администратора", { exact: true }),
  ).toHaveCount(0);
  for (const label of ["Наличные: сумма", "Карта: сумма", "СБП: сумма"])
    await page.getByLabel(label, { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("обязательные поля");
  await page
    .getByLabel("Reception desk", { exact: true })
    .setInputFiles({ name: "desk.png", mimeType: "image/png", buffer: photo });
  await expect(
    page.getByRole("img", { name: "Reception desk", exact: true }),
  ).toBeVisible();
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/api/shifts/shift-1/close/"),
  );
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  expect((await sent).postData()).toContain('["reception"]');
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
});

test("task creation supports specified photo fields", async ({
  page,
}, info) => {
  await setup(page, { staff: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Clean reception");
  await page
    .getByLabel("Инструкции к задаче", { exact: true })
    .fill("Clean and attach before/after photos.");
  await page
    .getByLabel("Требования к фото задачи", { exact: true })
    .selectOption("named");
  for (let index = 0; index < namedFields.length; index += 1) {
    await page
      .getByRole("button", { name: "Добавить поле для фото", exact: true })
      .click();
    await page
      .getByLabel(`Название фотографии ${index + 1}`, { exact: true })
      .fill(namedFields[index].label);
  }
  await page.screenshot({
    path: info.outputPath("task-photo-settings.png"),
    fullPage: true,
  });
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/tasks/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить задачу", exact: true })
    .click();
  const body = (await sent).postData()!;
  expect(body).toContain('name="photo_mode"\r\n\r\nnamed');
  expect(body).toContain('"label":"Before cleaning","required":true');
  expect(body).toContain('"label":"After cleaning","required":true');
});

test("deleted employees remain in history and cannot receive new tasks", async ({
  page,
}) => {
  await setup(page, { owner: true, deletedManager: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  const assignees = page.getByLabel("Исполнитель", { exact: true });
  await expect(assignees.locator("option")).toHaveCount(1);
  await expect(assignees).toContainText("Администратор смены");
  await expect(assignees).not.toContainText("удалён");
});

test("tasks from deleted managers go to superuser moderation", async ({
  page,
}) => {
  await setup(page, { deletedManager: true });
  await page.goto("/");
  await page.getByRole("button", { name: /Убрать игровые места/ }).click();
  await page.getByLabel("Фото выполнения", { exact: true }).setInputFiles({
    name: "done.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect(page.locator(".cp-review-notice")).toContainText(
    "Задачу проверит суперпользователь",
  );
  await expect(page.getByRole("status")).toContainText(
    "Задача отправлена на проверку суперпользователю",
  );
});

test("named task uploads enforce every required field and show all moderation photos", async ({
  page,
}, info) => {
  await setup(page, { photoMode: "named", taskPhotoFields: namedFields });
  await page.goto("/");
  await page.getByRole("button", { name: /Убрать игровые места/ }).click();
  await page.getByLabel("Before cleaning", { exact: true }).setInputFiles({
    name: "before.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await expect(
    page.getByRole("img", { name: "Before cleaning", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("After cleaning");
  await page
    .getByLabel("After cleaning", { exact: true })
    .setInputFiles({ name: "after.png", mimeType: "image/png", buffer: photo });
  await expect(
    page.getByRole("img", { name: "After cleaning", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("named-task-upload.png"),
    fullPage: true,
  });
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/api/tasks/task-1/submit/"),
  );
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  expect((await sent).postData()).toContain('["before","after"]');
  await expect(page.locator(".cp-review-notice")).toContainText("На проверке");
  await expect(
    page.getByRole("img", { name: "Before cleaning", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "After cleaning", exact: true }),
  ).toBeVisible();
});

test("multiple unspecified task photos can be selected together", async ({
  page,
}) => {
  await setup(page, { photoMode: "multiple" });
  await page.goto("/");
  await page.getByRole("button", { name: /Убрать игровые места/ }).click();
  await page
    .getByLabel("Фотографии выполнения", { exact: true })
    .setInputFiles([
      { name: "one.png", mimeType: "image/png", buffer: photo },
      { name: "two.png", mimeType: "image/png", buffer: photo },
    ]);
  await expect(
    page.getByRole("img", { name: "Фото выполнения 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Фото выполнения 2", exact: true }),
  ).toBeVisible();
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/api/tasks/task-1/submit/"),
  );
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  expect((await sent).postData()?.match(/name="photos"/g)).toHaveLength(2);
  await expect(page.locator(".cp-review-notice")).toContainText("На проверке");
});

const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==",
  "base64",
);
const user = {
  id: 1,
  username: "shift_admin",
  first_name: "Алексей",
  last_name: "Смирнов",
  is_staff: false,
  is_active: true,
  phone_number: "9990000000",
  last_login: null,
};
const report = {
  id: 1,
  shift: "day",
  date: "2026-10-12",
  admin: 1,
  cards: "32000.00",
  spb: "12500.00",
  cash: "7000.00",
  info: "Смена завершена, оборудование проверено",
  photos: [{ id: 1, image: "/media/report.png" }],
};
const station = {
  id: 1,
  club_number: 12,
  mouse: null,
  keyboard: null,
  headset: null,
  monitor: null,
  pc: null,
  info: "",
  detail_url: "/api/stations/lookup/?club_number=12",
  qr_code_url: "/api/stations/1/qr-code/",
};

async function setup(
  page: Page,
  options: {
    newUser?: boolean;
    staff?: boolean;
    theme?: string;
    failure?: boolean;
    noShift?: boolean;
    contactShared?: boolean;
    owner?: boolean;
    deletedManager?: boolean;
    reportFields?: { id: string; label: string; required: boolean }[];
    photoMode?: "single" | "multiple" | "named";
    taskPhotoFields?: { id: string; label: string; required: boolean }[];
    events?: boolean;
  } = {},
) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.addInitScript(
    ({ theme, contactShared }) => {
      const app = {
        initData: "signed-telegram-test-data",
        initDataUnsafe: { user: { id: 42, first_name: "Алексей" } },
        colorScheme: theme,
        themeParams: {},
        safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        ready() {},
        expand() {},
        isVersionAtLeast() {
          return true;
        },
        setHeaderColor() {},
        setBackgroundColor() {},
        setBottomBarColor() {},
        onEvent() {},
        offEvent() {},
        enableClosingConfirmation() {},
        disableClosingConfirmation() {},
        BackButton: {
          show() {},
          hide() {},
          onClick(callback: () => void) {
            (window as unknown as { testBack: () => void }).testBack = callback;
          },
          offClick() {},
        },
        HapticFeedback: { notificationOccurred() {}, selectionChanged() {} },
        showScanQrPopup(_options: unknown, callback: (text: string) => void) {
          callback(
            "https://internal.example/api/stations/lookup/?club_number=12",
          );
        },
        closeScanQrPopup() {},
        downloadFile(file: { url: string; file_name: string }) {
          (window as unknown as { testDownload: typeof file }).testDownload =
            file;
        },
        requestContact(callback: (sent: boolean) => void) {
          callback(contactShared);
        },
      };
      Object.defineProperty(window, "Telegram", { value: { WebApp: app } });
    },
    {
      theme: options.theme || "dark",
      contactShared: options.contactShared !== false,
    },
  );
  await page.route("**/media/**", (route) =>
    route.fulfill({ contentType: "image/png", body: photo }),
  );
  let active = !options.noShift;
  let cleanerVisitedAt: string | null = null;
  let balance = 1000;
  let taskStatus = "active";
  let contactChecks = 0;
  let photoSettings = {
    reportFields: options.reportFields || [
      { id: "desk", label: "Стол администратора", required: true },
      { id: "receipt", label: "Чек закрытия смены", required: true },
      { id: "additional", label: "Дополнительное фото", required: false },
    ],
    version: 1,
  };
  let shiftFields = photoSettings.reportFields;
  let submittedPhotos: {
    id: string;
    slot: string;
    label: string;
    url: string;
  }[] = [];
  const role = options.owner
    ? "superuser"
    : options.staff
      ? "manager"
      : "admin";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.startsWith("/api/device-qr/")) {
      expect(route.request().headers().authorization).toBeUndefined();
      return route.fulfill({
        contentType: "image/png",
        headers: {
          "Content-Disposition": 'attachment; filename="station-1-qr.png"',
        },
        body: photo,
      });
    }
    if (path.endsWith("/telegram/contact-status/")) {
      expect(route.request().postDataJSON()).toEqual({
        initData: "signed-telegram-test-data",
      });
      contactChecks += 1;
      return route.fulfill({
        json:
          contactChecks > 1
            ? { verified: true, phone_number: "9991234567" }
            : { verified: false },
      });
    }
    if (path.endsWith("/telegram/telegram/")) {
      const data = route.request().postDataJSON();
      if (options.newUser && !data.username)
        return route.fulfill({
          status: 404,
          json: { require_registration: "True" },
        });
      return route.fulfill({ json: { token: "valid-token" } });
    }
    if (path.endsWith("/telegram/me/"))
      return route.fulfill({
        json: {
          ...user,
          is_staff: Boolean(options.staff || options.owner),
          is_superuser: Boolean(options.owner),
        },
      });
    expect(route.request().headers().authorization).toBe("Token valid-token");
    if (path === "/api/cash-adjustment/") {
      const data = route.request().postDataJSON();
      expect(data.expected_balance).toBe(balance.toFixed(2));
      balance = Number(data.balance);
      return route.fulfill({ json: { balance: balance.toFixed(2) } });
    }
    if (path.startsWith("/api/files/"))
      return route.fulfill({ contentType: "image/png", body: photo });
    if (path.endsWith("/photo-settings/")) {
      const data = route.request().postData() || "";
      photoSettings = {
        reportFields: JSON.parse(
          data.match(/name="report_fields"\r\n\r\n([^\r]+)/)![1],
        ),
        version: photoSettings.version + 1,
      };
      return route.fulfill({ json: photoSettings });
    }
    if (path.endsWith("/qr-download/"))
      return route.fulfill({
        json: {
          url: "https://work.example.invalid/api/device-qr/test-ticket/",
          file_name: "station-1-qr.png",
        },
      });
    if (path.endsWith("/workspace/"))
      return route.fulfill({
        status: options.failure ? 500 : 200,
        json: options.failure
          ? { detail: "Сервер недоступен" }
          : {
              user: {
                id: "1",
                name: "Алексей Смирнов",
                initials: "АС",
                role,
              },
              people: [
                {
                  id: "1",
                  name: "Алексей Смирнов",
                  initials: "АС",
                  role,
                },
                {
                  id: options.deletedManager ? "deleted-2" : "2",
                  name: options.deletedManager
                    ? "Управляющий (удалён)"
                    : "Управляющий",
                  initials: "M",
                  role: "manager",
                  deleted: options.deletedManager || undefined,
                },
                {
                  id: "3",
                  name: "Администратор смены",
                  initials: "SA",
                  role: "admin",
                },
                ...(options.deletedManager
                  ? [
                      {
                        id: "deleted-4",
                        name: "Администратор (удалён)",
                        initials: "А",
                        role: "admin",
                        deleted: true,
                      },
                    ]
                  : []),
              ],
              state: {
                photoSettings,
                shift: active
                  ? {
                      id: "shift-1",
                      adminId: role === "admin" ? "1" : "3",
                      photoRequirements: shiftFields,
                      type: "night",
                      openedAt: new Date().toISOString(),
                      cleanerVisitedAt,
                    }
                  : null,
                balance,
                expenses: [],
                activity: options.events
                  ? [
                      {
                        id: "event-1",
                        title: "Смена открыта",
                        description: "Дневная смена",
                        time: "2026-10-28T10:00:00+03:00",
                        kind: "shift",
                        actorId: "3",
                      },
                    ]
                  : [],
                shifts: [],
                tasks: [
                  {
                    id: "task-1",
                    title: "Убрать игровые места",
                    description: "Wipe keyboards",
                    adminId: "1",
                    managerId: options.deletedManager ? "deleted-2" : "2",
                    requiresPhoto: true,
                    photoMode: options.photoMode || "single",
                    photoRequirements: options.taskPhotoFields || [],
                    photos: submittedPhotos,
                    priority: "normal",
                    status: taskStatus,
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            },
      });
    if (path.endsWith("/shifts/shift-1/cleaner/"))
      cleanerVisitedAt = "2026-10-28T13:45:00+03:00";
    if (path === "/api/cleaner-visits/") {
      const period = new URL(route.request().url()).searchParams;
      return route.fulfill({
        json: {
          results:
            period.get("year") === "2026" && period.get("month") === "10"
              ? [
                  {
                    id: "visit-1",
                    shiftId: "1",
                    adminName: "Алексей Смирнов",
                    occurredAt: "2026-10-28T12:34:00+03:00",
                  },
                  ...(cleanerVisitedAt
                    ? [
                        {
                          id: "visit-2",
                          shiftId: "shift-1",
                          adminName: "Алексей Смирнов",
                          occurredAt: cleanerVisitedAt,
                        },
                      ]
                    : []),
                ]
              : [],
        },
      });
    }
    if (path === "/api/shifts/1/" && method === "GET")
      return route.fulfill({
        json: {
          id: "1",
          adminId: "3",
          adminName: "Администратор смены",
          type: "night",
          openedAt: "2026-10-27T22:00:00+03:00",
          closedAt: "2026-10-28T10:00:00+03:00",
          cash: 7000,
          cards: 32000,
          sbp: 12500,
          total: "51500.00",
          photos: { "Чек закрытия смены": "/api/files/report/1/" },
        },
      });
    if (path === "/api/shifts/404/")
      return route.fulfill({
        status: 404,
        json: { detail: "Запись недоступна." },
      });
    if (path === "/api/shift-expenses/2/" && method === "GET")
      return route.fulfill({
        json: {
          id: "2",
          adminId: "3",
          adminName: "Администратор смены",
          amount: 1250,
          description: "Средства для уборки",
          createdAt: "2026-10-28T12:00:00+03:00",
          photos: [{ url: "/api/files/expense/1/", label: "Чек расхода" }],
        },
      });
    if (path.endsWith("/shifts/open/")) {
      active = true;
      shiftFields = photoSettings.reportFields;
    }
    if (path.endsWith("/shifts/shift-1/close/")) active = false;
    if (path.endsWith("/shift-expenses/")) balance = 950;
    if (path.endsWith("/tasks/task-1/submit/")) {
      taskStatus = "moderation";
      const data = route.request().postData() || "";
      const slots: string[] = JSON.parse(
        data.match(/name="photo_slots"\r\n\r\n([^\r]+)/)![1],
      );
      submittedPhotos = slots.map((slot, index) => ({
        id: String(index + 1),
        slot,
        label:
          options.taskPhotoFields?.find((field) => field.id === slot)?.label ||
          "Фото выполнения",
        url: `/api/files/submission-photo/${index + 1}/`,
      }));
    }
    if (method === "POST" || method === "PATCH")
      return route.fulfill({ status: 201, json: report });
    if (method === "DELETE") return route.fulfill({ status: 204 });
    if (path.endsWith("/qr-code/"))
      return route.fulfill({ contentType: "image/png", body: photo });
    if (path.includes("/stations/lookup/"))
      return route.fulfill({ json: station });
    if (path.endsWith("/reports/"))
      return route.fulfill({
        status: options.failure ? 500 : 200,
        json: options.failure ? { detail: "Сервер недоступен" } : [report],
      });
    if (path.endsWith("/expenses/"))
      return route.fulfill({
        json: [
          {
            id: 2,
            date: new Date().toISOString(),
            admin: 1,
            amount: "1250.00",
            info: "Средства для уборки",
            photos: [],
          },
        ],
      });
    if (path.endsWith("/stations/")) return route.fulfill({ json: [station] });
    return route.fulfill({ json: [] });
  });
}

test("Telegram login opens the live Mini App without sample accounts", async ({
  page,
}, info) => {
  await setup(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Текущая смена" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("button"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: /Ночная смена/ }),
  ).toBeVisible();
  await expect(page.locator(".cp-profile")).toHaveText("Алексей Смирнов");
  await expect(page.locator(".cp-avatar")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("name-header.png"),
    fullPage: true,
  });
  await page.locator(".cp-profile").click();
  await expect(
    page.locator(".cp-account").getByText("Алексей Смирнов", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Preview settings", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("colizeum.design.v1")),
  ).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("new staff confirm their phone in the Mini App and register a username", async ({
  page,
}, info) => {
  await setup(page, { newUser: true });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Регистрация сотрудника" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Начать работу" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Номер телефона", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: info.outputPath("registration.png"),
    fullPage: true,
  });
  await page.getByLabel("Логин", { exact: true }).fill("new_staff");
  await page
    .getByRole("button", { name: "Подтвердить телефон Telegram", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Телефон подтверждён через Telegram.",
  );
  await expect(page.getByLabel("Номер телефона", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("9991234567", { exact: false })).toHaveCount(0);
  const sent = page.waitForRequest(
    (r) =>
      r.url().endsWith("/telegram/telegram/") &&
      Boolean(r.postDataJSON().username),
  );
  await page.getByRole("button", { name: "Начать работу" }).click();
  expect((await sent).postDataJSON()).toEqual({
    initData: "signed-telegram-test-data",
    username: "new_staff",
    phone_number: "9991234567",
  });
  await expect(
    page.getByRole("heading", { name: "Текущая смена" }),
  ).toBeVisible();
});

test("cancelled contact sharing keeps registration disabled and allows retry", async ({
  page,
}) => {
  await setup(page, { newUser: true, contactShared: false });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Подтвердить телефон Telegram", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Вы не поделились номером",
  );
  await expect(
    page.getByRole("button", { name: "Начать работу" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.Telegram!.WebApp.requestContact = (callback) => callback(true);
  });
  await page
    .getByRole("button", { name: "Подтвердить телефон Telegram", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Начать работу" }),
  ).toBeEnabled();
});

test("equipment categories, rows and details use their matching device icons", async ({
  page,
}, info) => {
  await setup(page);
  const categories = [
    ["stations", "Места", "devices-pc"],
    ["pcs", "ПК", "cpu"],
    ["mice", "Мыши", "mouse"],
    ["keyboards", "Клавиатуры", "keyboard"],
    ["headsets", "Наушники", "headphones"],
    ["monitors", "Мониторы", "device-desktop"],
    ["playstations", "PlayStation", "device-gamepad-2"],
  ];
  await page.route(
    /\/api\/(pcs|mice|keyboards|headsets|monitors|playstations)\/$/,
    (route) =>
      route.fulfill({
        json: [{ id: 1, model: "Test device", serial_number: "SN-1" }],
      }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  for (const [resource, title, icon] of categories) {
    const tab = page
      .locator(".resource-tabs")
      .getByRole("button", { name: title, exact: true });
    await expect(tab.locator(`.tabler-icon-${icon}`)).toHaveCount(1);
    await tab.click();
    const row = page
      .locator(resource === "stations" ? ".station-tile" : ".equipment-row")
      .first();
    await expect(row.locator(`.tabler-icon-${icon}`)).toHaveCount(1);
    await row.click();
    await expect(page.locator(`h1 .tabler-icon-${icon}`)).toBeVisible();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
  }
  await page.screenshot({
    path: info.outputPath("device-icons.png"),
    fullPage: true,
  });
});

test("shift opening and closing use real endpoints and fixed opening type", async ({
  page,
}) => {
  await setup(page, { noShift: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await page.getByRole("radio", { name: /Ночная смена/ }).check();
  const opened = page.waitForRequest(
    (r) => r.url().endsWith("/api/shifts/open/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  expect((await opened).postData()).toContain('name="shift_type"');
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await expect(page.locator(".cp-closing-shift")).toContainText("Ночная смена");
  await expect(page.getByRole("radio")).toHaveCount(0);
  for (const label of ["Наличные: сумма", "Карта: сумма", "СБП: сумма"])
    await page.getByLabel(label, { exact: true }).fill("10.50");
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("обязательные поля");
  for (const label of ["Стол администратора", "Чек закрытия смены"])
    await page.getByLabel(label, { exact: true }).setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
  const closed = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/shifts/shift-1/close/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  const command = await closed;
  expect(command.headers()["idempotency-key"]).toBeTruthy();
  expect(command.postData()?.match(/name="photos"/g)).toHaveLength(2);
  expect(command.postData()).toContain('["desk","receipt"]');
  expect(command.postData()).not.toContain('name="shift_type"');
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
});

test("expense requires text and submits cash deduction without a photo", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Добавить расход", exact: true })
    .click();
  await page.getByLabel("Сумма расхода", { exact: true }).fill("50");
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Укажите");
  await page
    .getByLabel("Описание расхода", { exact: true })
    .fill("Cleaning supplies");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/shift-expenses/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  expect((await sent).postData()).toContain("50.00");
  await expect(page.getByText("950 ₽", { exact: true })).toBeVisible();
});

test("task submission requires evidence and stays on moderation", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Убрать игровые места/ }).click();
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "обязательное фото выполнения",
  );
  await page
    .getByLabel("Фото выполнения", { exact: true })
    .setInputFiles({ name: "done.png", mimeType: "image/png", buffer: photo });
  const sent = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/tasks/task-1/submit/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  expect((await sent).postData()).toContain('name="photos"');
  await expect(page.locator(".cp-review-notice")).toContainText("На проверке");
  await page.evaluate(() =>
    (window as unknown as { testBack: () => void }).testBack(),
  );
  await expect(
    page.getByRole("button", { name: /Убрать игровые места/ }),
  ).toContainText("На проверке");
});

test("failed save preserves draft and retry uses the same command key", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Добавить расход", exact: true })
    .click();
  await page.getByLabel("Сумма расхода", { exact: true }).fill("50");
  await page.getByLabel("Описание расхода", { exact: true }).fill("Supplies");
  const keys: string[] = [];
  await page.route("**/api/shift-expenses/", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 503, json: { detail: "Try again" } });
  });
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(
    page.getByLabel("Описание расхода", { exact: true }),
  ).toHaveValue("Supplies");
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});

test("workspace server errors offer retry", async ({ page }) => {
  await setup(page, { failure: true });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Сервер недоступен");
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeVisible();
});
test("regular users can scan and download QR labels without equipment write controls", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Поиск оборудования", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Найти по номеру", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Сканировать QR" }).click();
  await expect(
    page.getByRole("heading", { name: "Место 12", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Изменить" })).toHaveCount(0);
  await page.getByRole("button", { name: "Показать QR-код" }).click();
  await page.getByRole("button", { name: "Скачать PNG" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              testDownload?: { url: string; file_name: string };
            }
          ).testDownload,
      ),
    )
    .toEqual({
      url: "https://work.example.invalid/api/device-qr/test-ticket/",
      file_name: "station-1-qr.png",
    });
});

test("QR browser fallback saves a real PNG attachment without an API token", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  await page.getByRole("button", { name: "Сканировать QR" }).click();
  await page.getByRole("button", { name: "Показать QR-код" }).click();
  await page.evaluate(() => {
    window.Telegram!.WebApp.downloadFile = undefined;
    window.Telegram!.WebApp.openLink = undefined;
  });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PNG" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("station-1-qr.png");
  expect(await download.failure()).toBeNull();
  expect(await readFile((await download.path())!)).toEqual(photo);
});

test("a failed QR download offers retry and keeps the device preview", async ({
  page,
}) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/stations/1/qr-download/", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: { detail: "Скачивание временно недоступно" },
        })
      : route.fallback();
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  await page.getByRole("button", { name: "Сканировать QR" }).click();
  await page.getByRole("button", { name: "Показать QR-код" }).click();
  await page.getByRole("button", { name: "Скачать PNG" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Скачивание временно недоступно",
  );
  await expect(
    page.getByRole("img", { name: "QR-код: Место 12" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Скачать PNG" }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("staff users can create equipment and light theme respects viewport", async ({
  page,
}, testInfo) => {
  await setup(page, { staff: true, theme: "light" });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("equipment-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Мыши", exact: true }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.getByLabel("Модель", { exact: true }).fill("G Pro");
  await page.getByLabel("Серийный номер", { exact: true }).fill("SN-123");
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/mice/") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    model: "G Pro",
    serial_number: "SN-123",
    warranty_until: null,
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Оборудование сохранено" }),
  ).toBeVisible();
});
test("station choices distinguish repeated models and preserve own assignments", async ({
  page,
}, testInfo) => {
  await setup(page, { staff: true });
  const mice = [1, 2, 3].map((id) => ({
    id,
    model: "G Pro",
    serial_number: `SN-00${id}`,
    info: "",
    detail_url: `/api/mice/${id}/`,
    qr_code_url: `/api/mice/${id}/qr-code/`,
  }));
  const stations = [
    { ...station, mouse: 1 },
    { ...station, id: 2, club_number: 13, mouse: 2 },
  ];
  await page.route("**/api/stations/**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: stations })
      : route.fallback(),
  );
  await page.route("**/api/mice/**", (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /\/mice\/(\d+)\/$/,
    );
    return route.fulfill({ json: match ? mice[Number(match[1]) - 1] : mice });
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Устройства", exact: true })
    .click();
  await page.getByRole("button", { name: /Место 12/ }).click();
  await expect(page.locator(".detail-list")).toContainText("G Pro · SN-001");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  const mouse = page.getByLabel("Мышь", { exact: true });
  await expect(mouse).toHaveValue("1");
  await expect(page.locator("#selected-mouse")).toHaveText("G Pro · SN-001");
  await expect(mouse.locator("option")).toHaveText([
    "Не назначено",
    "G Pro · SN-001",
    "G Pro · SN-003",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("station-edit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(
    page.getByLabel("Мышь", { exact: true }).locator("option"),
  ).toHaveText(["Не назначено", "G Pro · SN-003"]);
  await page.getByLabel("Мышь", { exact: true }).selectOption("3");
  await page.getByLabel("Номер места", { exact: true }).fill("14");
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/stations/") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    club_number: 14,
    mouse: 3,
  });
});
