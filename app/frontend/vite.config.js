import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy forwards API calls to the FastAPI backend on :8080.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
