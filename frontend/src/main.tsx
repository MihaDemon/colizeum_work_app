import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorNotice, Loading } from "./components/UI";
import { loadTelegramSDK } from "./lib/telegram-loader";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
async function start() {
  root.render(<Loading />);
  try {
    await loadTelegramSDK();
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <main className="auth-panel">
        <ErrorNotice
          message={(error as Error).message}
          retry={() => void start()}
        />
      </main>,
    );
  }
}
void start();
