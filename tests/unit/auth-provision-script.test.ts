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

  it("rejects passwords longer than 256 code units before provisioning secrets", () => {
    const source = readFileSync("scripts/provision-auth.mjs", "utf8")
    const validationIndex = source.indexOf("password.length > 256")
    const firstSecretIndex = source.indexOf('putSecret("AUTH_USERNAME"')

    expect(validationIndex).toBeGreaterThan(-1)
    expect(validationIndex).toBeLessThan(firstSecretIndex)
  })
})
