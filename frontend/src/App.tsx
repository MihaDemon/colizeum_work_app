import { useCallback, useEffect, useState } from "react";
import { ApiError, request, setToken } from "./lib/api";
import { haptic, initializeTelegram, telegram } from "./lib/telegram";
import type { User } from "./lib/types";
import { Auth } from "./components/Auth";
import { Loading } from "./components/UI";
import LiveWorkspace from "./LiveWorkspace";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = useCallback(() => {
    setToken(null);
    setUser(null);
    setAuthState("login");
  }, []);
  const authenticate = useCallback(
    async (data?: { username: string; phone_number: string }) => {
      const initData = telegram()?.initData;
      if (!initData) {
        setAuthState("login");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const response = await request<{ token: string }>(
          "telegram/telegram/",
          { method: "POST", body: JSON.stringify({ initData, ...data }) },
        );
        setToken(response.token);
        setUser(await request<User>("telegram/me/"));
        setAuthState("ready");
      } catch (err) {
        setToken(null);
        if (
          err instanceof ApiError &&
          err.status === 404 &&
          typeof err.data === "object" &&
          err.data &&
          "require_registration" in err.data
        ) {
          setAuthState("register");
        } else {
          setError((err as Error).message);
          setAuthState(data ? "register" : "login");
          haptic("error");
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const cleanup = initializeTelegram();
    void authenticate();
    const expired = () => {
      reset();
      setError("Сессия завершилась. Войдите снова через Telegram.");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      cleanup();
      window.removeEventListener("session-expired", expired);
    };
  }, [authenticate, reset]);

  if (authState === "loading") return <Loading />;
  if (!user)
    return (
      <Auth
        state={authState}
        error={error}
        busy={busy}
        authenticate={authenticate}
      />
    );
  return <LiveWorkspace account={user} />;
}
