import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      // The game is the landing page: bundle it with the entry so it does not wait for the
      // entry to run before its own chunk starts downloading.
      codeSplittingOptions: { splitBehavior: ({ routeId }) => (routeId === "/" ? [] : undefined) },
    }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: { globPatterns: ["**/*.{js,css,html,png,webp,svg,ico,wav}"] },
      manifest: {
        name: "justpingpong",
        short_name: "justpingpong",
        description: "justpingpong - PWA Application",
        theme_color: "#17134a",
      },
      pwaAssets: { disabled: false, config: true },
      devOptions: { enabled: true },
    }),
  ],
});
