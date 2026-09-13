import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = (env.VITE_SITE_URL ?? "").replace(/\/$/, "");

  return {
    root: "github-pages",
    base: "./",
    publicDir: "../public",
    plugins: [
      react(),
      {
        name: "inject-public-config",
        transformIndexHtml(html) {
          return html
            .replace("__UPLOAD_API_URL__", escapeHtmlAttribute(env.VITE_UPLOAD_API_URL ?? ""))
            .replace(
              "__TURNSTILE_SITE_KEY__",
              escapeHtmlAttribute(env.VITE_TURNSTILE_SITE_KEY ?? ""),
            )
            .replace(
              "__OG_IMAGE_URL__",
              escapeHtmlAttribute(siteUrl ? `${siteUrl}/og.png` : ""),
            );
        },
      },
    ],
    build: {
      outDir: "../docs",
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
