import { expect, test, type Page } from "@playwright/test";

const guide = (page: Page) =>
  page.getByRole("complementary", { name: "Подсказка обучения" });
const next = (page: Page) =>
  guide(page).getByRole("button", { name: "Далее", exact: true }).click();
async function start(page: Page, role: "admin" | "manager") {
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
  await expect(guide(page)).toContainText("На проверке");
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
  await expect(guide(page)).toContainText("3 500 ₽");
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

test("manager assigns, reviews, returns and accepts a task without any API calls", async ({
  page,
}, info) => {
  const apiCalls: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await start(page, "manager");
  await createTask(page);
  await expect(
    guide(page).getByRole("button", { name: "Результат просмотрен" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Подготовить игровые места/ }).click();
  await expect(
    page.getByRole("img", { name: "Фото выполнения", exact: true }),
  ).toBeVisible();
  await guide(page)
    .getByRole("button", { name: "Результат просмотрен" })
    .click();
  await page.getByRole("button", { name: /Подготовить игровые места/ }).click();
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
  await page.getByRole("button", { name: /Подготовить игровые места/ }).click();
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
  await guide(page).getByRole("button", { name: "Завершить" }).click();
  await expect(
    page.getByRole("heading", { name: "Обучение пройдено" }),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test("training resumes after reload and Back restores the previous exercise", async ({
  page,
}) => {
  await start(page, "admin");
  await openShift(page);
  await page.reload();
  await page.getByRole("button", { name: "Продолжить с шага 2" }).click();
  await expect(guide(page)).toContainText("Шаг 2 из 6");
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
  await expect(guide(page)).toContainText("Шаг 2 из 6");
});
