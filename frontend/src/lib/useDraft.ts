import { useEffect } from "react";
import { inTelegram, telegram } from "./telegram";

export function useDraft(dirty: boolean, busy: boolean, source = "default") {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("draft-status", { detail: { dirty, busy, source } }),
    );
    const app = telegram();
    if (inTelegram() && app?.isVersionAtLeast("6.2") && (dirty || busy))
      app.enableClosingConfirmation();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.dispatchEvent(
        new CustomEvent("draft-status", {
          detail: { dirty: false, busy: false, source },
        }),
      );
      if (inTelegram() && app?.isVersionAtLeast("6.2"))
        app.disableClosingConfirmation();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, busy, source]);
}
