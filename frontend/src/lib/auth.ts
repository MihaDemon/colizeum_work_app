import { request } from "./api";
import { telegram } from "./telegram";

export async function verifyTelegramContact(
  signal: AbortSignal,
): Promise<string> {
  const app = telegram();
  if (!app?.initData || !app.isVersionAtLeast("6.9") || !app.requestContact) {
    throw new Error("Обновите Telegram и откройте приложение через бота, чтобы подтвердить телефон.");
  }
  const shared = await new Promise<boolean>((resolve) =>
    app.requestContact!(resolve),
  );
  signal.throwIfAborted();
  if (!shared)
    throw new Error("Вы не поделились номером. Нажмите «Подтвердить телефон Telegram» и разрешите доступ.");

  // Telegram sends the contact to the bot separately; allow time for it to reach Django.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    signal.throwIfAborted();
    const proof = await request<{ verified: boolean; phone_number?: string }>(
      "telegram/contact-status/",
      { method: "POST", body: JSON.stringify({ initData: app.initData }), signal },
    );
    if (proof.verified && /^\d{10}$/.test(proof.phone_number || ""))
      return proof.phone_number!;
    if (attempt < 11)
      await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Номер пока не подтверждён. Убедитесь, что управляющий добавил вас в список сотрудников, и повторите попытку.");
}
