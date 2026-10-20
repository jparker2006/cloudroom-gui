import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

export default defineConfig({
  plugins: [sharedUiEnvSeam(), react(), tailwindcss()],
  resolve: {
    conditions: ["source"],
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    outDir: "node_modules/.cache/onboarding-preview",
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, "onboarding-preview.html"),
    },
  },
});
