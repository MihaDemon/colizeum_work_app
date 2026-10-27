import { useState } from "react";
import {
  IconArrowUpRight,
  IconBrandTelegram,
  IconShieldCheck,
} from "@tabler/icons-react";
import { ErrorNotice } from "./UI";
import { telegram } from "../lib/telegram";

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
            ? "Регистрация администратора"
            : "Вход через Telegram"}
        </h2>
        <p>
          {state === "register"
            ? "Сначала отправьте свой номер кнопкой «Verify my phone number» в боте. Затем укажите логин и 10 цифр подтверждённого номера."
            : "Откройте приложение через кнопку в Telegram-боте. Ваш аккаунт используется для входа."}
        </p>
        <ErrorNotice message={localError || error} />
        {state === "register" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setLocalError("");
              if (!/^\d{10}$/.test(phone)) {
                setLocalError("Введите 10 цифр телефона без +7.");
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
                maxLength={20}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ваш рабочий логин"
              />
            </label>
            <label>
              Номер телефона
              <div className="phone-input">
                <span>+7</span>
                <input
                  name="phone_number"
                  aria-label="Номер телефона"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  required
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="999 000 00 00"
                />
              </div>
            </label>
            <p className="field-hint">
              10 цифр без кода страны. Номер должен быть заранее добавлен
              администратором.
            </p>
            <button className="primary-button wide" disabled={busy}>
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
