import { execFileSync } from "node:child_process"
import { describe, it } from "vitest"

describe("Vue TypeScript toolchain", () => {
  it("type-checks Vue files with the pinned TypeScript compiler", () => {
    execFileSync(process.execPath, ["node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit"], {
      cwd: process.cwd(),
      stdio: "pipe"
    })
  })
})
