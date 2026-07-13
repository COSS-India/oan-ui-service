import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The app is served under a sub-path on the platform (e.g. /oan/), so assets must
// resolve under that base. Env-overridable (VITE_BASE); defaults to /oan/.
// Set VITE_BASE=/ to build/serve at root. Must stay in sync with the router
// basepath in src/App.tsx (VITE_ROUTER_BASEPATH).
const BASE = process.env.VITE_BASE ?? "/oan/";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: BASE,
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [
    react(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
