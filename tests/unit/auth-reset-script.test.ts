import { existsSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("administrator password reset", () => {
  const scriptPath = "scripts/reset-auth.mjs"

  it("uses hidden TTY input and never passes password values as arguments", () => {
    expect(existsSync(scriptPath)).toBe(true)
    if (!existsSync(scriptPath)) return

    const source = readFileSync(scriptPath, "utf8")
    expect(source).toContain("process.stdin.isTTY")
    expect(source).toContain("setRawMode(true)")
    expect(source).toContain('putSecret("AUTH_PASSWORD_HASH"')
    expect(source).toContain('putSecret("SESSION_SECRET"')
    expect(source).toContain("input: `${value}\\n`")
    expect(source).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(source).not.toContain("console.log(password")
    expect(source).not.toMatch(/process\.env\.[A-Z_]*PASSWORD/)
  })

  it("validates both entries and the 12 to 256 length contract before external commands", () => {
    expect(existsSync(scriptPath)).toBe(true)
    if (!existsSync(scriptPath)) return

    const source = readFileSync(scriptPath, "utf8")
    const nonempty = source.indexOf("!password || !confirmation")
    const mismatch = source.indexOf("password !== confirmation")
    const minimum = source.indexOf("password.length < 12")
    const maximum = source.indexOf("password.length > 256")
    const firstSecret = source.indexOf('putSecret("AUTH_PASSWORD_HASH"')

    for (const validation of [nonempty, mismatch, minimum, maximum]) {
      expect(validation).toBeGreaterThan(-1)
      expect(validation).toBeLessThan(firstSecret)
    }
  })

  it("deploys before deleting the D1 override and verifies login last", () => {
    expect(existsSync(scriptPath)).toBe(true)
    if (!existsSync(scriptPath)) return

    const source = readFileSync(scriptPath, "utf8")
    const deploy = source.indexOf('["run", "deploy:cloudflare"]')
    const removeOverride = source.indexOf('"DELETE FROM auth_credentials WHERE id = 1"')
    const verifyLogin = source.indexOf("/api/auth/login")
    expect(deploy).toBeGreaterThan(-1)
    expect(removeOverride).toBeGreaterThan(deploy)
    expect(verifyLogin).toBeGreaterThan(removeOverride)
  })

  it("uses the canonical same-origin login and logs the verification session out", () => {
    expect(existsSync(scriptPath)).toBe(true)
    if (!existsSync(scriptPath)) return

    const source = readFileSync(scriptPath, "utf8")
    expect(source).toContain('const productionOrigin = "https://ap-yoga-content-studio.pages.dev"')
    expect(source).toContain('Origin: productionOrigin')
    expect(source).toContain('"Content-Type": "application/json"')
    expect(source).toContain("loginResponse.status !== 204")
    expect(source).toContain("/api/auth/logout")
    expect(source).toContain('headers.Cookie = cookie')
    expect(source).toContain("logoutResponse.status !== 204")
  })

  it("clears sensitive strings and emits completion only after verification", () => {
    expect(existsSync(scriptPath)).toBe(true)
    if (!existsSync(scriptPath)) return

    const source = readFileSync(scriptPath, "utf8")
    expect(source).toContain('password = "\\0".repeat(password.length)')
    expect(source).toContain('confirmation = "\\0".repeat(confirmation.length)')
    expect(source).toContain('passwordHash = "\\0".repeat(passwordHash.length)')
    expect(source).toContain('sessionSecret = "\\0".repeat(sessionSecret.length)')
    expect(source.match(/관리자 비밀번호 초기화 완료/g)).toHaveLength(1)
    expect(source.indexOf("관리자 비밀번호 초기화 완료")).toBeGreaterThan(source.indexOf("/api/auth/logout"))
    expect(source).toContain("process.exitCode = 1")
  })

  it("publishes the package and operator documentation contracts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>
    }
    const readme = readFileSync("README.md", "utf8")

    expect(packageJson.scripts["auth:reset"]).toBe("node scripts/reset-auth.mjs")
    expect(readme).toContain("npm run auth:reset")
  })
})
