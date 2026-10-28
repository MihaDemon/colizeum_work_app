import { createHmac } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

// This optional suite writes to a deliberately isolated stack seeded by frontend/tests/fixtures/seed_stack.py.
// It never calls Telegram. Run with STACK_BASE_URL=http://127.0.0.1:18080 --project=desktop.
test.skip(
  !process.env.STACK_BASE_URL,
  "Requires an isolated Docker stack and test staff seed.",
);
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==",
  "base64",
);
function telegramData(id: number) {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id }),
  };
  const secret = createHmac("sha256", "WebAppData")
    .update("123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    .digest();
  fields.hash = createHmac("sha256", secret)
    .update(
      Object.entries(fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    )
    .digest("hex");
  return new URLSearchParams(fields).toString();
}
async function session(browser: Browser, id: number) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.route("https://telegram.org/**", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await context.addInitScript((initData) => {
    let back = () => {};
    const app = {
      initData,
      initDataUnsafe: { user: { id: 1, first_name: "Stack" } },
      colorScheme: "dark",
      themeParams: {},
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
        onClick(fn: () => void) {
          back = fn;
        },
        offClick() {},
      },
      HapticFeedback: { notificationOccurred() {}, selectionChanged() {} },
      showScanQrPopup() {},
      closeScanQrPopup() {},
    };
    Object.defineProperty(window, "Telegram", { value: { WebApp: app } });
    Object.defineProperty(window, "stackBack", { value: () => back() });
  }, telegramData(id));
  const page = await context.newPage();
  const login = page.waitForResponse((response) =>
    response.url().endsWith("/api/telegram/telegram/"),
  );
  await page.goto(process.env.STACK_BASE_URL!);
  await expect(page.locator(".cp-bottom-nav")).toBeVisible();
  const token = (await (await login).json()).token as string;
  return { page, context, headers: { Authorization: `Token ${token}` } };
}
async function task(page: Page, title: string) {
  await page.getByRole("button", { name: new RegExp(title) }).click();
}
async function evidence(page: Page, label: string) {
  await page
    .getByLabel(label, { exact: true })
    .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: image });
  await expect(
    page.getByRole("img", { name: label, exact: true }),
  ).toBeVisible();
}

