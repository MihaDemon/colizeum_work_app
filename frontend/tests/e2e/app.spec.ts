import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
          (window as unknown as { testDownload: typeof file }).testDownload = file;
        },
        requestContact(callback: (sent: boolean) => void) {
          callback(contactShared);
        },
      };
      Object.defineProperty(window, "Telegram", { value: { WebApp: app } });
    },
    { theme: options.theme || "dark", contactShared: options.contactShared !== false },
  );
  await page.route("**/media/**", (route) =>
    route.fulfill({ contentType: "image/png", body: photo }),
  );
  let active = !options.noShift;
  let balance = 1000;
  let taskStatus = "active";
  let contactChecks = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.startsWith("/api/device-qr/")) {
      expect(route.request().headers().authorization).toBeUndefined();
      return route.fulfill({ contentType: "image/png", headers: { "Content-Disposition": 'attachment; filename="station-1-qr.png"' }, body: photo });
    }
    if (path.endsWith("/telegram/contact-status/")) {
      expect(route.request().postDataJSON()).toEqual({ initData: "signed-telegram-test-data" });
      contactChecks += 1;
      return route.fulfill({ json: contactChecks > 1 ? { verified: true, phone_number: "9991234567" } : { verified: false } });
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
        json: { ...user, is_staff: Boolean(options.staff) },
      });
    expect(route.request().headers().authorization).toBe("Token valid-token");
    if (path.endsWith("/qr-download/"))
      return route.fulfill({ json: { url: "https://work.example.invalid/api/device-qr/test-ticket/", file_name: "station-1-qr.png" } });
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
                role: options.staff ? "manager" : "admin",
              },
              people: [
                {
                  id: "1",
                  name: "Алексей Смирнов",
                  initials: "АС",
                  role: options.staff ? "manager" : "admin",
                },
                { id: "2", name: "Manager", initials: "M", role: "manager" },
              ],
              state: {
                shift: active
                  ? {
                      id: "shift-1",
                      adminId: "1",
                      type: "night",
                      openedAt: new Date().toISOString(),
                    }
                  : null,
                balance,
                expenses: [],
                activity: [],
                shifts: [],
                tasks: [
                  {
                    id: "task-1",
                    title: "Clean the stations",
                    description: "Wipe keyboards",
                    adminId: "1",
                    managerId: "2",
                    requiresPhoto: true,
                    priority: "normal",
                    status: taskStatus,
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            },
      });
    if (path.endsWith("/shifts/open/")) active = true;
    if (path.endsWith("/shifts/shift-1/close/")) active = false;
    if (path.endsWith("/shift-expenses/")) balance = 950;
    if (path.endsWith("/tasks/task-1/submit/")) taskStatus = "moderation";
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
    page.getByRole("heading", { name: "Current shift" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: /Night shift/ }),
  ).toBeVisible();
  await expect(page.locator(".cp-profile")).toHaveText("Алексей Смирнов");
  await expect(page.locator(".cp-avatar")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("name-header.png"), fullPage: true });
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

