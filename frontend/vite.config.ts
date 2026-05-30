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
    // Allow the dev server to be reached at this hostname and set origin for HMR
    host: "annotaion.sanjibkasti.com.np",
    origin: "https://annotaion.sanjibkasti.com.np"
  }
});
