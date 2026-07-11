import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("PWA icon generation", () => {
  it("renders the approved SVG to all manifest PNG sizes", () => {
    execFileSync(process.execPath, ["scripts/generate-icons.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe"
    })

    for (const size of [180, 192, 512]) {
      expect(statSync(resolve(`public/icons/app-icon-${size}.png`)).size).toBeGreaterThan(1000)
    }
  })
})
