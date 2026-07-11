import { describe, expect, it, vi } from "vitest"
import { protectRequest } from "../../functions/_middleware"
import { createSession } from "../../functions/lib/auth"
import type { AuthEnv } from "../../functions/lib/env"

const env: AuthEnv = {
  AUTH_USERNAME: "studio-user",
  AUTH_PASSWORD_HASH: "unused-by-middleware",
  SESSION_SECRET: "dGVzdC1zZXNzaW9uLXNlY3JldA",
  AUTH_RATE_LIMIT: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
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

  it("passes a valid signed session to static routing", async () => {
    const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET)
    const request = new Request("https://studio.example/", {
      headers: { Cookie: `ap_yoga_session=${token}` },
    })
    const next = vi.fn(async () => staticResponse())

    const response = await protectRequest(request, env, next)

    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it.each(["AUTH_USERNAME", "SESSION_SECRET"] as const)(
    "fails closed when the %s binding is missing",
    async (binding) => {
      const token = await createSession(env.AUTH_USERNAME, env.SESSION_SECRET)
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
})
