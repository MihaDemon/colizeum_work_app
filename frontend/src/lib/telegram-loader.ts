import { telegram } from "./telegram";

// Serve Telegram's unmodified SDK from the app origin. A blocked external
// domain must not silently turn a genuine Mini App launch into a browser login.
export function loadTelegramSDK(): Promise<void> {
  if (telegram()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/telegram-web-app.js";
    const timer = window.setTimeout(() => finish(false), 15000);
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer);
      script.onload = script.onerror = null;
      if (loaded && telegram()) resolve();
      else {
        script.remove();
        reject(
          new Error(
            "Не удалось загрузить подключение к Telegram. Проверьте интернет и повторите попытку.",
          ),
        );
      }
    };
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });
}