test("real nginx, PostgreSQL, Django, and Mini App complete the staff workflows", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const admin = await session(browser, 91001);
  const manager = await session(browser, 91002);
  const owner = await session(browser, 91003);
  let currentScheduleId = "";
  try {
    await owner.page.getByRole("button", { name: "Ещё", exact: true }).click();
    const overviewResponse = owner.page.waitForResponse((response) =>
      response.url().endsWith("/api/schedules/"),
    );
    await owner.page
      .getByRole("button", { name: "График смен", exact: true })
      .click();
    currentScheduleId = (await (await overviewResponse).json()).current.id;
    await owner.page
      .getByText("Администратор по умолчанию", { exact: true })
      .click();
    await owner.page
      .getByLabel("Администратор по умолчанию", { exact: true })
      .selectOption({ label: "Stack Administrator" });
    await owner.page
      .getByRole("button", { name: "Сохранить сотрудника по умолчанию" })
      .click();
    await expect(
      owner.page.getByText("Администратор по умолчанию сохранён."),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: "Следующий", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Редактировать график" })
      .click();
    await owner.page.getByText("Автозаполнение 2/2", { exact: true }).click();
    await owner.page.getByRole("button", { name: "Заполнить 2/2" }).click();
    await expect(owner.page.getByRole("status")).toContainText(
      "Недостающие позиции",
    );
    await owner.page
      .getByRole("button", { name: "Сохранить график", exact: true })
      .click();
    await expect(owner.page.getByLabel("Версия графика")).toBeVisible();
    await owner.page
      .getByRole("button", { name: "Текущий", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Редактировать график" })
      .click();
    const scheduleDay = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Moscow",
    }).format(new Date());
    await owner.page
      .getByRole("button", { name: `${scheduleDay} Ночь`, exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Сохранить график", exact: true })
      .click();
    await expect(owner.page.getByLabel("Версия графика")).toBeVisible();
    await owner.page
      .getByRole("navigation")
      .getByRole("button", { name: "Задачи", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "Фотографии отчёта", exact: true })
      .click();
    await manager.page
      .getByLabel("Название фотографии 1", { exact: true })
      .fill("Front desk");
    await manager.page
      .getByLabel("Название фотографии 3", { exact: true })
      .fill("Gaming hall");
    await manager.page
      .getByLabel("Обязательное фото 3", { exact: true })
      .check();
    await manager.page
      .getByRole("button", { name: "Сохранить требования к фото", exact: true })
      .click();
    await expect(manager.page.getByRole("status")).toContainText(
      "Требования к фотографиям отчёта сохранены",
    );
    await manager.page
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "Уведомления", exact: true })
      .click();
    await manager.page.getByLabel("Открытие смены", { exact: true }).uncheck();
    await manager.page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(manager.page.getByText("Настройки сохранены.", { exact: true })).toBeVisible();
    const preferences = await manager.context.request.get(
      `${process.env.STACK_BASE_URL}/api/notification-settings/`,
      { headers: manager.headers },
    );
    expect(preferences.ok()).toBeTruthy();
    expect((await preferences.json()).shift_open).toBe(false);
    await admin.page.reload();
    await admin.page
      .getByRole("button", { name: "Открыть смену", exact: true })
      .click();
    await admin.page.getByRole("radio", { name: /Ночная смена/ }).check();
    await admin.page
      .getByRole("button", { name: "Открыть смену", exact: true })
      .click();
    await expect(
      admin.page.getByRole("button", { name: "Закрыть смену", exact: true }),
    ).toBeVisible();
    admin.page.once("dialog", (dialog) => dialog.accept());
    await admin.page
      .getByRole("button", { name: "Уборщица", exact: true })
      .click();
    await expect(
      admin.page.getByRole("button", { name: /Уборщица · отмечено/ }),
    ).toBeDisabled();
    await manager.page.reload();
    await manager.page
      .getByRole("button", { name: "Создать задачу", exact: true })
      .click();
    await manager.page
      .getByLabel("Название задачи", { exact: true })
      .fill("Stack clean desk");
    await manager.page
      .getByLabel("Инструкции к задаче", { exact: true })
      .fill("Clean desk and attach proof");
    await manager.page
      .getByLabel("Требования к фото задачи", { exact: true })
      .selectOption("named");
    for (const [index, label] of [
      "Before cleaning",
      "After cleaning",
    ].entries()) {
      await manager.page
        .getByRole("button", { name: "Добавить поле для фото", exact: true })
        .click();
      await manager.page
        .getByLabel(`Название фотографии ${index + 1}`, { exact: true })
        .fill(label);
    }
    await manager.page
      .getByRole("button", { name: "Назначить задачу", exact: true })
      .click();
    await expect(
      manager.page.getByRole("heading", { name: "Задачи", exact: true }),
    ).toBeVisible();
    await admin.page.reload();
    await task(admin.page, "Stack clean desk");
    await evidence(admin.page, "Before cleaning");
    await evidence(admin.page, "After cleaning");
    await admin.page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect(admin.page.locator(".cp-review-notice")).toContainText(
      "На проверке",
    );
    await manager.page.reload();
    await manager.page
      .getByRole("button", { name: "Поставленные мной", exact: true })
      .click();
    await task(manager.page, "Stack clean desk");
    await expect(
      manager.page.getByRole("img", { name: "Before cleaning", exact: true }),
    ).toBeVisible();
    await expect(
      manager.page.getByRole("img", { name: "After cleaning", exact: true }),
    ).toBeVisible();
    await manager.page
      .getByRole("button", { name: "Отклонить задачу", exact: true })
      .click();
    await manager.page
      .getByPlaceholder("Объясните, что администратору нужно исправить…")
      .fill("Clean the corners too");
    await manager.page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    await expect(manager.page.locator(".cp-rework")).toContainText(
      "Clean the corners too",
    );
    await admin.page.reload();
    await task(admin.page, "Stack clean desk");
    await admin.page
      .getByLabel("Комментарий к выполнению")
      .fill("Corners cleaned");
    await admin.page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect(admin.page.locator(".cp-review-notice")).toBeVisible();
    await manager.page.reload();
    await manager.page
      .getByRole("button", { name: "Поставленные мной", exact: true })
      .click();
    await task(manager.page, "Stack clean desk");
    await manager.page
      .getByRole("button", { name: "Принять задачу", exact: true })
      .click();
    await expect(
      manager.page.getByRole("heading", { name: "Задачи", exact: true }),
    ).toBeVisible();
    await admin.page.reload();
    await expect(
      admin.page.getByRole("button", { name: /Stack clean desk/ }),
    ).toHaveCount(0);
    await admin.page
      .getByRole("button", { name: "Добавить расход", exact: true })
      .click();
    await admin.page.getByLabel("Сумма расхода", { exact: true }).fill("50");
    await admin.page
      .getByLabel("Описание расхода", { exact: true })
      .fill("Cleaning supplies");
    await admin.page
      .getByRole("button", { name: "Сохранить расход", exact: true })
      .click();
    await expect(admin.page.getByText("950 ₽", { exact: true })).toBeVisible();
    await admin.page
      .getByRole("button", { name: "Закрыть смену", exact: true })
      .click();
    await expect(admin.page.locator(".cp-closing-shift")).toContainText(
      "Ночная смена",
    );
    await admin.page.getByLabel("Наличные: сумма", { exact: true }).fill("100");
    await admin.page.getByLabel("Карта: сумма", { exact: true }).fill("200");
    await admin.page.getByLabel("СБП: сумма", { exact: true }).fill("300");
    await evidence(admin.page, "Front desk");
    await evidence(admin.page, "Чек закрытия смены");
    await evidence(admin.page, "Gaming hall");
    await admin.page
      .getByRole("button", { name: "Закрыть смену", exact: true })
      .click();
    await expect(
      admin.page.getByRole("button", { name: "Открыть смену", exact: true }),
    ).toBeVisible();
    await manager.page.reload();
    await expect(
      manager.page.getByText("1\u00a0050 ₽", { exact: true }),
    ).toBeVisible();
    await expect(
      manager.page.getByRole("button", {
        name: "История смен/задач",
        exact: true,
      }),
    ).toHaveCount(0);
    await manager.page
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "История смен/задач", exact: true })
      .click();
    await expect(manager.page.locator(".cp-history-total")).toContainText(
      "600 ₽",
    );
    await manager.page.locator(".cp-history-row summary").click();
    await expect(
      manager.page.getByRole("img", {
        name: "Чек закрытия смены",
        exact: true,
      }),
    ).toBeVisible();
    await manager.page.screenshot({
      path: info.outputPath("real-shift-history.png"),
      fullPage: true,
    });
    await owner.page.reload();
    await expect(
      owner.page.getByRole("button", { name: "Мои задачи", exact: true }),
    ).toHaveCount(0);
    await owner.page
      .getByRole("button", { name: "Создать задачу", exact: true })
      .click();
    await owner.page
      .getByLabel("Название задачи", { exact: true })
      .fill("Stack management report");
    await owner.page
      .getByLabel("Инструкции к задаче", { exact: true })
      .fill("Review the revenue summary");
    await owner.page
      .getByLabel("Исполнитель", { exact: true })
      .selectOption({ label: "Stack Manager · Управляющий" });
    await owner.page
      .getByRole("button", { name: "Назначить задачу", exact: true })
      .click();
    await expect(
      owner.page.getByRole("heading", { name: "Задачи", exact: true }),
    ).toBeVisible();
    await manager.page.reload();
    await task(manager.page, "Stack management report");
    await manager.page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect(manager.page.locator(".cp-review-notice")).toBeVisible();
    await owner.page.reload();
    await task(owner.page, "Stack management report");
    await owner.page
      .getByRole("button", { name: "Принять задачу", exact: true })
      .click();
    await expect(
      owner.page.getByRole("heading", { name: "Задачи", exact: true }),
    ).toBeVisible();
    await owner.page.goto(
      `${process.env.STACK_BASE_URL}/?cleaner=${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }).slice(0, 7)}`,
    );
    await expect(owner.page.getByText(/Уборщица пришла/)).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: "Открыть смену", exact: true }),
    ).toHaveCount(0);
    await owner.page.goto(`${process.env.STACK_BASE_URL}/?expense=1`);
    await expect(
      owner.page.getByRole("heading", { name: "Расход из кассы" }),
    ).toBeVisible();
    await expect(
      owner.page.getByText("Cleaning supplies", { exact: true }),
    ).toBeVisible();
    await owner.page.goto(
      `${process.env.STACK_BASE_URL}/?schedule=${currentScheduleId}`,
    );
    await owner.page
      .getByRole("button", { name: `${scheduleDay} Ночь`, exact: true })
      .click();
    await expect(owner.page.getByLabel("Детали ячейки графика")).toContainText(
      "План при открытии: Stack Administrator · версия 2",
    );
    await expect(owner.page.getByLabel("Детали ячейки графика")).toContainText(
      "Фактически: Stack Administrator",
    );

    // Telegram opt-out never removes the event from the application's feed.
    await manager.page.goto(process.env.STACK_BASE_URL!);
    await manager.page
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "Уведомления", exact: true })
      .click();
    await expect(
      manager.page.getByLabel("Открытие смены", { exact: true }),
    ).not.toBeChecked();
    await expect(
      manager.page
        .locator(".cp-notification")
        .filter({ hasText: "Смена открыта" }),
    ).toBeVisible();

    // Correct the real singleton register from the amount shown in the Mini App.
    await owner.page.goto(process.env.STACK_BASE_URL!);
    await owner.page
      .getByRole("button", { name: /Изменить остаток кассы:/ })
      .click();
    await owner.page.getByLabel("Новый остаток кассы, ₽").fill("1500,75");
    await owner.page
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: /Изменить остаток кассы:.*1\s500,75/,
      }),
    ).toBeVisible();
    const cash = await owner.context.request.get(
      `${process.env.STACK_BASE_URL}/api/cash-register/`,
      { headers: owner.headers },
    );
    expect(cash.ok()).toBeTruthy();
    expect((await cash.json()).balance).toBe("1500.75");

    // Create an allowlisted administrator, register normally, then edit/disable
    // and re-enable that account without disturbing this suite's active users.
    await owner.page.getByRole("button", { name: "Ещё", exact: true }).click();
    await owner.page
      .getByRole("button", { name: "Персонал", exact: true })
      .click();
    await owner.page
      .getByRole("button", { name: "Добавить сотрудника" })
      .click();
    await owner.page.getByLabel("Имя", { exact: true }).fill("Stack");
    await owner.page.getByLabel("Фамилия", { exact: true }).fill("Extra");
    await owner.page
      .getByLabel("Телефон", { exact: true })
      .fill("+7 999 000-00-04");
    await owner.page.getByLabel("Роль", { exact: true }).selectOption("admin");
    await owner.page
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    const employee = owner.page
      .locator(".cp-personnel-row")
      .filter({ hasText: "Stack Extra" });
    await expect(employee).toContainText("Ожидает регистрации");
    const bound = await owner.context.request.post(
      `${process.env.STACK_BOT_BASE_URL}/api/bot/contact/`,
      {
        headers: { "X-Bot-Service-Token": "integration-test-only-bot-service" },
        data: { telegram_id: "91004", phone_number: "9990000004" },
      },
    );
    expect(bound.ok()).toBeTruthy();
    const registration = await owner.context.request.post(
      `${process.env.STACK_BASE_URL}/api/telegram/telegram/`,
      {
        data: {
          initData: telegramData(91004),
          username: "stack_extra",
          phone_number: "9990000004",
        },
      },
    );
    expect(registration.status()).toBe(201);
    const extraToken = (await registration.json()).token as string;
    await owner.page.reload();
    await owner.page.getByRole("button", { name: "Ещё", exact: true }).click();
    await owner.page
      .getByRole("button", { name: "Персонал", exact: true })
      .click();
    await employee.click();
    await owner.page
      .getByLabel("Фамилия", { exact: true })
      .fill("Extra edited");
    await owner.page
      .getByLabel("Роль", { exact: true })
      .selectOption("manager");
    await owner.page.getByRole("checkbox", { name: /^Активен/ }).uncheck();
    await owner.page
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    const editedEmployee = owner.page
      .locator(".cp-personnel-row")
      .filter({ hasText: "Stack Extra edited" });
    await expect(editedEmployee).toContainText("Управляющий · Отключён");
    const disabledSession = await owner.context.request.get(
      `${process.env.STACK_BASE_URL}/api/workspace/`,
      { headers: { Authorization: `Token ${extraToken}` } },
    );
    expect(disabledSession.status()).toBe(401);
    const disabledLogin = await owner.context.request.post(
      `${process.env.STACK_BASE_URL}/api/telegram/telegram/`,
      { data: { initData: telegramData(91004) } },
    );
    expect(disabledLogin.status()).toBe(403);
    await editedEmployee.click();
    await owner.page.getByRole("checkbox", { name: /^Активен/ }).check();
    await owner.page
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(editedEmployee).toContainText("Управляющий · Активен");
    const enabledLogin = await owner.context.request.post(
      `${process.env.STACK_BASE_URL}/api/telegram/telegram/`,
      { data: { initData: telegramData(91004) } },
    );
    expect(enabledLogin.status()).toBe(200);
    const enabledToken = (await enabledLogin.json()).token as string;
    const updatedAccount = await owner.context.request.get(
      `${process.env.STACK_BASE_URL}/api/telegram/me/`,
      { headers: { Authorization: `Token ${enabledToken}` } },
    );
    expect(await updatedAccount.json()).toMatchObject({
      first_name: "Stack",
      last_name: "Extra edited",
      is_staff: true,
      is_active: true,
    });

    // Inspect persisted jobs through Django Admin; the isolated stack has no
    // Telegram worker and these assertions never contact the Telegram API.
    const jobs = await owner.context.newPage();
    try {
      await jobs.goto(`${process.env.STACK_BASE_URL}/admin/login/`);
      await jobs.locator("#id_username").fill("stack_owner");
      await jobs.locator("#id_password").fill("isolated-stack-test-password");
      await jobs.locator('input[type="submit"]').click();
      await jobs.goto(
        `${process.env.STACK_BASE_URL}/admin/workflows/telegramnotification/?kind__exact=task_assigned`,
      );
      await expect(jobs.locator("#result_list tbody tr")).toHaveCount(2);
      await expect(jobs.locator("#result_list .field-recipient")).toContainText(
        ["stack_manager", "stack_admin"],
      );
      await expect(jobs.locator("#result_list .field-status")).toContainText([
        "Ожидает отправки",
        "Ожидает отправки",
      ]);
      await jobs.goto(
        `${process.env.STACK_BASE_URL}/admin/workflows/telegramnotification/?kind__exact=shift_open`,
      );
      await expect(
        jobs
          .locator("#result_list tbody tr")
          .filter({ hasText: "stack_manager" }),
      ).toContainText("Отключено получателем");
      await expect(
        jobs
          .locator("#result_list tbody tr")
          .filter({ hasText: "stack_owner" }),
      ).toContainText("Ожидает отправки");
    } finally {
      await jobs.close();
    }
  } finally {
    await admin.context.close();
    await manager.context.close();
    await owner.context.close();
  }
});
