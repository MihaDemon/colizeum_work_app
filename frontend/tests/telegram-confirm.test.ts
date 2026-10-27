import { afterEach, expect, it, vi } from "vitest";
import { confirmAction } from "../src/lib/telegram";

afterEach(() => vi.unstubAllGlobals());

it("uses Telegram's confirmation result for accepting and cancelling", async () => {
  const fallback = vi.fn();
  const showConfirm = vi.fn(
    (_message: string, callback: (result: boolean) => void) => callback(false),
  );
  vi.stubGlobal("window", {
    confirm: fallback,
    Telegram: {
      WebApp: { initData: "signed", isVersionAtLeast: () => true, showConfirm },
    },
  });
  expect(await confirmAction("Подтвердить приход уборщицы?")).toBe(false);
  showConfirm.mockImplementation((_message, callback) => callback(true));
  expect(await confirmAction("Подтвердить приход уборщицы?")).toBe(true);
  expect(fallback).not.toHaveBeenCalled();
});

it("uses browser confirmation when the Telegram dialog is unavailable", async () => {
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("window", { confirm });
  expect(await confirmAction("Подтвердить приход уборщицы?")).toBe(false);
  expect(confirm).toHaveBeenCalledWith("Подтвердить приход уборщицы?");
});
