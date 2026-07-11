import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globIgnores: ["**/mediapipe/**"]
      },
      manifest: {
        name: "A.P YOGA Content Studio",
        short_name: "AP Content",
        description: "사진과 메모로 네이버와 인스타그램 콘텐츠를 만드는 로컬 스튜디오",
        display: "standalone",
        start_url: "/",
        theme_color: "#F6F1E8",
        background_color: "#F6F1E8",
        icons: [
          { src: "/icons/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icons/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      }
    })
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  build: {
    chunkSizeWarningLimit: 1500
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: true,
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/dist/**"]
  }
})
