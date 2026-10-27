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
async function session(browser: Browser, id: number) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
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
  }, new URLSearchParams(fields).toString());
  const page = await context.newPage();
  await page.goto(process.env.STACK_BASE_URL!);
  await expect(page.locator(".cp-bottom-nav")).toBeVisible();
  return { page, context };
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
  try {
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
      manager.page.getByRole("button", { name: "История смен", exact: true }),
    ).toHaveCount(0);
    await manager.page
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "История смен", exact: true })
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
    await owner.page
      .getByRole("button", { name: "Открыть смену", exact: true })
      .click();
    await expect(
      owner.page.getByRole("heading", { name: "Детали смены" }),
    ).toBeVisible();
    await expect(owner.page.getByText("600 ₽", { exact: true })).toBeVisible();
    await expect(
      owner.page.getByRole("img", { name: "Чек закрытия смены", exact: true }),
    ).toBeVisible();
    await owner.page.goto(`${process.env.STACK_BASE_URL}/?expense=1`);
    await expect(
      owner.page.getByRole("heading", { name: "Расход из кассы" }),
    ).toBeVisible();
    await expect(
      owner.page.getByText("Cleaning supplies", { exact: true }),
    ).toBeVisible();
  } finally {
    await admin.context.close();
    await manager.context.close();
    await owner.context.close();
  }
});
