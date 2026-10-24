import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1430, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2021", outDir: "dist", emptyOutDir: true },
});
