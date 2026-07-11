import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handleLogin } from "../../functions/api/auth/login"
import { handleLogout } from "../../functions/api/auth/logout"
import { handleSession } from "../../functions/api/auth/session"
import * as auth from "../../functions/lib/auth"
import { createSession } from "../../functions/lib/auth"
import type { AuthEnv, RateLimitKV } from "../../functions/lib/env"
import { rateLimitKey } from "../../functions/lib/rate-limit"

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
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256)
  return `pbkdf2-sha256$600000$${encode(salt)}$${encode(new Uint8Array(bits))}`
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
  }
})

describe("authentication Functions", () => {
  it("uses a stable privacy-preserving rate-limit key instead of the raw address", async () => {
    const request = loginRequest("studio-user", "test-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })

    const first = await rateLimitKey(request, loginSecret)
    const second = await rateLimitKey(request, loginSecret)

    expect(first).toBe(second)
    expect(first).toMatch(/^login:[a-f0-9]{64}$/)
    expect(first).not.toContain("203.0.113.42")
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

  it("locks the sixth observed failure for ten minutes", async () => {
    const request = () => loginRequest("wrong-user", "wrong-password", { headers: { "CF-Connecting-IP": "203.0.113.42" } })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await handleLogin(request(), loginEnv)).status).toBe(401)
    }

    expect((await handleLogin(request(), loginEnv)).status).toBe(429)
    expect(loginKv.writes.at(-1)).toMatchObject({ value: "5", expirationTtl: 600 })
    expect([...loginKv.values.keys()].every((key) => !key.includes("203.0.113.42"))).toBe(true)
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
    const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET)
    const request = new Request("https://studio.example/api/auth/session", {
      headers: { Cookie: `ap_yoga_session=${encodeURIComponent(token)}` },
    })

    const response = await handleSession(request, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ authenticated: true })
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
