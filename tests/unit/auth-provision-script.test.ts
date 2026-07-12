import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("authentication provisioning script", () => {
  it("provisions secrets through stdin without CLI secret arguments", () => {
    const source = readFileSync("scripts/provision-auth.mjs", "utf8")

    expect(source).toContain('"pages", "secret", "put"')
    expect(source).toContain("input: `${value}\\n`")
    expect(source).not.toContain("console.log(password")
    expect(source).not.toContain("AUTH_SETUP_PASSWORD")
  })
})
