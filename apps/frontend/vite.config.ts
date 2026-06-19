import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const backendPort = process.env.PORT ?? "7720";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    // In dev, connect the WebSocket directly to the backend instead of relying
    // on the dev-server proxy upgrade (which is unreliable for bare WS clients).
    "import.meta.env.VITE_WS_URL": JSON.stringify(
      process.env.VITE_WS_URL ?? `ws://localhost:${backendPort}/ws`,
    ),
  },
  server: {
    port: 7730,
    strictPort: true,
  },
});
