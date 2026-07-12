import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handleLogin } from "../../functions/api/auth/login"
import { handleLogout } from "../../functions/api/auth/logout"
import { handleSession } from "../../functions/api/auth/session"
import * as auth from "../../functions/lib/auth"
import { createSession } from "../../functions/lib/auth"
import { readActiveCredential } from "../../functions/lib/credentials"
import type { AuthDatabase, AuthEnv, RateLimitKV } from "../../functions/lib/env"
import { rateLimitKey } from "../../functions/lib/rate-limit"
import { fakeAuthDatabase } from "./auth-env-fixtures"

const secret = "dGVzdC1zZXNzaW9uLXNlY3JldA"
const env: AuthEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused-in-session-tests",
  SESSION_SECRET: secret,
  AUTH_RATE_LIMIT: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
  AUTH_DB: fakeAuthDatabase(),
}

class MemoryRateLimitKV implements RateLimitKV {
  readonly values = new Map<string, string>()
  readonly writes: Array<{ key: string; value: string; expirationTtl: number }> = []

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string, options: { expirationTtl: number }): Promise<void> {
    this.values.set(key, value)
    this.writes.push({ key, value, expirationTtl: options.expirationTtl })
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

const encoder = new TextEncoder()
const loginSecret = "dGVzdC1sb2dpbi1zZXNzaW9uLXNlY3JldA"
let passwordRecord: string
let loginKv: MemoryRateLimitKV
let loginEnv: AuthEnv

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

async function createPasswordRecord(password: string): Promise<string> {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256)
  return `pbkdf2-sha256$100000$${encode(salt)}$${encode(new Uint8Array(bits))}`
}

