import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const backendPort = process.env.PORT ?? "7720";
const wsUrl = process.env.VITE_WS_URL ?? `ws://localhost:${backendPort}/ws`;
const api = new URL(wsUrl.replace(/^ws/, "http")).origin;
// Resource-only policy: generated HTML cannot reach other hosts through images,
// media or frame navigation (an iframe navigating itself carries data in its URL).
// Scripts and connections stay open for Vite HMR and the cross-port WebSocket.
const csp = [
  `img-src 'self' data: blob: ${api}`,
  `media-src 'self' data: blob: ${api}`,
  "frame-src 'self' about: blob: data:",
].join("; ");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "vibeos-csp",
      transformIndexHtml: (_html, ctx) =>
        ctx.path === "/index.html"
          ? [
              {
                tag: "meta",
                attrs: { "http-equiv": "Content-Security-Policy", content: csp },
                injectTo: "head-prepend",
              },
            ]
          : [],
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    // In dev, connect the WebSocket directly to the backend instead of relying
    // on the dev-server proxy upgrade (which is unreliable for bare WS clients).
    "import.meta.env.VITE_WS_URL": JSON.stringify(wsUrl),
  },
  server: {
    port: 7730,
    strictPort: true,
  },
});
