import { describe, expect, it } from "vitest"
import { handleLogout } from "../../functions/api/auth/logout"
import { handleSession } from "../../functions/api/auth/session"
import { createSession } from "../../functions/lib/auth"
import type { AuthEnv } from "../../functions/lib/env"

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

describe("authentication Functions", () => {
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
