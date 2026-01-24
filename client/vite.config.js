import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["zechariah-interspinal-delayingly.ngrok-free.dev"],
    host: "192.168.177.251",
    port: 5173,
  },
});
