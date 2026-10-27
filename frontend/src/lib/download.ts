import { request } from "./api";
import { inTelegram, telegram } from "./telegram";
import type { Resource } from "./types";

export async function downloadDeviceQr(resource: Resource, id: number) {
  // Generate a fresh link on each click; the downloader cannot send our API token.
  const file = await request<{ url: string; file_name: string }>(
    `${resource}/${id}/qr-download/`,
  );
  const url = new URL(file.url);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Не удалось подготовить ссылку для скачивания. Повторите попытку.");
  const app = telegram();
  if (
    inTelegram() &&
    app?.isVersionAtLeast("8.0") &&
    app.downloadFile &&
    url.protocol === "https:"
  ) {
    try {
      app.downloadFile(file);
      return;
    } catch {
      // Some desktop/older clients expose the method without implementing it.
    }
  }
  if (inTelegram() && app?.openLink) {
    app.openLink(file.url);
    return;
  }
  // A real attachment URL works in browsers without relying on blob downloads.
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.file_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
