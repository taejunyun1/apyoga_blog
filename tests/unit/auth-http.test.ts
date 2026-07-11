import { describe, expect, it } from "vitest"
import { expiredSessionCookie, isSameOriginJson, sessionCookie } from "../../functions/lib/http"

describe("authentication HTTP boundary", () => {
  it("creates a hardened 30-day cookie", () => {
    expect(sessionCookie("token")).toBe("ap_yoga_session=token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict")
  })

  it("expires the same cookie on logout", () => {
    expect(expiredSessionCookie()).toContain("ap_yoga_session=; Max-Age=0; Path=/")
  })

  it("accepts only same-origin JSON mutations", () => {
    const valid = new Request("https://studio.example/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://studio.example", "Content-Type": "application/json" },
    })
    const crossOrigin = new Request("https://studio.example/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    })

    expect(isSameOriginJson(valid)).toBe(true)
    expect(isSameOriginJson(crossOrigin)).toBe(false)
  })
})