test("new staff confirm their phone in the Mini App and register a username", async ({ page }, info) => {
  await setup(page, { newUser: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Регистрация сотрудника" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Начать работу" })).toBeDisabled();
  await expect(page.getByLabel("Номер телефона", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("registration.png"), fullPage: true });
  await page.getByLabel("Логин", { exact: true }).fill("new_staff");
  await page.getByRole("button", { name: "Подтвердить телефон Telegram", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Телефон подтверждён через Telegram.");
  await expect(page.getByLabel("Номер телефона", { exact: true })).toHaveCount(0);
  await expect(page.getByText("9991234567", { exact: false })).toHaveCount(0);
  const sent = page.waitForRequest((r) => r.url().endsWith("/telegram/telegram/") && Boolean(r.postDataJSON().username));
  await page.getByRole("button", { name: "Начать работу" }).click();
  expect((await sent).postDataJSON()).toEqual({ initData: "signed-telegram-test-data", username: "new_staff", phone_number: "9991234567" });
  await expect(page.getByRole("heading", { name: "Current shift" })).toBeVisible();
});

test("cancelled contact sharing keeps registration disabled and allows retry", async ({ page }) => {
  await setup(page, { newUser: true, contactShared: false });
  await page.goto("/");
  await page.getByRole("button", { name: "Подтвердить телефон Telegram", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Вы не поделились номером");
  await expect(page.getByRole("button", { name: "Начать работу" })).toBeDisabled();
  await page.evaluate(() => {
    window.Telegram!.WebApp.requestContact = (callback) => callback(true);
  });
  await page.getByRole("button", { name: "Подтвердить телефон Telegram", exact: true }).click();
  await expect(page.getByRole("button", { name: "Начать работу" })).toBeEnabled();
});

test("equipment categories, rows and details use their matching device icons", async ({ page }, info) => {
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
  await page.route(/\/api\/(pcs|mice|keyboards|headsets|monitors|playstations)\/$/, (route) => route.fulfill({ json: [{ id: 1, model: "Test device", serial_number: "SN-1" }] }));
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Devices", exact: true }).click();
  for (const [resource, title, icon] of categories) {
    const tab = page.locator(".resource-tabs").getByRole("button", { name: title, exact: true });
    await expect(tab.locator(`.tabler-icon-${icon}`)).toHaveCount(1);
    await tab.click();
    const row = page.locator(resource === "stations" ? ".station-tile" : ".equipment-row").first();
    await expect(row.locator(`.tabler-icon-${icon}`)).toHaveCount(1);
    await row.click();
    await expect(page.locator(`h1 .tabler-icon-${icon}`)).toBeVisible();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
  }
  await page.screenshot({ path: info.outputPath("device-icons.png"), fullPage: true });
});

test("shift opening and closing use real endpoints and fixed opening type", async ({
  page,
}) => {
  await setup(page, { noShift: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Open shift", exact: true }).click();
  await page.getByRole("radio", { name: /Night shift/ }).check();
  const opened = page.waitForRequest(
    (r) => r.url().endsWith("/api/shifts/open/") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Open shift", exact: true }).click();
  expect((await opened).postData()).toContain('name="shift_type"');
  await page.getByRole("button", { name: "Close shift", exact: true }).click();
  await expect(page.locator(".cp-closing-shift")).toContainText("Night shift");
  await expect(page.getByRole("radio")).toHaveCount(0);
  for (const label of ["Cash total", "Card total", "SBP total"])
    await page.getByLabel(label, { exact: true }).fill("10.50");
  await page.getByRole("button", { name: "Close shift", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("required field");
  for (const label of ["Administrator desk", "Closing receipt"])
    await page.getByLabel(label, { exact: true }).setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
  const closed = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/shifts/shift-1/close/") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Close shift", exact: true }).click();
  const command = await closed;
  expect(command.headers()["idempotency-key"]).toBeTruthy();
  expect(command.postData()).toContain('name="desk_photo"');
  expect(command.postData()).toContain('name="receipt_photo"');
  expect(command.postData()).not.toContain('name="shift_type"');
  await expect(
    page.getByRole("button", { name: "Open shift", exact: true }),
  ).toBeVisible();
});

test("expense requires text and submits cash deduction without a photo", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("50");
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Describe");
  await page
    .getByLabel("Expense description", { exact: true })
    .fill("Cleaning supplies");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/shift-expenses/") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  expect((await sent).postData()).toContain("50.00");
  await expect(page.getByText("950 ₽", { exact: true })).toBeVisible();
});

test("task submission requires evidence and stays on moderation", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Clean the stations/ }).click();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "required completion photo",
  );
  await page
    .getByLabel("Completion photo", { exact: true })
    .setInputFiles({ name: "done.png", mimeType: "image/png", buffer: photo });
  const sent = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/tasks/task-1/submit/") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  expect((await sent).postData()).toContain('name="photo"');
  await expect(page.locator(".cp-review-notice")).toContainText(
    "On moderation",
  );
  await page.evaluate(() =>
    (window as unknown as { testBack: () => void }).testBack(),
  );
  await expect(
    page.getByRole("button", { name: /Clean the stations/ }),
  ).toContainText("On moderation");
});

test("failed save preserves draft and retry uses the same command key", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("50");
  await page
    .getByLabel("Expense description", { exact: true })
    .fill("Supplies");
  const keys: string[] = [];
  await page.route("**/api/shift-expenses/", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 503, json: { detail: "Try again" } });
  });
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(
    page.getByLabel("Expense description", { exact: true }),
  ).toHaveValue("Supplies");
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});

test("workspace server errors offer retry", async ({ page }) => {
  await setup(page, { failure: true });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Сервер недоступен");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});
test("regular users can scan and download QR labels without equipment write controls", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Devices", exact: true })
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
  await expect.poll(() => page.evaluate(() => (window as unknown as { testDownload?: { url: string; file_name: string } }).testDownload)).toEqual({
    url: "https://work.example.invalid/api/device-qr/test-ticket/", file_name: "station-1-qr.png",
  });
});

test("QR browser fallback saves a real PNG attachment without an API token", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Devices", exact: true }).click();
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

test("a failed QR download offers retry and keeps the device preview", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/stations/1/qr-download/", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { detail: "Скачивание временно недоступно" } })
      : route.fallback();
  });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Devices", exact: true }).click();
  await page.getByRole("button", { name: "Сканировать QR" }).click();
  await page.getByRole("button", { name: "Показать QR-код" }).click();
  await page.getByRole("button", { name: "Скачать PNG" }).click();
  await expect(page.getByRole("alert")).toContainText("Скачивание временно недоступно");
  await expect(page.getByRole("img", { name: "QR-код: Место 12" })).toBeVisible();
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
    .getByRole("button", { name: "Devices", exact: true })
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
    .getByRole("button", { name: "Devices", exact: true })
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