function loginRequest(username: unknown, password: unknown, init: RequestInit = {}): Request {
  const { headers, ...requestInit } = init
  return new Request("https://studio.example/api/auth/login", {
    method: "POST",
    ...requestInit,
    headers: { Origin: "https://studio.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username, password }),
  })
}

beforeAll(async () => {
  passwordRecord = await createPasswordRecord("test-password")
})

beforeEach(() => {
  vi.restoreAllMocks()
  loginKv = new MemoryRateLimitKV()
  loginEnv = {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: passwordRecord,
    SESSION_SECRET: loginSecret,
    AUTH_RATE_LIMIT: loginKv,
    AUTH_DB: fakeAuthDatabase(),
  }
})

function d1Env(database: AuthDatabase | undefined): AuthEnv {
  const result: AuthEnv = {
    AUTH_USERNAME: "studio-user",
    AUTH_PASSWORD_HASH: "secret-password-record-must-not-be-used",
    SESSION_SECRET: loginSecret,
    AUTH_RATE_LIMIT: loginKv,
    AUTH_DB: database,
  }
  Object.defineProperty(result, "AUTH_PASSWORD_HASH", {
    get: () => { throw new Error("secret password fallback accessed") },
  })
  return result
}

describe("authentication Functions", () => {
  it("uses a stable privacy-preserving rate-limit key instead of the raw address", async () => {
    const request = loginRequest("studio-user", "test-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })

    const first = await rateLimitKey(request, loginSecret)
    const second = await rateLimitKey(request, loginSecret)
    const passwordChange = await rateLimitKey(request, loginSecret, "password-change")

    expect(first).toBe(second)
    expect(first).toMatch(/^login:[a-f0-9]{64}$/)
    expect(first).not.toContain("203.0.113.42")
    expect(passwordChange).toMatch(/^password-change:[a-f0-9]{64}$/)
    expect(passwordChange).not.toBe(first)
    expect(passwordChange).not.toContain("203.0.113.42")
  })

  it("sets a hardened cookie for matching fake credentials", async () => {
    const response = await handleLogin(loginRequest("studio-user", "test-password"), loginEnv)

    expect(response.status).toBe(204)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=2592000")
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Strict")
  })

  it("returns one generic message for either invalid field", async () => {
    const wrongUser = await handleLogin(loginRequest("wrong-user", "test-password", { headers: { "CF-Connecting-IP": "203.0.113.1" } }), loginEnv)
    const wrongPassword = await handleLogin(loginRequest("studio-user", "wrong-password", { headers: { "CF-Connecting-IP": "203.0.113.2" } }), loginEnv)

    expect(wrongUser.status).toBe(401)
    expect(wrongPassword.status).toBe(401)
    await expect(wrongUser.json()).resolves.toEqual(await wrongPassword.json())
  })

  it("verifies the password even when the username is wrong", async () => {
    const verify = vi.spyOn(auth, "verifyPassword")

    await handleLogin(loginRequest("wrong-user", "test-password"), loginEnv)

    expect(verify).toHaveBeenCalledWith("test-password", passwordRecord)
  })

  it("verifies login passwords against the active D1 record", async () => {
    const verifyPasswordSpy = vi.spyOn(auth, "verifyPassword").mockResolvedValue(true)
    const database = fakeAuthDatabase({
      row: { password_hash: "d1-password-record", credential_version: "version-2" },
    })

    const response = await handleLogin(loginRequest("studio-user", "test-password"), d1Env(database))

    expect(response.status).toBe(204)
    expect(verifyPasswordSpy).toHaveBeenCalledWith("test-password", "d1-password-record")
  })

  it("locks the sixth observed failure for ten minutes", async () => {
    const request = () => loginRequest("wrong-user", "wrong-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await handleLogin(request(), loginEnv, 1_000)).status).toBe(401)
    }

    expect((await handleLogin(request(), loginEnv, 1_000)).status).toBe(429)
    expect(loginKv.writes.at(-1)).toMatchObject({
      value: JSON.stringify({ count: 5, expiresAt: 1_600 }),
      expirationTtl: 600,
    })
    expect([...loginKv.values.keys()].every((key) => !key.includes("203.0.113.42"))).toBe(true)
  })

  it("keeps failures in a fixed ten-minute window instead of extending it", async () => {
    const request = () => loginRequest("wrong-user", "wrong-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })

    for (const nowSeconds of [1_000, 1_100, 1_200, 1_300, 1_599, 1_601, 1_602]) {
      expect((await handleLogin(request(), loginEnv, nowSeconds)).status).toBe(401)
    }

    expect(loginKv.writes[0]).toMatchObject({
      value: JSON.stringify({ count: 1, expiresAt: 1_600 }),
      expirationTtl: 600,
    })
    expect(loginKv.writes[1]).toMatchObject({
      value: JSON.stringify({ count: 2, expiresAt: 1_600 }),
      expirationTtl: 500,
    })
    expect(loginKv.writes[4]).toMatchObject({
      value: JSON.stringify({ count: 5, expiresAt: 1_600 }),
      expirationTtl: 60,
    })
    expect(loginKv.writes.at(-1)).toMatchObject({
      value: JSON.stringify({ count: 2, expiresAt: 2_201 }),
      expirationTtl: 599,
    })
  })

  it.each([
    "not-json",
    JSON.stringify({ count: -1, expiresAt: 1_600 }),
    JSON.stringify({ count: 1.5, expiresAt: 1_600 }),
  ])("fails closed when the stored failure state is invalid: %s", async (stored) => {
    const request = loginRequest("wrong-user", "wrong-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })
    const key = await rateLimitKey(request, loginSecret)
    loginKv.values.set(key, stored)

    const response = await handleLogin(request, loginEnv, 1_000)

    expect(response.status).toBe(429)
  })

  it("clears observed failures after a successful login", async () => {
    const request = (password: string) => loginRequest("studio-user", password, { headers: { "CF-Connecting-IP": "203.0.113.42" } })
    await handleLogin(request("wrong-password"), loginEnv)
    expect(loginKv.values.size).toBe(1)

    expect((await handleLogin(request("test-password"), loginEnv)).status).toBe(204)
    expect(loginKv.values.size).toBe(0)
  })

  it.each([
    "AUTH_USERNAME",
    "AUTH_PASSWORD_HASH",
    "SESSION_SECRET",
    "AUTH_RATE_LIMIT",
    "AUTH_DB",
  ] as const)("fails closed when the %s binding is missing", async (binding) => {
    const incompleteEnv = { ...loginEnv, [binding]: undefined } as unknown as AuthEnv

    const response = await handleLogin(loginRequest("studio-user", "test-password"), incompleteEnv)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ message: "로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." })
  })

  it.each([
    ["cross-origin", { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } }],
    ["non-JSON", { headers: { Origin: "https://studio.example", "Content-Type": "text/plain" } }],
  ])("rejects a %s login request at the origin/JSON boundary", async (_label, init) => {
    const response = await handleLogin(loginRequest("studio-user", "test-password", init), loginEnv)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("rejects malformed JSON at the request boundary", async () => {
    const request = new Request("https://studio.example/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body: "{",
    })

    const response = await handleLogin(request, loginEnv)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("rejects a JSON null login body with the generic request message", async () => {
    const request = new Request("https://studio.example/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
      body: "null",
    })

    const response = await handleLogin(request, loginEnv)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: "요청을 확인해 주세요." })
  })

  it("returns 401 for an unauthenticated session", async () => {
    const response = await handleSession(new Request("https://studio.example/api/auth/session"), env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ authenticated: false })
  })

  it("returns 401 for a malformed session cookie", async () => {
    const request = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: "ap_yoga_session=%" },
    })

    const response = await handleSession(request, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ authenticated: false })
  })

  it("returns 200 for a valid session cookie", async () => {
    const credential = await readActiveCredential(env)
    const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, credential.version)
    const request = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: `ap_yoga_session=${encodeURIComponent(token)}` },
    })

    const response = await handleSession(request, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: true })
  })

  it("accepts only the active D1 credential version for session checks", async () => {
    const sessionEnv: AuthEnv = {
      ...env,
      AUTH_DB: fakeAuthDatabase({
        row: { password_hash: "d1-password-record", credential_version: "version-2" },
      }),
    }
    const versionedToken = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, "version-2")
    const staleVersionToken = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, "version-1")
    const versionedCookieRequest = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: `ap_yoga_session=${encodeURIComponent(versionedToken)}` },
    })
    const staleVersionCookieRequest = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: `ap_yoga_session=${encodeURIComponent(staleVersionToken)}` },
    })

    expect((await handleSession(versionedCookieRequest, sessionEnv)).status).toBe(200)
    expect((await handleSession(staleVersionCookieRequest, sessionEnv)).status).toBe(401)
  })

  it.each([
    ["missing", undefined],
    ["invalid", fakeAuthDatabase({ row: { password_hash: "", credential_version: "version-2" } })],
    ["throwing", fakeAuthDatabase({ readError: new Error("D1 read failed") })],
  ] as const)("fails closed for login and session when AUTH_DB is %s", async (_label, database) => {
    vi.spyOn(auth, "verifySession").mockResolvedValue(true)
    const failedEnv = d1Env(database)
    const token = "synthetic-session-token"
    const sessionRequest = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: `ap_yoga_session=${token}` },
    })

    const loginResponse = await handleLogin(loginRequest("studio-user", "test-password"), failedEnv)
    const sessionResponse = await handleSession(sessionRequest, failedEnv)

    expect(loginResponse.status).toBe(500)
    await expect(loginResponse.json()).resolves.toEqual({
      message: "로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    })
    expect(sessionResponse.status).toBe(401)
    await expect(sessionResponse.json()).resolves.toEqual({ authenticated: false })
  })

  it("logs out a same-origin JSON request with an expired cookie", async () => {
    const request = new Request("https://studio.example/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
    })

    const response = await handleLogout(request)

    expect(response.status).toBe(204)
    expect(response.headers.get("Set-Cookie")).toContain("ap_yoga_session=; Max-Age=0; Path=/")
  })

  it("rejects a cross-origin logout", async () => {
    const request = new Request("https://studio.example/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    })

    const response = await handleLogout(request)

    expect(response.status).toBe(403)
  })
})
