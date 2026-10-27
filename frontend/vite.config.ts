import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const envDir = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  return {
    plugins: [react()],
    envDir,
    server: {
      allowedHosts: (env.DEV_ALLOWED_HOSTS || "").split(",").filter(Boolean),
      proxy: Object.fromEntries(
        ["/api", "/media"].map((prefix) => [
          prefix,
          {
            target: env.API_PROXY_TARGET || "http://127.0.0.1:8000",
            changeOrigin: true,
          },
        ]),
      ),
    },
  };
});
