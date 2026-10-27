import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTelegramContact } from "../src/lib/auth";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(shared = true, responses = [{ verified: true, phone_number: "9991234567" }]) {
  const requestContact = vi.fn((callback: (sent: boolean) => void) => callback(shared));
  const app = { initData: "signed-telegram-data", isVersionAtLeast: () => true, requestContact };
  vi.stubGlobal("window", { Telegram: { WebApp: app } });
  const fetch = vi.fn();
  for (const data of responses) fetch.mockResolvedValueOnce(Response.json(data));
  vi.stubGlobal("fetch", fetch);
  return { fetch, requestContact, app };
}

describe("Mini App contact confirmation", () => {
  it("waits for the bot and retrieves the phone from the signed backend response", async () => {
    const { fetch, requestContact } = setup(true, [
      { verified: false, phone_number: "" },
      { verified: true, phone_number: "9991234567" },
    ]);
    const result = verifyTelegramContact(new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await result).toBe("9991234567");
    expect(requestContact).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0].pathname).toBe("/api/telegram/contact-status/");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ initData: "signed-telegram-data" });
  });

  it("does not query or register when the Telegram popup is cancelled", async () => {
    const { fetch } = setup(false);
    await expect(verifyTelegramContact(new AbortController().signal)).rejects.toThrow("не поделились");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains when the Telegram client does not support contact sharing", async () => {
    const { app, fetch } = setup();
    app.isVersionAtLeast = () => false;
    await expect(verifyTelegramContact(new AbortController().signal)).rejects.toThrow("Обновите Telegram");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops waiting after twelve unconfirmed replies", async () => {
    const { fetch } = setup(true, Array.from({ length: 12 }, () => ({ verified: false, phone_number: "" })));
    const result = expect(verifyTelegramContact(new AbortController().signal)).rejects.toThrow("список сотрудников");
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it("preserves an expired-session error from Django", async () => {
    const { fetch } = setup();
    fetch.mockReset().mockResolvedValue(Response.json({ detail: "Сессия Telegram истекла" }, { status: 403 }));
    await expect(verifyTelegramContact(new AbortController().signal)).rejects.toThrow("Сессия Telegram истекла");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("stops when the registration screen is closed", async () => {
    const { fetch } = setup();
    const controller = new AbortController();
    const result = verifyTelegramContact(controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
