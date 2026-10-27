interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; username?: string };
  };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  HapticFeedback: {
    notificationOccurred(type: "success" | "error"): void;
    selectionChanged(): void;
  };
  showScanQrPopup(
    options: { text: string },
    callback: (text: string) => boolean,
  ): void;
  closeScanQrPopup(): void;
  requestContact?(callback: (shared: boolean) => void): void;
  showConfirm?(message: string, callback: (confirmed: boolean) => void): void;
  downloadFile?(params: { url: string; file_name: string }): void;
  openLink?(url: string): void;
}
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}
export const telegram = () => window.Telegram?.WebApp;
export const inTelegram = () => Boolean(telegram()?.initData);
export function confirmAction(message: string): Promise<boolean> {
  const app = telegram();
  if (inTelegram() && app?.isVersionAtLeast("6.2") && app.showConfirm)
    return new Promise((resolve) => app.showConfirm!(message, resolve));
  return Promise.resolve(window.confirm(message));
}
export function initializeTelegram(): () => void {
  const app = telegram();
  if (!app?.initData) return () => {};
  const sync = () => {
    const dark = app.colorScheme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const color = dark ? "#090a0d" : "#f5f5f7";
    app.setHeaderColor(color);
    app.setBackgroundColor(color);
    if (app.isVersionAtLeast("7.10")) app.setBottomBarColor?.(color);
    const inset = app.safeAreaInset;
    const content = app.contentSafeAreaInset;
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      document.documentElement.style.setProperty(
        `--safe-${edge}`,
        `${(inset?.[edge] || 0) + (content?.[edge] || 0)}px`,
      );
    }
  };
  app.ready();
  app.expand();
  sync();
  const events = ["themeChanged", "safeAreaChanged", "contentSafeAreaChanged"];
  events.forEach((event) => app.onEvent(event, sync));
  return () => events.forEach((event) => app.offEvent(event, sync));
}
export function haptic(type: "success" | "error") {
  const app = telegram();
  if (inTelegram() && app?.isVersionAtLeast("6.1"))
    app.HapticFeedback.notificationOccurred(type);
}
