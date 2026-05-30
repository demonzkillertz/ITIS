import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/storage": "http://127.0.0.1:8000"
    },
    // Bind to all interfaces locally to avoid external DNS lookup
    host: "0.0.0.0",
    // Use localhost origin for HMR during local development. If you need the
    // annotated domain, add it to your OS hosts file or a DNS entry and then
    // set `origin` to that domain.
    origin: "http://localhost:5173"
  }
});
