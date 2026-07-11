import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("PWA production build", () => {
  it("builds while keeping optional MediaPipe WASM outside the precache", () => {
    execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" })

    expect(existsSync("dist/sw.js")).toBe(true)
    expect(existsSync("dist/mediapipe/vision_wasm_internal.wasm")).toBe(true)
  })
})
