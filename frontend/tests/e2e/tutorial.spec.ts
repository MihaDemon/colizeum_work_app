import { expect, test, type Page, type TestInfo } from "@playwright/test";

const guide = (page: Page) =>
  page.getByRole("complementary", { name: "Подсказка обучения" });
const next = (page: Page) =>
  guide(page).getByRole("button", { name: "Далее", exact: true }).click();
async function start(page: Page, role: "admin" | "manager" | "superuser") {
  await page.goto(`/?tutorial=${role}`);
  await page
    .getByRole("button", { name: "Начать обучение", exact: true })
    .click();
}
async function openShift(page: Page) {
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await next(page);
}
async function createTask(page: Page) {
  await page.getByRole("button", { name: "Смена проверена" }).click();
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Подготовить игровые места");
  await page
    .getByLabel("Инструкции к задаче", { exact: true })
    .fill("Протрите столы и коврики. Пришлите фото подготовленного места.");
  await page.getByLabel("Требования к фото задачи").selectOption("single");
  await page
    .getByRole("button", { name: "Назначить задачу", exact: true })
    .click();
  await next(page);
}

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("administrator completes a shift in training without any API calls", async ({
  page,
}, info) => {
  const apiCalls: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await start(page, "admin");
  await expect(
    guide(page).getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("admin-open-shift.png"),
    fullPage: true,
  });
  await openShift(page);
  await expect(
    page.getByRole("button", { name: "Закрыть смену", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Подготовить игровые места/ }).click();
  await page
    .getByRole("button", { name: "Добавить учебное фото · Фото выполнения" })
    .click();
  await expect(
    page.getByRole("img", { name: "Фото выполнения", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect(page.locator(".cp-status")).toContainText("На проверке");
  await next(page);
  await page.getByRole("button", { name: /Подготовить игровые места/ }).click();
  await expect(page.locator(".cp-rework")).toContainText("Протрите коврик");
  await page
    .getByRole("button", { name: "Заменить учебное фото · Фото выполнения" })
    .click();
  await page
    .getByLabel("Комментарий к выполнению")
    .fill("Коврик протёрт, новое фото приложено.");
  await page
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await next(page);
  await page
    .getByRole("button", { name: "Добавить расход", exact: true })
    .click();
  await page.getByLabel("Сумма расхода", { exact: true }).fill("300");
  await page
    .getByLabel("Описание расхода", { exact: true })
    .fill("Средства для уборки");
  await page
    .getByRole("button", { name: "Сохранить расход", exact: true })
    .click();
  await expect(page.locator(".cp-cash")).toContainText("4 700");
  await next(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Уборщица", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Уборщица · отмечено/ }),
  ).toBeDisabled();
  await next(page);
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await page.getByLabel("Наличные: сумма", { exact: true }).fill("1000");
  await page.getByLabel("Карта: сумма", { exact: true }).fill("2000");
  await page.getByLabel("СБП: сумма", { exact: true }).fill("500");
  await page
    .getByRole("button", {
      name: "Добавить учебное фото · Стол администратора",
    })
    .click();
  await page
    .getByRole("button", { name: "Добавить учебное фото · Чек закрытия смены" })
    .click();
  await page.screenshot({
    path: info.outputPath("admin-report.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Закрыть смену",
      exact: true,
    })
    .click();
  await expect(
    guide(page).getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled();
  await next(page);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "График смен", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "История смен/задач", exact: true })
    .click();
  await page.locator(".cp-history-row summary").click();
  await expect(
    guide(page).getByRole("button", { name: "Завершить" }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("admin-history.png"),
    fullPage: true,
  });
  await guide(page).getByRole("button", { name: "Завершить" }).click();
  await expect(
    page.getByRole("heading", { name: "Обучение пройдено" }),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

for (const role of ["manager", "superuser"] as const) {
  test(`${role} completes tasks, forced closure, reviewers, schedule and notifications without API calls`, async ({
    page,
  }, info) => {
    const apiCalls: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      apiCalls.push(route.request().url());
      return route.abort();
    });
    await start(page, role);
    await createTask(page);
    await expect(
      guide(page).getByRole("button", { name: "Результат просмотрен" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: /Подготовить игровые места/ })
      .click();
    await expect(
      page.getByRole("img", { name: "Фото выполнения", exact: true }),
    ).toBeVisible();
    await guide(page)
      .getByRole("button", { name: "Результат просмотрен" })
      .click();
    await page
      .getByRole("button", { name: /Подготовить игровые места/ })
      .click();
    await page
      .getByRole("button", { name: "Принять задачу", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("верните задачу");
    await page
      .getByRole("button", { name: "Отклонить задачу", exact: true })
      .click();
    await page
      .getByLabel("Что нужно исправить?")
      .fill("Протрите коврик и приложите новое фото.");
    await page.screenshot({
      path: info.outputPath("manager-rework.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    await next(page);
    await page
      .getByRole("button", { name: /Подготовить игровые места/ })
      .click();
    await expect(page.locator(".cp-completion-note")).toContainText(
      "фотография обновлена",
    );
    await page
      .getByRole("button", { name: "Принять задачу", exact: true })
      .click();
    await next(page);
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
    await page
      .getByRole("button", { name: /Проверить расходные материалы/ })
      .click();
    await next(page);
    await completeForcedClose(page, info);
    await completeAutomaticTasks(page, info, role === "superuser");
    await completeSchedule(page, info);
    await page
      .getByRole("button", { name: "Уведомления", exact: true })
      .click();
    const expenses = page.getByRole("checkbox", {
      name: "Расходы из кассы",
      exact: true,
    });
    await expect(expenses).toBeChecked();
    await expenses.uncheck();
    await expect(
      guide(page).getByRole("button", { name: "Далее", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Настройки сохранены");
    await next(page);
    await expect(expenses).not.toBeChecked();
    await page.reload();
    await page
      .getByRole("button", { name: "Продолжить с шага 17", exact: true })
      .click();
    await expect(expenses).not.toBeChecked();
    await expenses.check();
    await expect(
      guide(page).getByRole("button", { name: "Завершить", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(expenses).toBeChecked();
    await page.screenshot({
      path: info.outputPath("notifications-training.png"),
    });
    await guide(page).getByRole("button", { name: "Завершить" }).click();
    await expect(
      page.getByRole("heading", { name: "Обучение пройдено" }),
    ).toBeVisible();
    expect(apiCalls).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("training resumes after reload and Back restores the previous exercise", async ({
  page,
}) => {
  await start(page, "admin");
  await openShift(page);
  await page.reload();
  await page.getByRole("button", { name: "Продолжить с шага 2" }).click();
  await expect(guide(page)).toContainText("Шаг 2 из 7");
  await guide(page).getByRole("button", { name: "Назад", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Подготовить игровые места/ }),
  ).toHaveCount(0);
  await expect(
    guide(page).getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Выйти из обучения" }).click();
  await expect(
    page.getByRole("heading", { name: "Ваша первая смена" }),
  ).toBeVisible();
});

test("training ignores incoming production deep links", async ({ page }) => {
  const apiCalls: string[] = [];
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await page.goto(
    "/?tutorial=admin&task=real-task&schedule=9&cleaner=2026-11&shift=5",
  );
  await page
    .getByRole("button", { name: "Начать обучение", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test("training remains usable when local storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await start(page, "admin");
  await expect(guide(page)).toContainText("Не удалось сохранить прогресс");
  await openShift(page);
  await expect(guide(page)).toContainText("Шаг 2 из 7");
});

test("administrators only see their course; managers can also practice the administrator workflow", async ({
  page,
}) => {
  await page.goto("/?tutorial=admin");
  await expect(
    page.getByRole("heading", { name: "Ваша первая смена", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Выберите обучение", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Работа управляющего", exact: true }),
  ).toHaveCount(0);
  await page.goto("/?tutorial=manager");
  await expect(
    page.getByLabel("Выберите обучение", { exact: true }).locator("option"),
  ).toHaveText(["Ваша первая смена", "Работа управляющего"]);
  await page
    .getByLabel("Выберите обучение", { exact: true })
    .selectOption("admin");
  await page
    .getByRole("button", { name: "Начать обучение", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
});

async function completeForcedClose(page: Page, info: TestInfo) {
  const button = page.getByRole("button", {
    name: "Принудительно закрыть смену",
    exact: true,
  });
  await expect(button).toHaveCount(0);
  await page
    .getByRole("button", { name: "Текущая смена: подробности" })
    .click();
  await page.screenshot({
    path: info.outputPath("training-shift-expanded.png"),
  });
  await button.click();
  await page.getByLabel("Наличные: сумма", { exact: true }).fill("1000");
  await page.getByLabel("Карта: сумма", { exact: true }).fill("2000");
  await page.getByLabel("СБП: сумма", { exact: true }).fill("500");
  await page
    .getByLabel("Причина принудительного закрытия")
    .fill("Телефон администратора не работает");
  await page
    .getByRole("checkbox", { name: /Подтверждаю закрытие смены/ })
    .check();
  await button.click();
  await expect(
    page.getByRole("heading", { name: "Нет активной смены" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Проверить склад/ }),
  ).toBeVisible();
  await expect(page.locator(".cp-cash")).toContainText("6 000");
  await next(page);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "История смен/задач", exact: true })
    .click();
  await page.locator(".cp-history-row summary").click();
  await expect(page.locator(".cp-force-audit")).toContainText("Мария Волкова");
  await expect(page.locator(".cp-force-audit")).toContainText(
    "Телефон администратора не работает",
  );
  await expect(page.locator(".cp-history-row summary")).toContainText(
    "Алексей Смирнов",
  );
  await next(page);
}

async function completeAutomaticTasks(
  page: Page,
  info: TestInfo,
  superuser = false,
) {
  await page
    .getByRole("button", { name: "Автоматические задачи", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать автозадачу", exact: true })
    .click();
  await page
    .getByLabel("Название автоматической задачи", { exact: true })
    .fill("Проверить зал");
  await page
    .getByLabel("Инструкции автоматической задачи", { exact: true })
    .fill("Проверьте игровые места и приложите фото.");
  await page
    .getByLabel("Смена автоматической задачи", { exact: true })
    .selectOption("day");
  await page
    .getByLabel("Фото автоматической задачи", { exact: true })
    .selectOption("single");
  await page
    .getByRole("button", { name: "Сохранить автозадачу", exact: true })
    .click();
  await next(page);
  const enabled = page.getByRole("switch", {
    name: "Создавать автоматически: Проверить зал",
    exact: true,
  });
  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await next(page);
  await enabled.check();
  await expect(enabled).toBeChecked();
  await page.screenshot({ path: info.outputPath("automatic-training.png") });
  await next(page);
  await expect(
    guide(page).getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Изменить: Проверить зал", exact: true })
    .click();
  if (superuser) {
    await page
      .getByRole("checkbox", {
        name: "Ответственный: Дмитрий Соколов",
        exact: true,
      })
      .check();
    await page
      .getByRole("checkbox", {
        name: "Ответственный: Анна Петрова",
        exact: true,
      })
      .check();
    await expect(
      page.getByRole("checkbox", {
        name: "Ответственный: Мария Волкова",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      guide(page).getByRole("button", { name: "Далее", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("training-reviewers.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Сохранить автозадачу", exact: true })
      .click();
    await expect(
      page.locator(".automatic-template-meta").first(),
    ).toContainText("Анна Петрова");
    await expect(
      page.locator(".automatic-template-meta").first(),
    ).toContainText("Дмитрий Соколов");
  } else {
    await expect(
      page.getByRole("checkbox", { name: /Ответственный:/ }),
    ).toHaveCount(0);
    await expect(page.locator(".automatic-tasks form")).toContainText(
      "Группу назначает суперпользователь",
    );
  }
  await next(page);
}

async function completeSchedule(page: Page, info: TestInfo) {
  await page.getByRole("button", { name: "График смен", exact: true }).click();
  await page.getByRole("button", { name: "Следующий", exact: true }).click();
  await page
    .getByRole("button", { name: "Редактировать график", exact: true })
    .click();
  await page.locator(".schedule-grid button").first().click();
  await page
    .getByRole("button", { name: "Сохранить график", exact: true })
    .click();
  await next(page);
  await page
    .getByRole("button", { name: "Редактировать график", exact: true })
    .click();
  await page.getByText("Автозаполнение 2/2", { exact: true }).click();
  await page
    .getByRole("button", { name: "Заполнить 2/2", exact: true })
    .click();
  await expect(
    guide(page).getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Сохранить график", exact: true })
    .click();
  await next(page);
  await page.getByLabel("Версия графика", { exact: true }).selectOption("2");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Восстановить эту версию", exact: true })
    .click();
  await expect(page.locator(".schedule-page")).toContainText("Версия 4");
  await page.screenshot({ path: info.outputPath("schedule-training.png") });
  await next(page);
}

test("typing moves the hint to a compact top bar and restores it after keyboard dismissal", async ({
  page,
}, info) => {
  await start(page, "manager");
  await page.getByRole("button", { name: "Смена проверена" }).click();
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  const field = page.getByLabel("Название задачи", { exact: true });
  await field.fill("Учебная задача");
  await expect(guide(page)).toHaveAttribute("data-editing", "true");
  let rect = await guide(page).boundingBox();
  expect(rect!.height).toBeLessThanOrEqual(44);
  expect(rect!.y).toBeLessThan(120);
  await page.screenshot({ path: info.outputPath("typing-hint.png") });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 420 });
  await expect(guide(page)).toHaveAttribute("data-editing", "true");
  await field.blur();
  await expect(guide(page)).toHaveAttribute("data-editing", "true");
  await page.setViewportSize(viewport);
  await expect(guide(page)).toHaveAttribute("data-editing", "false");
  rect = await guide(page).boundingBox();
  expect(rect!.y).toBeGreaterThan(120);
});
