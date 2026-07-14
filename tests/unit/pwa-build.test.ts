import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../..")

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath]
  })
}

describe("PWA production build", () => {
  it("keeps API navigation and session requests out of PWA caches", () => {
    const configSource = readFileSync(path.join(root, "vite.config.ts"), "utf8")
    const authClientSource = readFileSync(path.join(root, "src/features/auth/auth-client.ts"), "utf8")

    expect(configSource).toContain("navigateFallbackDenylist")
    expect(configSource).toContain("/^\\/api\\//")
    expect(authClientSource).toContain('cache: "no-store"')
  })

  it("builds without the removed face-detection runtime", () => {
    execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" })

    const dist = path.join(root, "dist")
    const serviceWorker = path.join(dist, "sw.js")
    const routes = path.join(dist, "_routes.json")

    expect(existsSync(serviceWorker)).toBe(true)
    expect(existsSync(path.join(dist, "mediapipe/vision_wasm_internal.wasm"))).toBe(false)
    expect(existsSync(routes)).toBe(true)
    expect(JSON.parse(readFileSync(routes, "utf8")).include).toContain("/api/*")
    expect(readFileSync(serviceWorker, "utf8")).not.toContain("/api/auth")

    for (const file of filesUnder(dist)) {
      const contents = readFileSync(file)
      expect(contents.includes("AUTH_PASSWORD_HASH"), file).toBe(false)
      expect(contents.includes("SESSION_SECRET"), file).toBe(false)
    }
  }, 15_000)
})
