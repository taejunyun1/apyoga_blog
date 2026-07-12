import { describe, expect, it, vi } from "vitest"
import { protectRequest } from "../../functions/_middleware"
import * as auth from "../../functions/lib/auth"
import { createSession } from "../../functions/lib/auth"
import { readActiveCredential } from "../../functions/lib/credentials"
import type { AuthDatabase, AuthEnv } from "../../functions/lib/env"
import { fakeAuthDatabase } from "./auth-env-fixtures"

const env: AuthEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused-by-middleware",
  SESSION_SECRET: "dGVzdC1zZXNzaW9uLXNlY3JldA",
  AUTH_RATE_LIMIT: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
  AUTH_DB: fakeAuthDatabase(),
}

function d1Env(database: AuthDatabase | undefined): AuthEnv {
  const result: AuthEnv = {
    ...env,
    AUTH_DB: database,
  }
  Object.defineProperty(result, "AUTH_PASSWORD_HASH", {
    get: () => { throw new Error("secret password fallback accessed") },
  })
  return result
}

function staticResponse(): Response {
  return new Response("static", { status: 200 })
}

describe("Pages authentication middleware", () => {
  it.each([
    "/login",
    "/api/auth/login",
    "/api/auth/session",
    "/api/auth/logout",
  ])("allows the public endpoint %s without a session", async (pathname) => {
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(new Request(`https://studio.example${pathname}`), env, next)

    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it("redirects a private document while preserving its path and query as a safe next target", async () => {
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(
      new Request("https://studio.example/studio/draft-1?tab=photos&return=https%3A%2F%2Fevil.example"),
      env,
      next,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(
      "https://studio.example/login?next=%2Fstudio%2Fdraft-1%3Ftab%3Dphotos%26return%3Dhttps%253A%252F%252Fevil.example",
    )
    expect(new URL(response.headers.get("Location")!).searchParams.get("next")).toBe(
      "/studio/draft-1?tab=photos&return=https%3A%2F%2Fevil.example",
    )
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects a private API with JSON instead of redirecting", async () => {
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(new Request("https://studio.example/api/ai"), env, next)

    expect(response.status).toBe(401)
    expect(response.headers.get("Content-Type")).toContain("application/json")
    await expect(response.json()).resolves.toEqual({ message: "로그인이 필요해요." })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects the content generation API without a valid session", async () => {
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(
      new Request("https://studio.example/api/content/generate", { method: "POST" }),
      env,
      next,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: "로그인이 필요해요." })
    expect(next).not.toHaveBeenCalled()
  })

  it("keeps the password-change API private without a session", async () => {
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(
      new Request("https://studio.example/api/auth/password", { method: "POST" }),
      env,
      next,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: "로그인이 필요해요." })
    expect(next).not.toHaveBeenCalled()
  })

  it("passes a current-version session to the password-change API", async () => {
    const credential = await readActiveCredential(env)
    const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, credential.version)
    const next = vi.fn(async () => staticResponse())
    const request = new Request("https://studio.example/api/auth/password", {
      method: "POST",
      headers: { Cookie: `ap_yoga_session=${token}` },
    })

    const response = await protectRequest(request, env, next)

    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it("passes a valid signed session to static routing", async () => {
    const credential = await readActiveCredential(env)
    const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, credential.version)
    const request = new Request("https://studio.example/", {
      headers: { Cookie: `ap_yoga_session=${token}` },
    })
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(request, env, next)

    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it("rejects a signed session bound to a stale D1 credential version", async () => {
    const sessionEnv: AuthEnv = {
      ...env,
      AUTH_DB: fakeAuthDatabase({
        row: { password_hash: "d1-password-record", credential_version: "version-2" },
      }),
    }
    const staleToken = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, "version-1")
    const staleVersionRequest = new Request("https://studio.example/api/ai", {
      headers: { Cookie: `ap_yoga_session=${staleToken}` },
    })
    const next = vi.fn(async () => staticResponse())

    expect((await protectRequest(staleVersionRequest, sessionEnv, next)).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it.each(["AUTH_USERNAME", "SESSION_SECRET"] as const)(
    "fails closed when the %s binding is missing",
    async (binding) => {
      const credential = await readActiveCredential(env)
      const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET, credential.version)
      const incompleteEnv = { ...env, [binding]: undefined } as unknown as AuthEnv
      const request = new Request("https://studio.example/api/ai", {
        headers: { Cookie: `ap_yoga_session=${token}` },
      })
      const next = vi.fn(async () => staticResponse())

      const response = await protectRequest(request, incompleteEnv, next)

      expect(response.status).toBe(401)
      expect(next).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["missing", undefined],
    ["invalid", fakeAuthDatabase({ row: { password_hash: "", credential_version: "version-2" } })],
    ["throwing", fakeAuthDatabase({ readError: new Error("D1 read failed") })],
  ] as const)("fails closed for private API and page requests when AUTH_DB is %s", async (_label, database) => {
    vi.spyOn(auth, "verifySession").mockResolvedValue(true)
    const failedEnv = d1Env(database)
    const next = vi.fn(async () => staticResponse())
    const privateApi = new Request("https://studio.example/api/ai", {
      headers: { Cookie: "ap_yoga_session=synthetic-session-token" },
    })
    const privatePage = new Request("https://studio.example/studio/draft-1", {
      headers: { Cookie: "ap_yoga_session=synthetic-session-token" },
    })

    const apiResponse = await protectRequest(privateApi, failedEnv, next)
    const pageResponse = await protectRequest(privatePage, failedEnv, next)

    expect(apiResponse.status).toBe(401)
    expect(pageResponse.status).toBe(302)
    expect(pageResponse.headers.get("Location")).toBe(
      "https://studio.example/login?next=%2Fstudio%2Fdraft-1",
    )
    expect(next).not.toHaveBeenCalled()
  })
})
