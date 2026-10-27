import { useEffect, useRef, useState } from "react";
import {
  IconArrowUpRight,
  IconBrandTelegram,
  IconShieldCheck,
  IconPhone,
} from "@tabler/icons-react";
import { ErrorNotice } from "./UI";
import { telegram } from "../lib/telegram";
import { verifyTelegramContact } from "../lib/auth";

export function Auth({
  state,
  error,
  busy,
  authenticate,
}: {
  state: string;
  error: string;
  busy: boolean;
  authenticate: (data?: {
    username: string;
    phone_number: string;
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState(
    telegram()?.initDataUnsafe.user?.username?.slice(0, 20) || "",
  );
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const verification = useRef<AbortController | null>(null);
  useEffect(() => () => verification.current?.abort(), []);
  const confirmPhone = async () => {
    if (verifying || busy) return;
    const controller = new AbortController();
    verification.current = controller;
    setVerifying(true);
    setLocalError("");
    try {
      const confirmedPhone = await verifyTelegramContact(controller.signal);
      if (!controller.signal.aborted) setPhone(confirmedPhone);
    } catch (err) {
      if (!controller.signal.aborted) setLocalError((err as Error).message);
    } finally {
      if (!controller.signal.aborted) setVerifying(false);
    }
  };
  return (
    <main className="auth-layout">
      <div className="auth-intro">
        <div className="wordmark">
          COLIZEUM<span>WORK</span>
        </div>
        <h1>
          Всё для
          <br />
          вашей смены<span className="accent">.</span>
        </h1>
        <p>Отчёты, расходы и оборудование клуба в одном рабочем приложении.</p>
        <div className="auth-note">
          <IconShieldCheck size={22} />
          Для команды администраторов
        </div>
      </div>
      <section className="auth-panel">
        <IconBrandTelegram size={36} className="accent" />
        <h2>
          {state === "register"
            ? "Регистрация сотрудника"
            : "Вход через Telegram"}
        </h2>
        <p>
          {state === "register"
            ? "Укажите рабочий логин и подтвердите свой номер через Telegram. Управляющий должен заранее добавить вас в список сотрудников."
            : "Откройте приложение через кнопку в Telegram-боте. Ваш аккаунт используется для входа."}
        </p>
        <ErrorNotice message={localError || error} />
        {state === "register" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || verifying) return;
              setLocalError("");
              if (!/^\d{10}$/.test(phone)) {
                setLocalError("Подтвердите свой номер через Telegram.");
                return;
              }
              if (!username.trim()) {
                setLocalError("Укажите логин.");
                return;
              }
              void authenticate({
                username: username.trim(),
                phone_number: phone,
              });
            }}
          >
            <label>
              Логин
              <input
                name="username"
                required
                disabled={busy || verifying}
                maxLength={20}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ваш рабочий логин"
              />
            </label>
            {phone ? (
              <label>
                Номер телефона
                <div className="phone-input">
                  <span>+7</span>
                  <input
                    name="phone_number"
                    aria-label="Номер телефона"
                    type="tel"
                    autoComplete="tel-national"
                    readOnly
                    value={phone}
                  />
                </div>
              </label>
            ) : (
              <button
                className="secondary-button wide"
                type="button"
                disabled={busy || verifying}
                onClick={() => void confirmPhone()}
              >
                <IconPhone size={20} />
                {verifying ? "Проверяем контакт…" : "Подтвердить телефон Telegram"}
              </button>
            )}
            {phone && (
              <p className="field-hint" role="status">
                Телефон подтверждён через Telegram.
              </p>
            )}
            <button
              className="primary-button wide"
              disabled={busy || verifying || !phone}
            >
              {busy ? "Регистрируем…" : "Начать работу"}
              <IconArrowUpRight size={20} />
            </button>
          </form>
        ) : telegram()?.initData ? (
          <button
            className="primary-button wide"
            disabled={busy}
            onClick={() => void authenticate()}
          >
            {busy ? "Входим…" : "Повторить вход"}
          </button>
        ) : null}
      </section>
    </main>
  );
}
